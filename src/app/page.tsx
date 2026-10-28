import Link from "next/link";
import { MdAdd, MdArrowForward, MdChevronRight } from "react-icons/md";
import { openSampleStudyAction } from "@/app/actions/studies";
import { PendingButton } from "@/components/pending-button";
import { MiniRing } from "@/components/rings";
import { Shell } from "@/components/shell";
import { BalanceCard, Card, LinkButton, LocalTime } from "@/components/ui";
import { listStudies } from "@/db/queries";
import { formatCents } from "@/lib/money";
import { currentWorkspace } from "@/lib/session";

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
  { title: "Lock the rules", text: "Write exclusion rules in plain English. Gemini compiles them into exact checks, and you lock them before seeing any data." },
  { title: "Verify every response", text: "Rule checks, near-duplicate detection and AI review sort each respondent into Pay, Hold for review or Don't pay." },
  { title: "Decide the holds", text: "A person reviews each hold with the evidence. AI can flag a response, but it can never deny payment." },
  { title: "Pay through PayPal", text: "The PI approves one batch, PayPal Payouts sends it, and the ledger accounts for every cent." },
];

function SampleButton({ onNavy }: { onNavy: boolean }) {
  return (
    <form action={openSampleStudyAction}>
      <PendingButton variant="primary" className={onNavy ? "bg-white! text-navy! hover:bg-primary-soft!" : ""} pendingText="Setting up the sample study…">
        Open the sample study <MdArrowForward size={18} aria-hidden />
      </PendingButton>
    </form>
  );
}

function initials(code: string): string {
  return code.replace(/[^A-Z0-9]/g, "").slice(0, 2);
}

export default async function Home() {
  const workspace = await currentWorkspace();
  const rows = workspace ? await listStudies(workspace.id) : [];
  const hasSample = rows.some((row) => row.study.isSample);
  const budget = rows.reduce((sum, row) => sum + row.study.budgetCents, 0);
  const responses = rows.reduce((sum, row) => sum + row.respondents, 0);

  return (
    <Shell>
      <main id="main" className="mx-auto max-w-[1280px] space-y-6 px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Studies</h1>
            <p className="mt-1 text-md text-muted">Verify study responses, then pay real participants through PayPal.</p>
          </div>
          {rows.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {!hasSample && <SampleButton onNavy={false} />}
              <LinkButton href="/studies/new" variant="secondary">
                <MdAdd size={18} aria-hidden /> New study
              </LinkButton>
            </div>
          )}
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          {rows.length === 0 ? (
            <section className="relative overflow-hidden rounded-lg bg-navy p-8 text-on-navy">
              <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full border-[36px] border-white/[0.06]" />
              <div aria-hidden className="pointer-events-none absolute -bottom-28 right-32 h-56 w-56 rounded-full border-[26px] border-white/[0.04]" />
              <div className="relative max-w-lg space-y-4">
                <p className="text-sm font-semibold text-on-navy/75">Get started</p>
                <h2 className="text-xl font-extrabold leading-snug sm:text-2xl">Open links attract bots. Pay only the people who took part.</h2>
                <p className="text-on-navy/80">
                  The sample study has 518 synthetic responses from an open survey link, including a burst of 300 bot submissions. Its rules are already locked, so
                  verification starts right away.
                </p>
                <div className="flex flex-wrap gap-3 pt-1">
                  <SampleButton onNavy />
                  <LinkButton href="/studies/new" className="border-white/70! bg-transparent! text-on-navy! hover:bg-white/10!">
                    <MdAdd size={18} aria-hidden /> New study
                  </LinkButton>
                </div>
              </div>
            </section>
          ) : (
            <BalanceCard label="Total study budget" amount={formatCents(budget)}>
              <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                <div>
                  <dt className="text-on-navy/70">Studies</dt>
                  <dd className="font-mono text-lg font-semibold tabular">{rows.length}</dd>
                </div>
                <div>
                  <dt className="text-on-navy/70">Responses imported</dt>
                  <dd className="font-mono text-lg font-semibold tabular">{responses.toLocaleString("en-US")}</dd>
                </div>
                <div>
                  <dt className="text-on-navy/70">Decided to pay</dt>
                  <dd className="font-mono text-lg font-semibold tabular">{rows.reduce((sum, row) => sum + row.pay, 0)}</dd>
                </div>
              </dl>
            </BalanceCard>
          )}

          <Card title="How it works" level={2}>
            <ol className="space-y-4">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-primary font-mono text-xs font-bold text-primary">{index + 1}</span>
                  <div>
                    <p className="font-bold">{step.title}</p>
                    <p className="text-sm text-muted">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

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
                    <span className="font-mono text-sm font-semibold tabular">{respondents} responses</span>
                    <MdChevronRight size={22} aria-hidden className="shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </Shell>
  );
}
