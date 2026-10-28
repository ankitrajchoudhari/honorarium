import type { Metadata } from "next";
import { LinkButton, LocalTime, Notice, PageTitle } from "@/components/ui";
import { lockedRuleSet, studyImport, studyQuestionMap } from "@/db/queries";
import { getStudyOr404 } from "@/db/study-page";
import { ROLE_LABELS, type ColumnRole } from "@/engine/roles";
import { requireWorkspace } from "@/lib/session";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage({ params }: PageProps<"/studies/[studyId]/import">) {
  const { studyId } = await params;
  const workspace = await requireWorkspace();
  const study = await getStudyOr404(workspace.id, studyId);
  const [locked, imported] = await Promise.all([lockedRuleSet(study.id), studyImport(study.id)]);

  if (imported) {
    const map = await studyQuestionMap(study.id);
    const warnings = imported.parseWarningsJson as string[];
    return (
      <div className="space-y-4">
        <PageTitle description="Responses are stored exactly as exported; only mapped columns are parsed.">Imported responses</PageTitle>
        <p>
          <span className="font-mono">{imported.fileName}</span> · {imported.rowCount} rows · {imported.encoding} · imported <LocalTime date={imported.createdAt} /> · SHA-256{" "}
          <span className="font-mono text-xs">{imported.sha256.slice(0, 12)}</span>
          {imported.timezone ? ` · times without a zone read as ${imported.timezone}` : ""}
        </p>
        {warnings.length > 0 && (
          <Notice tone="warning" title="Import notes">
            <ul className="list-disc pl-5">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </Notice>
        )}
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {map
            .filter((entry) => entry.role !== "other")
            .map((entry) => (
              <li key={entry.id}>
                <span className="font-mono">{entry.columnName}</span> <span className="text-muted">→ {ROLE_LABELS[entry.role as ColumnRole]}</span>
              </li>
            ))}
        </ul>
        <LinkButton href={`/studies/${study.id}/verify`} variant="primary">
          Go to verification
        </LinkButton>
      </div>
    );
  }

  if (!locked) {
    return (
      <div className="space-y-4">
        <PageTitle>Import responses</PageTitle>
        <Notice tone="warning" title="Lock the exclusion rules first">
          Rules have to be decided before anyone looks at the responses. Lock them, then import.
        </Notice>
        <LinkButton href={`/studies/${study.id}/rules`} variant="primary">
          Go to rules
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageTitle description="CSV exports from Qualtrics, Google Forms and REDCap work. The file is read in your browser for the preview, then checked again on the server.">
        Import responses
      </PageTitle>
      <ImportWizard studyId={study.id} ruleSet={locked.rules} />
    </div>
  );
}
