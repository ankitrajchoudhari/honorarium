import { and, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { MdCheckCircle, MdErrorOutline } from "react-icons/md";
import { Rings } from "@/components/rings";
import { BalanceCard, Button, Card, inputClass, LocalTime, PageTitle, tableClass, tdClass, thClass } from "@/components/ui";
import { db } from "@/db/client";
import { ledgerEntries, respondents } from "@/db/schema";
import { getStudyOr404 } from "@/db/study-page";
import { BUCKET_LABELS, BUCKETS, type Bucket } from "@/ledger/buckets";
import { ledgerStatus } from "@/ledger/ledger";
import { formatCents } from "@/lib/money";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "Ledger" };

const LIMIT = 500;

function bucketLabel(bucket: string): string {
  return bucket === "budget" ? "Budget" : (BUCKET_LABELS[bucket as Bucket] ?? bucket);
}

export default async function LedgerPage({ params, searchParams }: PageProps<"/studies/[studyId]/ledger">) {
  const { studyId } = await params;
  const query = await searchParams;
  const filterRef = typeof query.ref === "string" ? query.ref.trim().toUpperCase() : "";
  const workspace = await requireWorkspace();
  const study = await getStudyOr404(workspace.id, studyId);
  const ledger = await ledgerStatus(db(), study.id, study.budgetCents);
  const entries = await db()
    .select({ entry: ledgerEntries, ref: respondents.respondentRef })
    .from(ledgerEntries)
    .leftJoin(respondents, eq(respondents.id, ledgerEntries.respondentId))
    .where(filterRef ? and(eq(ledgerEntries.studyId, study.id), eq(respondents.respondentRef, filterRef)) : eq(ledgerEntries.studyId, study.id))
    .orderBy(desc(ledgerEntries.createdAt))
    .limit(LIMIT);
  const sum = BUCKETS.map((bucket) => formatCents(ledger.balances[bucket])).join(" + ");

  return (
    <div className="space-y-6">
      <PageTitle description="Every movement of money is an append-only entry. Rows are never edited or deleted.">Budget ledger</PageTitle>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <BalanceCard label="Study budget" amount={formatCents(study.budgetCents)}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-on-navy/70">Paid</dt>
              <dd className="font-mono text-lg font-semibold tabular">{formatCents(ledger.balances.paid)}</dd>
            </div>
            <div>
              <dt className="text-on-navy/70">Unallocated</dt>
              <dd className="font-mono text-lg font-semibold tabular">{formatCents(ledger.balances.unallocated)}</dd>
            </div>
          </dl>
          <div aria-live="polite" className="mt-5 rounded-md bg-white/10 px-4 py-3">
            <p className="flex items-center gap-2 font-bold">
              {ledger.invariant.balanced ? <MdCheckCircle size={20} aria-hidden /> : <MdErrorOutline size={20} aria-hidden />}
              {ledger.invariant.balanced ? "The books balance" : `Out of balance by ${formatCents(ledger.invariant.difference)}`}
            </p>
            <p className="mt-1 font-mono text-xs text-on-navy/80 tabular">
              {formatCents(study.budgetCents)} {ledger.invariant.balanced ? "=" : "≠"} {sum}
            </p>
            <p className="mt-1 text-xs text-on-navy/70">budget = unallocated + allocated + held + in flight + paid + unclaimed + withheld · checked inside every write</p>
          </div>
        </BalanceCard>
        <Card title="Where the budget is" description="Each ring is one bucket's share of the budget.">
          <Rings
            label="Budget by ledger bucket"
            size={210}
            thickness={13}
            rings={[
              { label: "Paid", value: ledger.balances.paid, max: study.budgetCents, color: "var(--pay)", display: formatCents(ledger.balances.paid) },
              { label: "In flight", value: ledger.balances.in_flight, max: study.budgetCents, color: "var(--in-flight)", display: formatCents(ledger.balances.in_flight) },
              { label: "Unclaimed", value: ledger.balances.unclaimed, max: study.budgetCents, color: "var(--unclaimed)", display: formatCents(ledger.balances.unclaimed) },
              { label: "Allocated to pay", value: ledger.balances.allocated_pay, max: study.budgetCents, color: "var(--primary)", display: formatCents(ledger.balances.allocated_pay) },
              { label: "Held for review", value: ledger.balances.held_review, max: study.budgetCents, color: "var(--hold)", display: formatCents(ledger.balances.held_review) },
              { label: "Unallocated", value: ledger.balances.unallocated, max: study.budgetCents, color: "var(--muted)", display: formatCents(ledger.balances.unallocated) },
            ]}
          />
        </Card>
      </div>

      <form className="flex flex-wrap items-end gap-2" role="search">
        <div>
          <label htmlFor="ref" className="block text-sm font-semibold">
            Filter by respondent
          </label>
          <input id="ref" name="ref" defaultValue={filterRef} placeholder="R-0042" className={`${inputClass} w-40 font-mono`} />
        </div>
        <Button type="submit">Filter</Button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
        <table className={tableClass}>
          <caption className="px-2 py-1.5 text-left text-xs text-muted">
            {entries.length === LIMIT ? `Latest ${LIMIT} entries` : `${entries.length} entries`}
            {filterRef ? ` for ${filterRef}` : ""}
          </caption>
          <thead>
            <tr>
              <th scope="col" className={thClass}>Time</th>
              <th scope="col" className={thClass}>From → to</th>
              <th scope="col" className={`${thClass} text-right`}>Amount</th>
              <th scope="col" className={thClass}>Respondent</th>
              <th scope="col" className={thClass}>Reason</th>
              <th scope="col" className={thClass}>Source event</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(({ entry, ref }) => (
              <tr key={entry.id}>
                <td className={`${tdClass} whitespace-nowrap`}>
                  <LocalTime date={entry.createdAt} withSeconds />
                </td>
                <td className={`${tdClass} whitespace-nowrap`}>
                  {bucketLabel(entry.fromBucket)} → {bucketLabel(entry.toBucket)}
                </td>
                <td className={`${tdClass} text-right font-mono tabular`}>{formatCents(entry.amountCents)}</td>
                <td className={`${tdClass} font-mono`}>{ref ?? ""}</td>
                <td className={tdClass}>{entry.reason}</td>
                <td className={`${tdClass} font-mono text-xs`}>{entry.sourceEvent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
