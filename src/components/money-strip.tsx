"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import type { Balances, Bucket } from "@/ledger/buckets";
import { BUCKET_LABELS } from "@/ledger/buckets";
import { formatCents } from "@/lib/money";

const ORDER: { bucket: Bucket; color: string }[] = [
  { bucket: "paid", color: "bg-pay" },
  { bucket: "in_flight", color: "bg-in-flight" },
  { bucket: "unclaimed", color: "bg-unclaimed" },
  { bucket: "allocated_pay", color: "bg-primary" },
  { bucket: "held_review", color: "bg-hold" },
  { bucket: "withheld", color: "bg-dont-pay" },
  { bucket: "unallocated", color: "bg-unallocated" },
];

/** The ledger buckets as one bar that always sums to the budget, with exact amounts on hover/focus and in the legend. */
export function MoneyStrip({ balances, budgetCents, size = "thin" }: { balances: Balances; budgetCents: number; size?: "thin" | "large" }) {
  const segments = ORDER.filter((entry) => balances[entry.bucket] > 0);
  return (
    <Tooltip.Provider delayDuration={100}>
      <div className="space-y-2.5">
        <div
          role="group"
          aria-label={`Budget ${formatCents(budgetCents)}: ${ORDER.map((entry) => `${BUCKET_LABELS[entry.bucket]} ${formatCents(balances[entry.bucket])}`).join(", ")}`}
          className={`flex w-full gap-[2px] overflow-hidden rounded-full bg-subtle shadow-[inset_0_1px_2px_rgb(0_0_0/0.08)] ${size === "large" ? "h-5" : "h-2.5"}`}
        >
          {segments.map((entry) => (
            <Tooltip.Root key={entry.bucket}>
              <Tooltip.Trigger asChild>
                <span
                  role="img"
                  tabIndex={0}
                  aria-label={`${BUCKET_LABELS[entry.bucket]} ${formatCents(balances[entry.bucket])}`}
                  className={`${entry.color} h-full transition-[width] duration-150 ease-out focus-visible:outline-offset-0`}
                  style={{ width: `${(balances[entry.bucket] / Math.max(budgetCents, 1)) * 100}%` }}
                />
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content sideOffset={6} className="rounded-sm bg-navy px-3 py-1.5 text-xs font-semibold text-on-navy shadow-pop">
                  {BUCKET_LABELS[entry.bucket]} <span className="font-mono tabular">{formatCents(balances[entry.bucket])}</span>
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          ))}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 pt-1 sm:grid-cols-4 lg:grid-cols-7">
          {ORDER.filter((entry) => entry.bucket !== "withheld" || balances.withheld > 0).map((entry) => {
            const empty = balances[entry.bucket] === 0;
            return (
              <div key={entry.bucket} className={`min-w-0 ${empty ? "opacity-55" : ""}`}>
                <dt className="flex items-center gap-1.5 truncate text-xs text-muted">
                  <span aria-hidden className={`h-3 w-1 shrink-0 rounded-full ${entry.color}`} />
                  {BUCKET_LABELS[entry.bucket]}
                </dt>
                <dd className="mt-0.5 font-mono text-sm font-semibold tabular">{formatCents(balances[entry.bucket])}</dd>
              </div>
            );
          })}
          <div className="min-w-0 lg:border-l lg:border-rule lg:pl-4">
            <dt className="truncate text-xs font-semibold text-muted">Budget</dt>
            <dd className="mt-0.5 font-mono text-sm font-bold tabular">{formatCents(budgetCents)}</dd>
          </div>
        </dl>
      </div>
    </Tooltip.Provider>
  );
}
