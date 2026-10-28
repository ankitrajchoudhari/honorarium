"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { MdCancel, MdCheckCircle, MdRefresh } from "react-icons/md";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { approvePayoutAction, cancelUnclaimedAction, refreshStatusesAction, retrySendAction, type PayoutActionResult } from "@/app/actions/payouts";
import { Rings } from "@/components/rings";
import { DataGrid } from "@/components/data-grid";
import { Button, inputClass, LinkButton, LocalTime, Notice, Section, tableClass, tdClass, thClass } from "@/components/ui";
import type { PreflightCheck } from "@/payouts/preflight";
import { formatCents } from "@/lib/money";

export interface BatchView {
  id: string;
  number: number;
  senderBatchId: string;
  paypalBatchId: string | null;
  status: string;
  itemCount: number;
  totalCents: number;
  approvedBy: string;
  approvedAt: string;
  reason: string | null;
  debugId: string | null;
  /** Saved but never reached PayPal (e.g. the server stopped mid-request); safe to resend with the same ids. */
  stuck: boolean;
}

export interface ItemView {
  id: string;
  ref: string;
  batchNumber: number;
  batchStatus: string;
  receiver: string;
  recipientType: string;
  amountCents: number;
  status: string;
  final: boolean;
  lastEventAt: string | null;
  paypalItemId: string | null;
  daysLeft: number | null;
  reason: string | null;
}

interface Props {
  studyId: string;
  shortCode: string;
  amountCents: number;
  holds: number;
  preflight: {
    ready: boolean;
    checks: PreflightCheck[];
    totalCents: number;
    count: number;
    batchCount: number;
    skipped: { ref: string; reason: string }[];
    sample: { ref: string; receiver: string; type: string }[];
  };
  unallocatedCents: number;
  heldCents: number;
  balanced: boolean;
  subject: string;
  note: string;
  batches: BatchView[];
  items: ItemView[];
  nonce: string;
  defaultApprover: string;
}

const STATUS_STYLE: Record<string, string> = {
  SUCCESS: "border-pay text-pay",
  UNCLAIMED: "border-unclaimed text-unclaimed",
  PENDING: "border-in-flight text-in-flight",
  NEW: "border-in-flight text-in-flight",
  ONHOLD: "border-hold text-hold",
  BLOCKED: "border-hold text-hold",
  FAILED: "border-dont-pay text-dont-pay",
  RETURNED: "border-dont-pay text-dont-pay",
  REFUNDED: "border-dont-pay text-dont-pay",
  REVERSED: "border-dont-pay text-dont-pay",
  NOT_SENT: "border-dont-pay text-dont-pay",
};

const STATUS_LABEL: Record<string, string> = {
  NEW: "Sending",
  PENDING: "In flight",
  ONHOLD: "On hold at PayPal",
  UNCLAIMED: "Unclaimed",
  SUCCESS: "Paid",
  FAILED: "Failed",
  RETURNED: "Returned",
  BLOCKED: "Blocked",
  REFUNDED: "Refunded",
  REVERSED: "Reversed",
  NOT_SENT: "Not sent",
};

