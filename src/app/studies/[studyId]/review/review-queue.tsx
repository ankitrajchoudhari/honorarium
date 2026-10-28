"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { reviewDecisionAction } from "@/app/actions/review";
import { RespondentEvidence, useRespondent } from "@/components/respondent-evidence";
import { Button, DecisionChip, inputClass, Kbd, Notice } from "@/components/ui";

export interface QueueEntry {
  ref: string;
  votes: { reviewer: string; decision: "pay" | "hold" | "dont_pay" }[];
  disagree: boolean;
}

const PRESETS = {
  pay: ["Answers are specific and consistent", "Flag was a false positive", "Duplicate is a different person (e.g. sibling)", "Payout identity checked"],
  dont_pay: ["Answers are templated or copied", "Answers are off topic or nonsensical", "Contradictions show the answers are not genuine", "Duplicate of an earlier submission"],
};

export function ReviewQueue({ studyId, queue, reviewedBefore, reviewer, twoReviewer }: { studyId: string; queue: QueueEntry[]; reviewedBefore: number; reviewer: string; twoReviewer: boolean }) {
  const router = useRouter();
  const [entries, setEntries] = useState(queue);
  const [index, setIndex] = useState(0);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [decidedNow, setDecidedNow] = useState(0);
  const [pending, startTransition] = useTransition();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  // Counted from the props at mount: router.refresh() delivers a larger reviewedBefore that already includes decidedNow.
  const [baseline] = useState(() => ({ reviewed: reviewedBefore, total: reviewedBefore + queue.length }));
  const current = entries[Math.min(index, entries.length - 1)];
  const { detail, error } = useRespondent(studyId, current?.ref ?? null);
  const alreadyVoted = current?.votes.some((vote) => vote.reviewer.toLowerCase() === reviewer.toLowerCase()) ?? false;

  const move = useCallback(
    (step: number) => {
      setIndex((value) => Math.max(0, Math.min(entries.length - 1, value + step)));
      setReason("");
      setMessage(null);
    },
    [entries.length],
  );

  const submit = useCallback(
    (decision: "pay" | "dont_pay") => {
      if (!current || pending) {
        return;
      }
      if (reason.trim().length < 3) {
        setMessage({ tone: "error", text: "Add a reason first. Press / to type one, or pick a preset." });
        reasonRef.current?.focus();
        return;
      }
      startTransition(async () => {
        const result = await reviewDecisionAction(studyId, current.ref, decision, reason);
        if (!result.ok) {
          setMessage({ tone: "error", text: result.error });
          return;
        }
        const outcome = result.outcome;
        if (outcome?.status === "decided") {
          setEntries((list) => list.filter((entry) => entry.ref !== current.ref));
          setIndex((value) => Math.min(value, Math.max(0, entries.length - 2)));
          setDecidedNow((value) => value + 1);
          setMessage({ tone: "info", text: `${current.ref}: ${decision === "pay" ? "Pay" : "Don't pay"} recorded.` });
        } else {
          setEntries((list) =>
            list.map((entry) =>
              entry.ref === current.ref
                ? { ...entry, votes: [...entry.votes, { reviewer, decision }], disagree: outcome?.status === "disagree" }
                : entry,
            ),
          );
          setMessage({
            tone: "info",
            text: outcome?.status === "disagree" ? `${current.ref}: reviewers disagree. It stays in the queue.` : `${current.ref}: your vote is recorded. A second reviewer must agree.`,
          });
          move(1);
        }
        setReason("");
        router.refresh();
      });
    },
    [current, pending, reason, studyId, entries.length, reviewer, move, router],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.tagName === "SELECT" || target.isContentEditable);
      if (typing) {
        if (event.key === "Escape") {
          target.blur();
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "j") {
        move(1);
      } else if (key === "k") {
        move(-1);
      } else if (key === "p") {
        submit("pay");
      } else if (key === "d") {
        submit("dont_pay");
      } else if (key === "/") {
        event.preventDefault();
        reasonRef.current?.focus();
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, submit]);

  if (!current) {
    return (
      <Notice title="Queue cleared" role="status">
        You decided {decidedNow} response{decidedNow === 1 ? "" : "s"} in this session. Payouts can be prepared now.
      </Notice>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p aria-live="polite" className="font-semibold">
          {baseline.reviewed + decidedNow} of {baseline.total} reviewed
          <span className="ml-2 text-sm font-normal text-muted">
            Showing {Math.min(index, entries.length - 1) + 1} of {entries.length} waiting
          </span>
        </p>
        <div className="flex gap-2">
          <Button onClick={() => move(-1)} disabled={index === 0}>
            Previous
          </Button>
          <Button onClick={() => move(1)} disabled={index >= entries.length - 1}>
            Next
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-label="Evidence" className="min-w-0 rounded-lg border border-rule bg-surface p-5">
          {error && <Notice tone="error" title="Could not load this respondent">{error}</Notice>}
          {!detail && !error && <p className="text-muted">Loading evidence…</p>}
          {detail && <RespondentEvidence studyId={studyId} detail={detail} />}
        </section>

        <section aria-label="Decision" className="space-y-3 self-start rounded-lg border border-rule bg-surface p-5 lg:sticky lg:top-4">
          <h3 className="font-semibold">Decision for {current.ref}</h3>
          {current.disagree && <Notice tone="warning" title="Reviewers disagree" />}
          {current.votes.length > 0 && (
            <ul className="text-sm">
              {current.votes.map((vote) => (
                <li key={vote.reviewer}>
                  {vote.reviewer}: <DecisionChip decision={vote.decision} />
                </li>
              ))}
            </ul>
          )}
          {twoReviewer && alreadyVoted ? (
            <p className="text-muted">You already voted on this response. A different reviewer needs to decide it.</p>
          ) : (
            <>
              <div>
                <label htmlFor="reason" className="mb-1 block font-semibold">
                  Reason (required)
                </label>
                <textarea id="reason" ref={reasonRef} rows={3} className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} />
              </div>
              <div className="space-y-1">
                {(["pay", "dont_pay"] as const).map((decision) => (
                  <div key={decision} className="flex flex-wrap gap-1">
                    {PRESETS[decision].map((preset) => (
                      <button key={preset} type="button" onClick={() => setReason(preset)} className="touch-target rounded-sm border border-rule px-1.5 py-0.5 text-xs hover:bg-subtle">
                        {preset}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="primary" disabled={pending} onClick={() => submit("pay")}>
                  Pay <Kbd>P</Kbd>
                </Button>
                <Button variant="danger" disabled={pending} onClick={() => submit("dont_pay")}>
                  Don&apos;t pay <Kbd>D</Kbd>
                </Button>
              </div>
            </>
          )}
          <div aria-live="polite">{message && <Notice tone={message.tone} title={message.text} role={message.tone === "error" ? "alert" : "status"} />}</div>
        </section>
      </div>

      <footer className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          <Kbd>J</Kbd> next
        </span>
        <span>
          <Kbd>K</Kbd> previous
        </span>
        <span>
          <Kbd>P</Kbd> pay
        </span>
        <span>
          <Kbd>D</Kbd> don&apos;t pay
        </span>
        <span>
          <Kbd>/</Kbd> type a reason
        </span>
        <span>
          <Kbd>Esc</Kbd> leave the reason box
        </span>
      </footer>
    </div>
  );
}
