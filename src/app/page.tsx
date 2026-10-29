import Link from "next/link";
import { MdAdd, MdArrowForward, MdChevronRight } from "react-icons/md";
import { openSampleStudyAction } from "@/app/actions/studies";
import { AiAnimation } from "@/components/ai-animation";
import { ActionForm, ActionSubmit } from "@/components/action-form";
import { MiniRing } from "@/components/rings";
import { Shell } from "@/components/shell";
import { LinkButton, LocalTime, PaymentCard } from "@/components/ui";
import { listStudies } from "@/db/queries";
import { formatCents } from "@/lib/money";
import { currentWorkspace } from "@/lib/session";
import { sampleStudySummary } from "@/studies/sample";

const STATUS_TEXT: Record<string, string> = {
  draft: "Writing rules",
  rules_locked: "Rules locked",
  data_imported: "Data imported",
  verifying: "Verifying",
  reviewing: "Reviewing",
  paying: "Paying",
  closed: "Closed",
};

const STEPS = [
  { ai: true, title: "Lock the rules", text: "Plain-English exclusion rules, compiled by Gemini into exact checks and locked before you see any data." },
  { ai: true, title: "Verify every response", text: "Rule checks, near-duplicate detection and AI review sort each respondent into Pay, Hold or Don't pay." },
  { ai: false, title: "Decide the holds", text: "A person reviews each hold with the evidence. AI can flag a response, but never deny payment." },
  { ai: false, title: "Pay through PayPal", text: "The PI approves one batch, PayPal Payouts sends it, and the ledger accounts for every cent." },
];

function SampleButton() {
  return (
    <ActionForm action={openSampleStudyAction}>
      <ActionSubmit variant="primary" pendingText="Setting up the sample study…">
        Open the sample study <MdArrowForward size={18} aria-hidden />
      </ActionSubmit>
    </ActionForm>
  );
}

function initials(code: string): string {
  return code.replace(/[^A-Z0-9]/g, "").slice(0, 2);
}

function Tile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-rule bg-surface p-5">
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${accent}`} />
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className="mt-1 font-mono text-[28px] font-semibold leading-none tabular">{value}</p>
    </div>
  );
}

async function EmptyState() {
  const sample = await sampleStudySummary();
  return (
    <section className="grid items-center gap-8 rounded-lg border border-rule bg-surface p-6 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)] md:p-8">
      <PaymentCard
        label="Sample study budget"
        amount={formatCents(sample.budgetCents)}
        facts={[
          { label: "Responses", value: sample.responses.toLocaleString("en-US") },
          { label: "Per participant", value: formatCents(sample.amountPerParticipantCents) },
        ]}
      />
      <div className="space-y-4">
        <p className="text-sm font-bold uppercase tracking-wide text-primary">Try it in two clicks</p>
        <h2 className="text-xl font-extrabold leading-snug">Open links attract bots. Pay only the people who took part.</h2>
        <p className="text-muted">
          The sample study has {sample.responses} synthetic responses from an open survey link, including a burst of {sample.botBurst} bot submissions. Its rules are already
          locked, so verification starts right away.
        </p>
        <SampleButton />
      </div>
    </section>
  );
}

export default async function Home() {
  const workspace = await currentWorkspace();
  const rows = workspace ? await listStudies(workspace.id) : [];
  const hasSample = rows.some((row) => row.study.isSample);
  const total = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((sum, row) => sum + pick(row), 0);

  return (
    <Shell>
      <main id="main" className="mx-auto max-w-[1280px] space-y-8 px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Studies</h1>
            <p className="mt-1 text-md text-muted">Verify study responses, then pay real participants through PayPal.</p>
          </div>
          {rows.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {!hasSample && <SampleButton />}
              <LinkButton href="/studies/new" variant="secondary">
                <MdAdd size={18} aria-hidden /> New study
              </LinkButton>
            </div>
          )}
        </div>

        {rows.length === 0 ? (
          <EmptyState />
        ) : (
          <section aria-label="Workspace summary" className="grid items-center gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
            <PaymentCard
              label="Total study budget"
              amount={formatCents(total((row) => row.study.budgetCents))}
              facts={[
                { label: rows.length === 1 ? "Study" : "Studies", value: String(rows.length) },
                { label: "Responses", value: total((row) => row.respondents).toLocaleString("en-US") },
              ]}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Tile label="Decided to pay" value={String(total((row) => row.pay))} accent="bg-pay" />
              <Tile label="Held for review" value={String(total((row) => row.hold))} accent="bg-hold" />
              <Tile label="Don't pay" value={String(total((row) => row.dontPay))} accent="bg-dont-pay" />
              <Tile label="Responses imported" value={total((row) => row.respondents).toLocaleString("en-US")} accent="bg-primary" />
            </div>
          </section>
        )}

        {rows.length > 0 && (
          <section aria-labelledby="studies-heading" className="rounded-lg border border-rule bg-surface">
            <h2 id="studies-heading" className="border-b border-rule px-6 py-4 text-md font-bold">
              Your studies
            </h2>
            <ul className="divide-y divide-rule">
              {rows.map(({ study, respondents, pay, hold, dontPay }) => (
                <li key={study.id}>
                  <Link href={`/studies/${study.id}/verify`} className="group flex items-center gap-4 px-6 py-4 transition-colors duration-150 hover:bg-subtle">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary-soft font-mono text-sm font-bold text-primary">{initials(study.shortCode)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold group-hover:text-primary">{study.title}</p>
                      <p className="truncate text-sm text-muted">
                        <span className="font-mono">{study.shortCode}</span>
                        {study.isSample ? " · sample" : ""} · {STATUS_TEXT[study.status]} · <LocalTime date={study.updatedAt} />
                      </p>
                    </div>
                    {respondents > 0 && (
                      <div className="hidden items-center gap-6 md:flex">
                        {[
                          { label: "Pay", value: pay, color: "var(--pay)" },
                          { label: "Hold", value: hold, color: "var(--hold)" },
                          { label: "Don't pay", value: dontPay, color: "var(--dont-pay)" },
                        ].map((entry) => (
                          <div key={entry.label} className="flex items-center gap-2">
                            <MiniRing value={entry.value} max={respondents} color={entry.color} size={30} />
                            <div className="leading-tight">
                              <p className="font-mono text-sm font-semibold tabular">{entry.value}</p>
                              <p className="text-xs text-muted">{entry.label}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <span className="hidden font-mono text-sm font-semibold tabular sm:inline">{respondents} responses</span>
                    <MdChevronRight size={22} aria-hidden className="shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="how-heading">
          <h2 id="how-heading" className="mb-4 text-md font-bold">
            How it works
          </h2>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="rounded-lg border border-rule bg-surface p-5">
                <div className="flex items-center justify-between">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-navy font-mono text-sm font-bold text-on-navy">{index + 1}</span>
                  {step.ai && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                      <AiAnimation kind="thinking" size={32} once /> Gemini
                    </span>
                  )}
                </div>
                <p className="mt-3 font-bold">{step.title}</p>
                <p className="mt-1 text-sm text-muted">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </Shell>
  );
}
