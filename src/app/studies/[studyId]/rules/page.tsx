import type { Metadata } from "next";
import { LocalTime, Notice, PageTitle } from "@/components/ui";
import { ruleSetVersions, studyImport } from "@/db/queries";
import { getStudyOr404 } from "@/db/study-page";
import { ruleSetSchema } from "@/engine/dsl";
import { requireWorkspace } from "@/lib/session";
import { RulesEditor } from "./rules-editor";

export const metadata: Metadata = { title: "Rules" };

export default async function RulesPage({ params }: PageProps<"/studies/[studyId]/rules">) {
  const { studyId } = await params;
  const workspace = await requireWorkspace();
  const study = await getStudyOr404(workspace.id, studyId);
  const [versions, imported] = await Promise.all([ruleSetVersions(study.id), studyImport(study.id)]);
  const latest = versions[0];
  if (!latest) {
    return <Notice tone="error" title="This study has no rule set." />;
  }
  const parsed = latest.compiledJson ? ruleSetSchema.safeParse(latest.compiledJson) : null;
  const history = versions.filter((version) => version.lockedAt);

  return (
    <div className="space-y-6">
      <PageTitle description="Write exclusion rules the way you would put them in your protocol. Gemini turns them into exact checks; you review the result and lock it before any responses are imported.">
        Exclusion rules · version {latest.version}
      </PageTitle>
      {latest.changeNote && !latest.lockedAt && <Notice tone="warning" title={`Changing rules after v${latest.version - 1}`}>{latest.changeNote}. This change will appear in the ethics report.</Notice>}
      <RulesEditor
        key={`${latest.id}-${latest.updatedAt.getTime()}`}
        studyId={study.id}
        version={latest.version}
        sourceText={latest.sourceText}
        ruleSet={parsed?.success ? parsed.data : null}
        couldNotCompile={(latest.couldNotCompileJson as { phrase: string; reason: string }[] | null) ?? []}
        compiledBy={latest.compiledBy}
        locked={latest.lockedAt ? { at: latest.lockedAt.toISOString(), by: latest.lockedBy ?? "", sha256: latest.sha256 ?? "" } : null}
        hasData={imported !== null}
      />
      {history.length > 0 && (
        <section aria-labelledby="history">
          <h3 id="history" className="mb-2 font-semibold">
            Locked versions
          </h3>
          <ul className="space-y-1 text-sm">
            {history.map((version) => (
              <li key={version.id} className="font-mono text-xs">
                v{version.version} · {version.sha256?.slice(0, 12)} · locked <LocalTime date={version.lockedAt!} /> by {version.lockedBy}
                {version.changeNote ? <span className="font-sans text-muted"> · change: {version.changeNote}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
