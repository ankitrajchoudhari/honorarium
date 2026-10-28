"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { useMemo, useState } from "react";
import { MdClose, MdSearch } from "react-icons/md";
import { AiIntro } from "@/components/ai-intro";
import { CheckList, SubmissionTimeline, type ReasonRow, type TimeBin } from "@/components/charts";
import { Rings } from "@/components/rings";
import { DataGrid } from "@/components/data-grid";
import { RespondentActions } from "@/components/respondent-actions";
import { RespondentEvidence, useRespondent } from "@/components/respondent-evidence";
import { Card, DecisionChip, DECISION_META, inputClass, LinkButton, Notice } from "@/components/ui";
import type { Decision } from "@/engine/types";
import type { JobState } from "@/jobs/verify";
import { JobRunner } from "./job-runner";

export interface ResultRow {
  ref: string;
  submittedAt: string | null;
  durationSeconds: number | null;
  decision: Decision | null;
  source: string | null;
  topReason: string;
  reasonCount: number;
}

interface Props {
  studyId: string;
  results: ResultRow[];
  counts: { pay: number; hold: number; dontPay: number; undecided: number; total: number };
  reasons: ReasonRow[];
  timeline: TimeBin[];
  initialJob: JobState | null;
  ruleVersion: number;
  jobRuleVersion: number | null;
}