export function StatusChip({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLE[status] ?? "border-rule text-muted"}`}>
      {STATUS_LABEL[status] ?? status}
      <span className="ml-1 font-mono font-normal opacity-80">{status}</span>
    </span>
  );
}

const AUTO_REFRESH_MS = 20_000;

const STATUS_SLICES = [
  { name: "Paid", color: "var(--pay)", statuses: ["SUCCESS"] },
  { name: "Unclaimed", color: "var(--unclaimed)", statuses: ["UNCLAIMED"] },
  { name: "In flight", color: "var(--in-flight)", statuses: ["NEW", "PENDING", "ONHOLD", "BLOCKED"] },
  { name: "Failed or returned", color: "var(--dont-pay)", statuses: ["FAILED", "RETURNED", "REFUNDED", "REVERSED", "NOT_SENT"] },
];

export function PayoutsView(props: Props) {
  const router = useRouter();
  const [approver, setApprover] = useState(props.defaultApprover);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<PayoutActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  // The nonce changes once a batch is saved, so a later batch (or a retry after an error) can be approved without reloading.
  const [submittedNonce, setSubmittedNonce] = useState<string | null>(null);
  const submitted = submittedNonce === props.nonce;
  const [cancelling, setCancelling] = useState<ItemView | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  const live = props.items.some((item) => !item.final) && props.batches.some((batch) => batch.paypalBatchId);

  const refresh = useCallback(() => {
    startTransition(async () => {
      const outcome = await refreshStatusesAction(props.studyId);
      setLastRefresh(new Date().toLocaleTimeString(undefined, { timeZoneName: "short" }));
      if (!outcome.ok) {
        setResult(outcome);
      }
      router.refresh();
    });
  }, [props.studyId, router]);

  useEffect(() => {
    if (!live) {
      return;
    }
    const timer = window.setInterval(refresh, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [live, refresh]);

  const run = (action: () => Promise<PayoutActionResult>) =>
    startTransition(async () => {
      const outcome = await action();
      setResult(outcome);
      router.refresh();
    });

  const approve = () => {
    setSubmittedNonce(props.nonce);
    startTransition(async () => {
      const outcome = await approvePayoutAction(props.studyId, { approver, code, nonce: props.nonce });
      setResult(outcome);
      if (!outcome.ok) {
        setSubmittedNonce(null);
      }
      router.refresh();
    });
  };

  const columns: ColDef<ItemView>[] = [
    { field: "ref", headerName: "Respondent", width: 120, cellClass: "font-mono" },
    { field: "receiver", headerName: "Recipient", width: 170, cellClass: "font-mono" },
    { field: "amountCents", headerName: "Amount", width: 100, valueFormatter: (params) => formatCents(params.value as number), cellClass: "font-mono" },
    { field: "status", headerName: "PayPal status", width: 190, cellRenderer: (params: ICellRendererParams<ItemView>) => <StatusChip status={params.data?.status ?? ""} /> },
    {
      field: "lastEventAt",
      headerName: "Last event",
      width: 170,
      valueFormatter: (params) => (params.value ? new Date(params.value as string).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }) : ""),
    },
    {
      headerName: "Detail",
      flex: 1,
      minWidth: 260,
      valueGetter: (params) => {
        const item = params.data;
        if (!item) {
          return "";
        }
        if (item.daysLeft !== null) {
          return `Not claimed yet. PayPal returns the money in ${item.daysLeft} day${item.daysLeft === 1 ? "" : "s"} if it stays unclaimed.`;
        }
        return item.reason ?? "";
      },
    },
    { field: "paypalItemId", headerName: "PayPal item ID", width: 160, cellClass: "font-mono" },
    {
      headerName: "",
      width: 110,
      sortable: false,
      cellRenderer: (params: ICellRendererParams<ItemView>) =>
        params.data?.status === "UNCLAIMED" ? (
          <button type="button" className="text-sm text-primary hover:underline" onClick={() => setCancelling(params.data ?? null)}>
            Cancel
          </button>
        ) : null,
    },
  ];

  const ready = props.preflight.ready && props.balanced;

  return (
    <div className="space-y-6">
      <div aria-live="polite">
        {result &&
          (result.ok ? (
            <Notice title={result.message} role="status" />
          ) : (
            <Notice tone="error" title="PayPal action did not complete">
              {result.error}
              {result.debugId ? <span className="block font-mono text-xs">PayPal debug_id {result.debugId}</span> : null}
            </Notice>
          ))}
      </div>

      {props.holds > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-hold bg-surface px-3 py-2">
          <span>
            {props.holds} response{props.holds === 1 ? " needs" : "s need"} a decision before {props.holds === 1 ? "it" : "they"} can be paid. Their money stays reserved meanwhile.
          </span>
          <LinkButton href={`/studies/${props.studyId}/review`}>Review them</LinkButton>
        </div>
      )}

      <Section title="1 · Pre-flight checks">
        <ul className="space-y-1.5">
          {props.preflight.checks.map((check) => (
            <li key={check.label} className="flex gap-2">
              {check.ok ? <MdCheckCircle size={20} className="mt-0.5 shrink-0 text-pay" aria-label="Passed" /> : <MdCancel size={20} className="mt-0.5 shrink-0 text-dont-pay" aria-label="Failed" />}
              <span>
                <span className="font-semibold">{check.label}</span> <span className="text-muted">{check.detail.replace(/(\d+) cents/g, (_, cents: string) => formatCents(Number(cents)))}</span>
              </span>
            </li>
          ))}
          <li className="flex gap-2 text-muted">
            <MdCancel size={20} className="mt-0.5 shrink-0" aria-hidden />
            <span>Venmo payouts are tested in live mode only. PayPal&apos;s sandbox rejects the Venmo wallet, so they are switched off here.</span>
          </li>
        </ul>
        {props.preflight.skipped.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm">{props.preflight.skipped.length} decided to pay but not in this batch</summary>
            <ul className="mt-1 space-y-0.5 text-sm">
              {props.preflight.skipped.map((entry) => (
                <li key={entry.ref}>
                  <span className="font-mono">{entry.ref}</span> <span className="text-muted">{entry.reason}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      {props.preflight.count > 0 && (
        <Section title="2 · Review the payout">
          <dl className="grid gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">Participants</dt>
              <dd className="font-mono text-lg tabular">{props.preflight.count}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Total</dt>
              <dd className="font-mono text-lg tabular">{formatCents(props.preflight.totalCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Unallocated after payout</dt>
              <dd className="font-mono text-lg tabular">{formatCents(props.unallocatedCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Still reserved for review</dt>
              <dd className="font-mono text-lg tabular">{formatCents(props.heldCents)}</dd>
            </div>
          </dl>
          <div className="mt-4 overflow-x-auto">
            <table className={tableClass}>
              <caption className="mb-1 text-left text-xs text-muted">Sample of recipients (masked)</caption>
              <thead>
                <tr>
                  <th scope="col" className={thClass}>Respondent</th>
                  <th scope="col" className={thClass}>Recipient</th>
                  <th scope="col" className={thClass}>Type</th>
                  <th scope="col" className={thClass}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {props.preflight.sample.map((entry) => (
                  <tr key={entry.ref}>
                    <td className={`${tdClass} font-mono`}>{entry.ref}</td>
                    <td className={`${tdClass} font-mono`}>{entry.receiver}</td>
                    <td className={tdClass}>{entry.type === "phone" ? "PayPal (phone)" : "PayPal (email)"}</td>
                    <td className={`${tdClass} font-mono`}>{formatCents(props.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 rounded-sm border border-rule bg-subtle p-3 text-sm">
            <p>
              <span className="text-muted">Email subject participants see:</span> {props.subject}
            </p>
            <p>
              <span className="text-muted">Note:</span> {props.note}
            </p>
          </div>
        </Section>
      )}

      {props.preflight.count > 0 && (
        <Section title="3 · Approve">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="approver" className="block font-semibold">
                Approved by (PI)
              </label>
              <input id="approver" className={inputClass} value={approver} onChange={(event) => setApprover(event.target.value)} />
            </div>
            <div className="space-y-1">
              <label htmlFor="code" className="block font-semibold">
                Type the study code <span className="font-mono">{props.shortCode}</span> to approve
              </label>
              <input id="code" className={`${inputClass} font-mono uppercase`} value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" autoCapitalize="characters" />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={!ready || pending || submitted || code.trim().toUpperCase() !== props.shortCode} onClick={approve}>
              {pending && submitted ? "Sending to PayPal…" : `Send ${formatCents(props.preflight.totalCents)} to ${props.preflight.count} participants`}
            </Button>
            {!ready && <span className="text-sm text-dont-pay">A pre-flight check failed.</span>}
          </div>
        </Section>
      )}

      {props.batches.length > 0 && (
        <Section
          title="Batches"
          aside={
            <div className="flex items-center gap-2 text-xs text-muted">
              {live ? "Updating every 20 seconds while payouts are in flight." : "All items have a final status."}
              {lastRefresh && <span>Last checked {lastRefresh}</span>}
              <Button onClick={refresh} disabled={pending}>
                <MdRefresh size={18} aria-hidden /> Refresh statuses
              </Button>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th scope="col" className={thClass}>Batch</th>
                  <th scope="col" className={thClass}>Status</th>
                  <th scope="col" className={thClass}>Items</th>
                  <th scope="col" className={thClass}>Total</th>
                  <th scope="col" className={thClass}>Approved</th>
                  <th scope="col" className={thClass}>PayPal batch ID</th>
                </tr>
              </thead>
              <tbody>
                {props.batches.map((batch) => (
                  <tr key={batch.id}>
                    <td className={`${tdClass} font-mono`}>{batch.senderBatchId}</td>
                    <td className={tdClass}>
                      <span className="font-mono">{batch.status}</span>
                      {batch.reason && <span className="block text-xs text-dont-pay">{batch.reason}</span>}
                      {batch.debugId && <span className="block font-mono text-xs text-muted">debug_id {batch.debugId}</span>}
                      {(batch.status === "request_failed" || batch.stuck) && (
                        <Button className="mt-1" onClick={() => run(() => retrySendAction(props.studyId, batch.id))} disabled={pending}>
                          Retry sending (same batch ID)
                        </Button>
                      )}
                    </td>
                    <td className={`${tdClass} font-mono`}>{batch.itemCount}</td>
                    <td className={`${tdClass} font-mono`}>{formatCents(batch.totalCents)}</td>
                    <td className={tdClass}>
                      {batch.approvedBy} · <LocalTime date={batch.approvedAt} />
                    </td>
                    <td className={`${tdClass} font-mono text-xs`}>{batch.paypalBatchId ?? "not assigned"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 rounded-lg border border-rule p-5">
            <h4 className="mb-3 text-sm font-bold">Item statuses</h4>
            <Rings
              label="Payout item statuses"
              size={170}
              thickness={14}
              center={
                <div>
                  <div className="font-mono text-lg font-semibold tabular">{props.items.length}</div>
                  <div className="text-xs font-semibold text-muted">items</div>
                </div>
              }
              rings={STATUS_SLICES.map((slice) => {
                const count = props.items.filter((item) => slice.statuses.includes(item.status)).length;
                return { label: slice.name, color: slice.color, value: count, max: props.items.length, display: String(count) };
              })}
            />
          </div>
          <div className="mt-4">
            <DataGrid label="Payout items" rows={props.items} columns={columns} rowId={(row) => row.id} height={420} />
          </div>
        </Section>
      )}

      <Dialog.Root open={cancelling !== null} onOpenChange={(open) => !open && setCancelling(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 space-y-3 rounded-lg border border-rule bg-surface p-5 shadow-pop">
            <Dialog.Title className="font-semibold">Cancel unclaimed payout to {cancelling?.ref}</Dialog.Title>
            <Dialog.Description className="text-sm text-muted">PayPal returns the money to the budget once it confirms. The respondent goes back to the review queue.</Dialog.Description>
            <label htmlFor="cancel-reason" className="block font-semibold">
              Reason
            </label>
            <input id="cancel-reason" className={inputClass} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button>Keep payout</Button>
              </Dialog.Close>
              <Button
                variant="danger"
                disabled={pending || cancelReason.trim().length < 3}
                onClick={() => {
                  const item = cancelling;
                  setCancelling(null);
                  if (item) {
                    run(() => cancelUnclaimedAction(props.studyId, item.id, cancelReason));
                  }
                  setCancelReason("");
                }}
              >
                Cancel payout
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
