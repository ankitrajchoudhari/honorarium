import { MdCancel, MdCheckCircle, MdInfoOutline } from "react-icons/md";
import { Rings } from "@/components/rings";
import { and, asc, count, countDistinct, eq, isNull, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { LocalTime, RuleStamp, tableClass, tdClass, thClass } from "@/components/ui";
import { db } from "@/db/client";
import { checks, decisions, payoutItems, respondents, reviewVotes } from "@/db/schema";
import { decisionCounts, ruleSetVersions, studyImport } from "@/db/queries";
import { getStudyOr404 } from "@/db/study-page";
import { ruleSetSchema } from "@/engine/dsl";
import { maskIdentity } from "@/engine/normalize";
import { readBack } from "@/engine/readback";
import { BUCKET_LABELS, BUCKETS } from "@/ledger/buckets";
import { ledgerStatus } from "@/ledger/ledger";
import { env } from "@/lib/env";
import { formatCents } from "@/lib/money";
import { requireWorkspace } from "@/lib/session";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Ethics report" };

function percent(part: number, whole: number): string {
  return whole === 0 ? "0%" : `${((part / whole) * 100).toFixed(1)}%`;
}

export default async function ReportPage({ params, searchParams }: PageProps<"/studies/[studyId]/report">) {
  const { studyId } = await params;
  const includeIdentities = (await searchParams).identities === "masked";
  const workspace = await requireWorkspace();
  const study = await getStudyOr404(workspace.id, studyId);
  const [versions, imported, counts, ledger] = await Promise.all([ruleSetVersions(study.id), studyImport(study.id), decisionCounts(study.id), ledgerStatus(db(), study.id, study.budgetCents)]);
  const locked = versions.find((version) => version.lockedAt) ?? null;
  const rules = locked ? ruleSetSchema.parse(locked.compiledJson).rules : [];
  const changes = versions.filter((version) => version.changeNote);

  const [byRule, reviewed, overrides, items, aiAssessed, aiNotRun, openVotes, resolvedPairs] = await Promise.all([
    db()
      .select({ ruleId: checks.ruleId, outcome: checks.outcome, total: count() })
      .from(checks)
      .where(and(eq(checks.studyId, study.id), sql`${checks.outcome} in ('exclude', 'review')`))
      .groupBy(checks.ruleId, checks.outcome),
    db()
      .select({ total: countDistinct(decisions.respondentId) })
      .from(decisions)
      .where(and(eq(decisions.studyId, study.id), eq(decisions.source, "reviewer"))),
    db()
      .select({ ref: respondents.respondentRef, decidedBy: decisions.decidedBy, at: decisions.decidedAt, justification: decisions.justification, second: decisions.secondReviewer })
      .from(decisions)
      .innerJoin(respondents, eq(respondents.id, decisions.respondentId))
      .where(and(eq(decisions.studyId, study.id), eq(decisions.isOverride, true)))
      .orderBy(asc(decisions.decidedAt)),
    db()
      .select({ ref: respondents.respondentRef, status: payoutItems.status, receiver: payoutItems.receiver, amount: payoutItems.amountCents })
      .from(payoutItems)
      .innerJoin(respondents, eq(respondents.id, payoutItems.respondentId))
      .where(eq(payoutItems.studyId, study.id))
      .orderBy(asc(respondents.rowNumber)),
    db().select({ total: count() }).from(checks).where(and(eq(checks.studyId, study.id), eq(checks.layer, "ai"))),
    db()
      .select({ total: count() })
      .from(checks)
      .where(and(eq(checks.studyId, study.id), eq(checks.layer, "ai"), sql`${checks.evidenceJson}->'values'->>'status' = 'not_run'`)),
    db().select({ total: countDistinct(reviewVotes.respondentId) }).from(reviewVotes).where(and(eq(reviewVotes.studyId, study.id), isNull(reviewVotes.resolvedDecisionId))),
    db()
      .select({ total: count() })
      .from(decisions)
      .where(and(eq(decisions.studyId, study.id), sql`${decisions.secondReviewer} is not null`)),
  ]);

  const statusCount = (statuses: string[]) => items.filter((item) => statuses.includes(item.status)).length;
  const ruleRows = rules.map((rule) => ({
    rule,
    excluded: byRule.find((row) => row.ruleId === rule.id && row.outcome === "exclude")?.total ?? 0,
    held: byRule.find((row) => row.ruleId === rule.id && row.outcome === "review")?.total ?? 0,
  }));
  const otherFlags = byRule.filter((row) => !rules.some((rule) => rule.id === row.ruleId));
  const total = counts.total;
  const lockedBeforeImport = !imported ? null : locked?.lockedAt ? locked.lockedAt.getTime() <= imported.createdAt.getTime() : false;

  return (
    <article className="mx-auto max-w-4xl space-y-8 rounded-md border border-rule bg-surface p-6 print:border-0 print:p-0">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Use your browser&apos;s Print → Save as PDF to file this report.</p>
        <div className="flex flex-wrap gap-2">
          <Link className="text-sm text-primary hover:underline" href={includeIdentities ? "?" : "?identities=masked"}>
            {includeIdentities ? "Hide payout identities" : "Include masked payout identities"}
          </Link>
          <a className="text-sm text-primary hover:underline" href={`/api/studies/${study.id}/export`}>
            Download decisions (CSV)
          </a>
          <PrintButton />
        </div>
      </div>

      <header className="space-y-1 border-b border-rule pb-4">
        <p className="text-xs uppercase tracking-wide text-muted">Participant payment verification report</p>
        <h1 className="font-serif text-xl font-semibold">{study.title}</h1>
        <p>
          {study.protocolNumber ?? "No protocol number"} · PI {study.piName} · study code <span className="font-mono">{study.shortCode}</span>
        </p>
        {locked && <RuleStamp version={locked.version} sha256={locked.sha256} lockedAt={locked.lockedAt} />}
        <p className="text-xs text-muted">
          Generated <LocalTime date={new Date()} /> by Honorarium. All payments in this report are PayPal sandbox test money.
        </p>
      </header>

      <section aria-labelledby="glance-heading" className="space-y-4">
        <h2 id="glance-heading" className="font-serif text-lg font-semibold">
          At a glance
        </h2>
        <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Rings
            label="Decisions"
            size={170}
            thickness={13}
            center={
              <div>
                <div className="font-mono text-lg font-semibold tabular">{total}</div>
                <div className="text-xs text-muted">responses</div>
              </div>
            }
            rings={[
              { label: "Pay", value: counts.pay, max: total, color: "var(--pay)", display: String(counts.pay) },
              { label: "Hold for review", value: counts.hold, max: total, color: "var(--hold)", display: String(counts.hold) },
              { label: "Don't pay", value: counts.dontPay, max: total, color: "var(--dont-pay)", display: String(counts.dontPay) },
            ]}
          />
          <ul className="space-y-2 text-sm">
            {[
              {
                ok: lockedBeforeImport,
                text: lockedBeforeImport === null ? "No data imported yet." : lockedBeforeImport ? "Rules were locked before any responses were imported." : "Responses were imported before these rules were locked.",
              },
              { ok: ledger.invariant.balanced, text: ledger.invariant.balanced ? "The budget ledger balances to the cent." : "The budget ledger is out of balance." },
              { ok: overrides.length === 0 ? true : null, text: overrides.length === 0 ? "No rule decision was overridden." : `${overrides.length} rule decision${overrides.length === 1 ? " was" : "s were"} overridden by a reviewer (section 4).` },
              { ok: true, text: "AI could only flag answers for review; no payment was denied by AI." },
            ].map((item) => (
              <li key={item.text} className="flex gap-2">
                {item.ok === true ? (
                  <MdCheckCircle size={20} aria-hidden className="mt-0.5 shrink-0 text-pay" />
                ) : item.ok === false ? (
                  <MdCancel size={20} aria-hidden className="mt-0.5 shrink-0 text-dont-pay" />
                ) : (
                  <MdInfoOutline size={20} aria-hidden className="mt-0.5 shrink-0 text-hold" />
                )}
                {item.text}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-serif text-lg font-semibold">1. Consent and rules</h2>
        <p>
          <span className="text-muted">Consent wording:</span> <q>{study.consentTextExcerpt}</q>
        </p>
        {locked ? (
          <>
            <p>
              Rules v{locked.version} were locked <LocalTime date={locked.lockedAt!} /> by {locked.lockedBy}
              {lockedBeforeImport === null ? "; no responses have been imported yet" : lockedBeforeImport ? ", before responses were imported" : ", after responses were imported (see the rule changes below)"}
              {imported ? (
                <>
                  {" "}
                  (import <LocalTime date={imported.createdAt} />)
                </>
              ) : null}
              . SHA-256 <span className="break-all font-mono text-xs">{locked.sha256}</span>.
            </p>
            <ol className="list-decimal space-y-1 pl-5">
              {rules.map((rule) => (
                <li key={rule.id}>
                  <span className="font-mono text-xs text-muted">{rule.id}</span> {readBack(rule)}
                </li>
              ))}
            </ol>
            <p className="text-sm text-muted">Researcher&apos;s wording: <q>{locked.sourceText}</q></p>
          </>
        ) : (
          <p className="text-dont-pay">No rules have been locked.</p>
        )}
        {changes.length > 0 ? (
          <div className="rounded-sm border border-hold p-3">
            <p className="font-semibold text-hold">Rule changes after the first version</p>
            <ul className="list-disc pl-5">
              {changes.map((version) => (
                <li key={version.id}>
                  v{version.version}: {version.changeNote} {version.lockedAt ? <>(locked <LocalTime date={version.lockedAt} />)</> : "(not locked)"}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm">The rules were not changed after locking.</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-serif text-lg font-semibold">2. Outcomes</h2>
        <table className={tableClass}>
          <tbody>
            {[
              ["Responses imported", total],
              ["Pay", counts.pay],
              ["Hold for review (still open)", counts.hold],
              ["Don't pay", `${counts.dontPay} (${percent(counts.dontPay, total)} of responses)`],
              ["Decided by human reviewers", reviewed[0]?.total ?? 0],
              ["Overrides of a rules decision", overrides.length],
              ["Paid (PayPal SUCCESS)", statusCount(["SUCCESS"])],
              ["Unclaimed", statusCount(["UNCLAIMED"])],
              ["In flight", statusCount(["NEW", "PENDING", "ONHOLD", "BLOCKED"])],
              ["Returned, failed or refunded", statusCount(["RETURNED", "FAILED", "REFUNDED", "REVERSED", "NOT_SENT"])],
            ].map(([label, value]) => (
              <tr key={String(label)}>
                <th scope="row" className={`${tdClass} text-left font-normal text-muted`}>{label}</th>
                <td className={`${tdClass} font-mono tabular`}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {study.twoReviewerMode && (
          <p>
            Two-reviewer mode: {resolvedPairs[0]?.total ?? 0} responses resolved by two agreeing reviewers; {openVotes[0]?.total ?? 0} still waiting for a second review or with disagreeing reviewers.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-serif text-lg font-semibold">3. Exclusions and flags by rule</h2>
        <table className={tableClass}>
          <thead>
            <tr>
              <th scope="col" className={thClass}>Rule</th>
              <th scope="col" className={`${thClass} text-right`}>Not paid</th>
              <th scope="col" className={`${thClass} text-right`}>Held for review</th>
            </tr>
          </thead>
          <tbody>
            {ruleRows.map(({ rule, excluded, held }) => (
              <tr key={rule.id}>
                <td className={tdClass}>
                  <span className="font-mono text-xs text-muted">{rule.id}</span> {readBack(rule)}
                </td>
                <td className={`${tdClass} text-right font-mono tabular`}>{excluded}</td>
                <td className={`${tdClass} text-right font-mono tabular`}>{held}</td>
              </tr>
            ))}
            {otherFlags.map((row) => (
              <tr key={`${row.ruleId}-${row.outcome}`}>
                <td className={tdClass}>
                  <span className="font-mono text-xs">{row.ruleId}</span>{" "}
                  <span className="text-muted">{row.ruleId.startsWith("ai:") ? "AI review (flags only, never a reason not to pay)" : row.ruleId.startsWith("similarity:") ? "Near-identical answers" : "Built-in safety check"}</span>
                </td>
                <td className={`${tdClass} text-right font-mono tabular`}>0</td>
                <td className={`${tdClass} text-right font-mono tabular`}>{row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-sm text-muted">A response can match several rules, so rows can add up to more than the total. Only locked rules can stop payment.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-serif text-lg font-semibold">4. Overrides</h2>
        {overrides.length === 0 ? (
          <p>No reviewer overrode a rules decision.</p>
        ) : (
          <ul className="space-y-2">
            {overrides.map((override) => (
              <li key={`${override.ref}-${override.at.toISOString()}`} className="rounded-sm border border-hold p-2">
                <span className="font-mono">{override.ref}</span> paid against a locked rule by {override.decidedBy}
                {override.second ? ` and ${override.second}` : ""} · <LocalTime date={override.at} />
                <p className="mt-1">Justification: {override.justification}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-serif text-lg font-semibold">5. Budget</h2>
        <table className={tableClass}>
          <tbody>
            <tr>
              <th scope="row" className={`${tdClass} text-left font-normal text-muted`}>Budget</th>
              <td className={`${tdClass} font-mono tabular`}>{formatCents(study.budgetCents)}</td>
            </tr>
            {BUCKETS.map((bucket) => (
              <tr key={bucket}>
                <th scope="row" className={`${tdClass} text-left font-normal text-muted`}>{BUCKET_LABELS[bucket]}</th>
                <td className={`${tdClass} font-mono tabular`}>{formatCents(ledger.balances[bucket])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={ledger.invariant.balanced ? "" : "font-semibold text-dont-pay"}>
          Ledger {ledger.invariant.balanced ? "balanced: every cent of the budget is accounted for." : `out of balance by ${formatCents(ledger.invariant.difference)}.`}
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-serif text-lg font-semibold">6. Data sent to the AI service</h2>
        <p>
          Model: <span className="font-mono">{env().GEMINI_MODEL}</span> (Google Gemini API). {aiAssessed[0]?.total ?? 0} open-text answers were reviewed
          {(aiNotRun[0]?.total ?? 0) > 0 ? `; ${aiNotRun[0]?.total} could not be reviewed and were held, not paid` : ""}.
        </p>
        <p className="font-semibold">Sent</p>
        <ul className="list-disc pl-5">
          <li>The researcher&apos;s rule text, once, to compile it into checks (before any data existed).</li>
          <li>For each open-text question: the question wording, each answer with any email addresses, phone numbers and IP addresses removed, and up to four mapped closed answers.</li>
          <li>Pseudonymous respondent refs (R-0001…) so results map back.</li>
        </ul>
        <p className="font-semibold">Never sent</p>
        <ul className="list-disc pl-5">
          <li>Payout emails or phone numbers, names, IP addresses, respondent IDs, user agents or timestamps.</li>
          <li>Answers from responses already excluded by a locked rule.</li>
        </ul>
        <p className="text-sm text-muted">
          The AI can only flag an answer for human review or add a note. It cannot stop a payment. On Google&apos;s free tier, submitted content may be used to improve Google&apos;s
          products; this sample uses synthetic data only.
        </p>
      </section>

      {includeIdentities && (
        <section className="print-break space-y-2">
          <h2 className="font-serif text-lg font-semibold">Appendix: payouts (masked)</h2>
          <table className={tableClass}>
            <thead>
              <tr>
                <th scope="col" className={thClass}>Respondent</th>
                <th scope="col" className={thClass}>Recipient</th>
                <th scope="col" className={thClass}>Amount</th>
                <th scope="col" className={thClass}>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.ref}-${item.status}`}>
                  <td className={`${tdClass} font-mono`}>{item.ref}</td>
                  <td className={`${tdClass} font-mono`}>{maskIdentity(item.receiver)}</td>
                  <td className={`${tdClass} font-mono`}>{formatCents(item.amount)}</td>
                  <td className={`${tdClass} font-mono`}>{item.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </article>
  );
}
