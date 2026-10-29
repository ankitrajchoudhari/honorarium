import type { Metadata } from "next";
import { deleteWorkspaceAction, resetSampleStudyAction } from "@/app/actions/studies";
import { AiAnimation } from "@/components/ai-animation";
import { ActionForm, ActionSubmit } from "@/components/action-form";
import { ReviewerNameForm } from "@/components/reviewer-name-form";
import { Shell } from "@/components/shell";
import { inputClass, Notice, Section } from "@/components/ui";
import { aiUsageToday } from "@/ai/gemini";
import { checkDatabase } from "@/db/health";
import { env } from "@/lib/env";
import { currentWorkspace, reviewerName } from "@/lib/session";
import { existingSampleStudy } from "@/studies/sample";

export const metadata: Metadata = { title: "About this workspace" };

export default async function WorkspacePage({ searchParams }: PageProps<"/workspace">) {
  const query = await searchParams;
  const workspace = await currentWorkspace();
  const [usage, database, reviewer, sample] = await Promise.all([aiUsageToday(), checkDatabase(), reviewerName(), workspace ? existingSampleStudy(workspace.id) : null]);

  return (
    <Shell>
      <main id="main" className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <h1 className="text-2xl font-extrabold tracking-tight">About this workspace</h1>
        <Notice tone="warning" title="All payments are PayPal sandbox test money">
          Honorarium runs against PayPal&apos;s sandbox only. No real money moves and no real participant data belongs here.
        </Notice>

        <Section level={2} title="Your workspace">
          <p className="text-muted">
            Each browser gets its own private workspace through a signed cookie. Nobody else can see its studies. {workspace ? "" : "You have not created anything yet."}
          </p>
          <div className="mt-3">
            <ReviewerNameForm current={reviewer} />
          </div>
        </Section>

        <Section level={2} title="How data is handled">
          <ul className="list-disc space-y-1 pl-5">
            <li>Responses are stored exactly as imported. Payout emails and phone numbers are masked in the interface; revealing one is written to the audit log.</li>
            <li>Participant text is shown as plain text only, never as HTML. CSV exports escape cells that could run as spreadsheet formulas.</li>
            <li>
              The AI service (Gemini model <span className="font-mono">{env().GEMINI_MODEL}</span>) receives question wording, open-text answers with emails, phone numbers and IP
              addresses removed, mapped closed answers and pseudonymous refs. It never receives payout identities, names, IP addresses or timestamps, and it can only flag answers
              for human review.
            </li>
            <li>Every human and automated decision is kept in an append-only history; ledger rows can never be edited.</li>
          </ul>
        </Section>

        <Section level={2} title="Service status">
          <div className="mb-5 flex items-center gap-5 rounded-md bg-primary-soft p-4">
            <AiAnimation kind="thinking" size={56} once />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Gemini calls today</p>
              <p className="font-mono text-xl font-semibold tabular">
                {usage.calls} <span className="text-sm font-normal text-muted">of {usage.limit}</span>
              </p>
              <div aria-hidden className="mt-2 h-2 overflow-hidden rounded-full bg-surface">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (usage.calls / Math.max(usage.limit, 1)) * 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">Shared across every visitor to protect the free quota. Cached answers cost no calls. When the cap is reached, rule checks still run and unreviewed answers are held, not paid.</p>
            </div>
          </div>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
            <dt className="text-muted">Database</dt>
            <dd>{database.ok ? `Connected · Postgres ${database.serverVersion}` : `Not reachable: ${database.message}`}</dd>
            <dt className="text-muted">PayPal</dt>
            <dd>Sandbox · webhooks {env().PAYPAL_WEBHOOK_ID ? "configured" : "not configured (statuses update by polling)"}</dd>
          </dl>
        </Section>

        {workspace && (
          <Section level={2} title="Reset or delete">
            <div className="space-y-4">
              <ActionForm action={resetSampleStudyAction} className="space-y-1">
                <p className="text-muted">{sample ? "Deletes the sample study (including its sandbox payout records) and creates a fresh copy." : "Creates the sample study in this workspace."}</p>
                <ActionSubmit pendingText="Resetting…">{sample ? "Reset sample study" : "Create sample study"}</ActionSubmit>
              </ActionForm>
              <ActionForm action={deleteWorkspaceAction} className="space-y-2 border-t border-rule pt-4">
                <label htmlFor="confirm" className="block font-semibold">
                  Delete this workspace
                </label>
                <p className="text-sm text-muted">Removes every study, response, decision and ledger entry in it. Type DELETE to confirm.</p>
                {query.error === "confirm" && <p className="text-sm text-dont-pay">Type DELETE in capitals to confirm.</p>}
                <input id="confirm" name="confirm" className={`${inputClass} w-40 font-mono`} autoComplete="off" />
                <ActionSubmit variant="danger" pendingText="Deleting…">
                  Delete workspace
                </ActionSubmit>
              </ActionForm>
            </div>
          </Section>
        )}
      </main>
    </Shell>
  );
}
