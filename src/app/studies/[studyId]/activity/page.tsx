import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import type { Metadata } from "next";
import type { IconType } from "react-icons";
import {
  MdAutoAwesome,
  MdBolt,
  MdCreate,
  MdFileUpload,
  MdGavel,
  MdLock,
  MdOutlinePayments,
  MdPersonSearch,
  MdRateReview,
  MdRestartAlt,
  MdUndo,
  MdVisibility,
} from "react-icons/md";
import { LocalTime, PageTitle } from "@/components/ui";
import { db } from "@/db/client";
import { auditLog, payoutBatches, payoutItems, webhookEvents } from "@/db/schema";
import { getStudyOr404 } from "@/db/study-page";
import { formatCents } from "@/lib/money";
import { requireWorkspace } from "@/lib/session";

export const metadata: Metadata = { title: "Activity" };

const LIMIT = 300;

interface Entry {
  key: string;
  at: Date;
  Icon: IconType;
  tone: string;
  title: string;
  detail: string | null;
  actor: string;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** Turns one audit row into a plain sentence. Unknown actions still show, with their raw name. */
function describe(row: typeof auditLog.$inferSelect): Omit<Entry, "key" | "at" | "actor"> {
  const after = record(row.afterJson);
  const before = record(row.beforeJson);
  switch (row.action) {
    case "study.created":
      return { Icon: MdCreate, tone: "bg-primary-soft text-primary", title: `Study ${row.target ?? ""} created`, detail: typeof after.budgetCents === "number" ? `Budget ${formatCents(after.budgetCents)}` : null };
    case "rules.compiled":
      return { Icon: MdAutoAwesome, tone: "bg-primary-soft text-primary", title: `Gemini compiled the exclusion rules (${row.target ?? ""})`, detail: null };
    case "rules.edited":
      return { Icon: MdCreate, tone: "bg-subtle text-muted", title: `Rules edited by hand (${row.target ?? ""})`, detail: null };
    case "rules.locked":
      return { Icon: MdLock, tone: "bg-navy text-on-navy", title: `Rules ${row.target ?? ""} locked`, detail: typeof after.sha256 === "string" ? `SHA-256 ${after.sha256.slice(0, 12)}` : null };
    case "rules.new_version":
      return { Icon: MdRestartAlt, tone: "bg-hold-soft text-hold", title: `New rules version ${row.target ?? ""} started`, detail: typeof after.changeNote === "string" ? after.changeNote : null };
    case "data.imported":
      return { Icon: MdFileUpload, tone: "bg-primary-soft text-primary", title: `Imported ${typeof after.rows === "number" ? after.rows : "?"} responses`, detail: row.target };
    case "verification.finished":
      return {
        Icon: MdBolt,
        tone: "bg-pay-soft text-pay",
        title: "Verification finished",
        detail: `${after.pay ?? 0} pay · ${after.hold ?? 0} hold · ${after.dontPay ?? 0} don't pay · Gemini assessed ${after.aiAssessed ?? 0} answers`,
      };
    case "review.decided":
      return { Icon: MdRateReview, tone: "bg-subtle text-ink", title: `${row.target ?? "Respondent"} decided: ${after.decision === "pay" ? "Pay" : "Don't pay"}`, detail: typeof after.reason === "string" ? after.reason : null };
    case "review.override":
      return { Icon: MdGavel, tone: "bg-hold-soft text-hold", title: `${row.target ?? "Respondent"}: rules decision overridden`, detail: typeof after.reason === "string" ? after.reason : null };
    case "payout.approved":
      return {
        Icon: MdOutlinePayments,
        tone: "bg-pay-soft text-pay",
        title: `Payout ${row.target ?? ""} approved and sent to PayPal`,
        detail: typeof after.items === "number" && typeof after.totalCents === "number" ? `${after.items} participants · ${formatCents(after.totalCents)}` : null,
      };
    case "payout.cancelled":
      return { Icon: MdUndo, tone: "bg-dont-pay-soft text-dont-pay", title: `Unclaimed payout ${row.target ?? ""} cancelled`, detail: typeof after.reason === "string" ? after.reason : null };
    case "identity.revealed":
      return { Icon: MdVisibility, tone: "bg-subtle text-muted", title: `Payout identity of ${row.target ?? "a respondent"} revealed`, detail: null };
    case "identity.corrected":
      return { Icon: MdPersonSearch, tone: "bg-subtle text-ink", title: `Payout identity of ${row.target ?? "a respondent"} corrected`, detail: typeof after.reason === "string" ? after.reason : null };
    default:
      return { Icon: MdCreate, tone: "bg-subtle text-muted", title: row.action, detail: Object.keys(before).length > 0 ? JSON.stringify(before) : null };
  }
}

const PAYPAL_EVENT_TEXT: Record<string, string> = {
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": "PayPal confirmed a payment",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": "Payment waiting to be claimed",
  "PAYMENT.PAYOUTS-ITEM.FAILED": "PayPal reported a failed payment",
  "PAYMENT.PAYOUTS-ITEM.RETURNED": "Payment returned to the budget",
  "PAYMENT.PAYOUTS-ITEM.CANCELED": "Payment cancelled",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED": "PayPal blocked a payment",
  "PAYMENT.PAYOUTS-ITEM.HELD": "PayPal is holding a payment",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED": "Payment refunded",
  "PAYMENT.PAYOUTSBATCH.PROCESSING": "PayPal started processing the batch",
  "PAYMENT.PAYOUTSBATCH.SUCCESS": "PayPal finished processing the batch",
  "PAYMENT.PAYOUTSBATCH.DENIED": "PayPal denied the batch",
};

function dayLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

export default async function ActivityPage({ params }: PageProps<"/studies/[studyId]/activity">) {
  const { studyId } = await params;
  const workspace = await requireWorkspace();
  const study = await getStudyOr404(workspace.id, studyId);

  const audits = await db().select().from(auditLog).where(eq(auditLog.studyId, study.id)).orderBy(desc(auditLog.createdAt)).limit(LIMIT);
  const [itemIds, batchIds] = await Promise.all([
    db().select({ id: payoutItems.paypalItemId }).from(payoutItems).where(and(eq(payoutItems.studyId, study.id), isNotNull(payoutItems.paypalItemId))),
    db().select({ id: payoutBatches.paypalBatchId }).from(payoutBatches).where(and(eq(payoutBatches.studyId, study.id), isNotNull(payoutBatches.paypalBatchId))),
  ]);
  const resourceIds = [...itemIds, ...batchIds].map((row) => row.id).filter((id): id is string => id !== null);
  const events =
    resourceIds.length === 0
      ? []
      : await db()
          .select({ id: webhookEvents.id, type: webhookEvents.eventType, at: webhookEvents.createdAt, result: webhookEvents.processResult })
          .from(webhookEvents)
          .where(and(eq(webhookEvents.verified, true), or(inArray(webhookEvents.resourceId, resourceIds))))
          .orderBy(desc(webhookEvents.createdAt))
          .limit(LIMIT);

  // PayPal sends one event per item; a minute's worth of the same event type reads as one line.
  const grouped = new Map<string, { type: string; at: Date; count: number }>();
  for (const event of events) {
    const key = `${event.type}|${event.at.toISOString().slice(0, 16)}`;
    const entry = grouped.get(key) ?? { type: event.type, at: event.at, count: 0 };
    entry.count += 1;
    grouped.set(key, entry);
  }

  const entries: Entry[] = [
    ...audits.map((row) => ({ key: row.id, at: row.createdAt, actor: row.actor, ...describe(row) })),
    ...[...grouped.entries()].map(([key, group]) => ({
      key,
      at: group.at,
      actor: "PayPal webhook · signature verified",
      Icon: MdOutlinePayments,
      tone: "bg-in-flight/15 text-in-flight",
      title: `${PAYPAL_EVENT_TEXT[group.type] ?? group.type}${group.count > 1 ? ` · ${group.count} items` : ""}`,
      detail: group.type,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const days = new Map<string, Entry[]>();
  for (const entry of entries) {
    const label = dayLabel(entry.at);
    days.set(label, [...(days.get(label) ?? []), entry]);
  }

  return (
    <div className="space-y-6">
      <PageTitle description="Everything that happened in this study, newest first: who did it, when, and what PayPal reported back. Built from the audit log and verified PayPal webhooks.">
        Activity
      </PageTitle>
      {entries.length === 0 ? (
        <p className="rounded-lg border border-rule bg-surface p-6 text-muted">Nothing has happened in this study yet.</p>
      ) : (
        [...days.entries()].map(([day, list]) => (
          <section key={day} aria-label={day} className="rounded-lg border border-rule bg-surface">
            <h3 className="border-b border-rule px-6 py-3 text-sm font-bold text-muted">{day} (UTC)</h3>
            <ol className="divide-y divide-rule">
              {list.map((entry) => (
                <li key={entry.key} className="flex gap-4 px-6 py-3.5">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${entry.tone}`}>
                    <entry.Icon size={18} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{entry.title}</p>
                    {entry.detail && <p className="truncate text-sm text-muted">{entry.detail}</p>}
                    <p className="text-xs text-muted">{entry.actor}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted">
                    <LocalTime date={entry.at} />
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}
