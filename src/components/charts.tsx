"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MiniRing } from "@/components/rings";
import { useHydrated } from "@/lib/use-hydrated";

const TOOLTIP_STYLE = {
  contentStyle: { background: "var(--surface)", border: "1px solid var(--rule)", borderRadius: 12, boxShadow: "var(--shadow)", fontSize: 12, fontWeight: 600, color: "var(--ink)" },
  labelStyle: { color: "var(--muted)", fontWeight: 700, marginBottom: 4 },
  cursor: { stroke: "var(--primary)", strokeWidth: 1, strokeDasharray: "4 4" },
} as const;

const AXIS = { stroke: "var(--muted)", fontSize: 12, tickLine: false, axisLine: false } as const;

export interface TimeBin {
  label: string;
  pay: number;
  hold: number;
  dontPay: number;
}

const SERIES = [
  { key: "dontPay", name: "Don't pay", color: "var(--dont-pay)" },
  { key: "hold", name: "Hold for review", color: "var(--hold)" },
  { key: "pay", name: "Pay", color: "var(--pay)" },
] as const;

/** Submissions per time slot, stacked by decision: a bot burst shows up as a sharp red peak. */
export function SubmissionTimeline({ bins, summary }: { bins: TimeBin[]; summary: string }) {
  const hydrated = useHydrated();
  return (
    <figure role="img" aria-label={summary}>
      <div className="h-60">
        {hydrated && (
          <ResponsiveContainer>
            <AreaChart data={bins} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
              <defs>
                {SERIES.map((series) => (
                  <linearGradient key={series.key} id={`fill-${series.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" style={{ stopColor: series.color, stopOpacity: 0.55 }} />
                    <stop offset="1" style={{ stopColor: series.color, stopOpacity: 0.05 }} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} stroke="var(--rule)" strokeDasharray="3 5" />
              <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={28} />
              <YAxis {...AXIS} allowDecimals={false} />
              <Tooltip {...TOOLTIP_STYLE} />
              {SERIES.map((series) => (
                <Area
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.name}
                  stackId="d"
                  stroke={series.color}
                  strokeWidth={2}
                  fill={`url(#fill-${series.key})`}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted" aria-hidden>
        {[...SERIES].reverse().map((series) => (
          <li key={series.key} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-full" style={{ background: series.color }} />
            {series.name}
          </li>
        ))}
      </ul>
    </figure>
  );
}

export interface ReasonRow {
  label: string;
  exclude: number;
  review: number;
}

/** Each check with a ring showing the share of all responses it flagged, and the split into excluded and held. */
export function CheckList({ rows, total }: { rows: ReasonRow[]; total: number }) {
  return (
    <ul className="divide-y divide-rule">
      {rows.map((row) => {
        const flagged = row.exclude + row.review;
        const excludes = row.exclude >= row.review;
        return (
          <li key={row.label} className="flex items-center gap-3 py-3">
            <MiniRing value={flagged} max={total} color={excludes ? "var(--dont-pay)" : "var(--hold)"} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{row.label}</p>
              <p className="text-xs text-muted">
                {row.exclude > 0 && <span className="text-dont-pay">{row.exclude} excluded</span>}
                {row.exclude > 0 && row.review > 0 && " · "}
                {row.review > 0 && <span className="text-hold">{row.review} sent to review</span>}
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-md font-semibold tabular">{flagged}</p>
              <p className="font-mono text-xs text-muted tabular">{total > 0 ? Math.round((flagged / total) * 100) : 0}%</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