function duration(seconds: number | null): string {
  if (seconds === null) {
    return "";
  }
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${String(Math.round(seconds % 60)).padStart(2, "0")}s` : `${Math.round(seconds)}s`;
}

const TILE_BAR: Record<Decision, string> = { pay: "bg-pay", hold: "bg-hold", dont_pay: "bg-dont-pay" };

const COLUMNS: ColDef<ResultRow>[] = [
  { field: "ref", headerName: "Respondent", width: 120, cellClass: "font-mono" },
  {
    field: "submittedAt",
    headerName: "Submitted",
    width: 170,
    valueFormatter: (params) => (params.value ? new Date(params.value as string).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" }) : ""),
  },
  { field: "durationSeconds", headerName: "Duration", width: 110, valueFormatter: (params) => duration(params.value as number | null), cellClass: "font-mono" },
  {
    field: "decision",
    headerName: "Decision",
    width: 170,
    cellRenderer: (params: ICellRendererParams<ResultRow>) => <DecisionChip decision={params.data?.decision ?? null} />,
    comparator: (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? ""),
  },
  {
    field: "topReason",
    headerName: "Top reason",
    flex: 1,
    minWidth: 260,
    valueFormatter: (params) => {
      const row = params.data;
      if (!row) {
        return "";
      }
      const extra = row.reasonCount > 1 ? ` (+${row.reasonCount - 1})` : "";
      const reviewer = row.source === "reviewer" ? " · decided by reviewer" : row.source === "payout" ? " · after payout" : "";
      return `${row.topReason}${extra}${reviewer}`;
    },
  },
];

export function VerifyView({ studyId, results, counts, reasons, timeline, initialJob, ruleVersion, jobRuleVersion }: Props) {
  const [filter, setFilter] = useState<Decision | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const { detail, error, reload } = useRespondent(studyId, open);

  const rows = useMemo(() => (filter ? results.filter((row) => row.decision === filter) : results), [results, filter]);
  const decided = counts.total - counts.undecided;
  const stale = jobRuleVersion !== null && jobRuleVersion !== ruleVersion;

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <AiIntro />
      </div>
      <JobRunner studyId={studyId} initial={initialJob} autoStart={initialJob === null} />
      {stale && <Notice tone="warning" title={`Rules v${ruleVersion} are now locked`}>These results came from v{jobRuleVersion}. Run verification again to apply the new rules.</Notice>}

      {decided > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-3" aria-live="polite">
            {(["pay", "hold", "dont_pay"] as const).map((decision) => {
              const value = decision === "pay" ? counts.pay : decision === "hold" ? counts.hold : counts.dontPay;
              const meta = DECISION_META[decision];
              const active = filter === decision;
              const percent = counts.total > 0 ? Math.round((value / counts.total) * 100) : 0;
              return (
                <button
                  key={decision}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(active ? null : decision)}
                  className={`touch-target relative overflow-hidden rounded-lg border bg-surface p-5 text-left transition-colors duration-150 hover:bg-subtle ${active ? "border-primary ring-2 ring-primary" : "border-rule"}`}
                >
                  <span aria-hidden className={`absolute inset-x-0 top-0 h-1 ${TILE_BAR[decision]}`} />
                  <span className={`flex items-center gap-1.5 text-sm font-bold ${meta.color}`}>
                    <meta.Icon size={18} aria-hidden /> {meta.label}
                  </span>
                  <span className="mt-2 flex items-baseline gap-2">
                    <span className="font-mono text-[32px] font-semibold leading-none tabular">{value}</span>
                    <span className="font-mono text-sm text-muted tabular">{percent}%</span>
                  </span>
                  <span aria-hidden className="mt-3 block h-1.5 overflow-hidden rounded-full bg-subtle">
                    <span className={`block h-full rounded-full ${TILE_BAR[decision]}`} style={{ width: `${percent}%` }} />
                  </span>
                  <span className="mt-2 block text-xs text-muted">{active ? "Filtering the table. Select again to show all." : "Select to filter the table"}</span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Card title="Decision split" description="Each ring is that decision's share of all responses.">
              <Rings
                label="Decision split"
                size={220}
                thickness={14}
                center={
                  <div>
                    <div className="font-mono text-xl font-semibold tabular">{counts.total.toLocaleString("en-US")}</div>
                    <div className="text-xs font-semibold text-muted">responses</div>
                  </div>
                }
                rings={[
                  { label: "Pay", value: counts.pay, max: counts.total, color: "var(--pay)", display: String(counts.pay) },
                  { label: "Hold for review", value: counts.hold, max: counts.total, color: "var(--hold)", display: String(counts.hold) },
                  { label: "Don't pay", value: counts.dontPay, max: counts.total, color: "var(--dont-pay)", display: String(counts.dontPay) },
                ]}
              />
            </Card>
            <Card title="When responses arrived" description="Submissions per time slot in UTC, stacked by decision. A sharp red peak is a burst of automated submissions.">
              <SubmissionTimeline
                bins={timeline}
                summary={`Submissions over time in ${timeline.length} time slots. The busiest slot had ${Math.max(0, ...timeline.map((bin) => bin.pay + bin.hold + bin.dontPay))} submissions.`}
              />
            </Card>
          </div>

          {reasons.length > 0 && (
            <Card title="What each check found" description="One response can be flagged by several checks, so these add up to more than the number of responses.">
              <CheckList rows={reasons} total={counts.total} />
            </Card>
          )}

          {counts.hold > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hold/30 bg-hold-soft px-5 py-4">
              <span>
                {counts.hold} response{counts.hold === 1 ? " needs" : "s need"} a decision before {counts.hold === 1 ? "it" : "they"} can be paid.
              </span>
              <LinkButton href={`/studies/${studyId}/review`} variant="primary">
                Review held responses
              </LinkButton>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="search" className="sr-only">
              Search responses
            </label>
            <div className="relative w-full max-w-xs">
              <MdSearch size={20} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input id="search" type="search" placeholder="Search refs, reasons…" className={`${inputClass} rounded-full pl-10`} value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <span className="text-sm text-muted">
              {rows.length} of {results.length} shown · click or press Enter on a row for the evidence
            </span>
          </div>
          <DataGrid label="Verification results" rows={rows} columns={COLUMNS} rowId={(row) => row.ref} quickFilter={search} onRowOpen={(row) => setOpen(row.ref)} />
        </>
      )}

      <Dialog.Root open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20" />
          <Dialog.Content className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl overflow-y-auto border-l border-rule bg-paper p-4 shadow-pop focus:outline-none">
            <div className="mb-3 flex items-center justify-between">
              <Dialog.Title className="font-semibold">Evidence</Dialog.Title>
              <Dialog.Close className="touch-target rounded-sm p-1 hover:bg-subtle" aria-label="Close">
                <MdClose size={20} aria-hidden />
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">Every check, its evidence and the decision history for this respondent.</Dialog.Description>
            {error && <Notice tone="error" title="Could not load this respondent">{error}</Notice>}
            {!detail && !error && <p className="text-muted">Loading evidence…</p>}
            {detail && (
              <div className="space-y-4">
                <RespondentActions studyId={studyId} detail={detail} onChanged={reload} />
                <RespondentEvidence studyId={studyId} detail={detail} />
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
