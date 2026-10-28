"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { correctIdentityAction, reviewDecisionAction } from "@/app/actions/review";
import { Button, inputClass, Notice } from "@/components/ui";
import type { RespondentDetail } from "@/respondents/detail";

/** Override of a rules decision (needs a written justification) and payout-identity correction, shown in the evidence drawer. */
export function RespondentActions({ studyId, detail, onChanged }: { studyId: string; detail: RespondentDetail; onChanged: () => void }) {
  const router = useRouter();
  const [justification, setJustification] = useState("");
  const [identity, setIdentity] = useState("");
  const [identityReason, setIdentityReason] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const canOverride = detail.decision === "dont_pay" && detail.decisionSource === "rules";
  const payoutFailed = detail.payouts.some((payout) => payout.status === "FAILED");
  const identityProblem = detail.identity === null || detail.checks.some((check) => check.ruleId === "system:payout_identity" && check.outcome === "review");
  const liveOrPaid = detail.payouts.some((payout) => !["FAILED", "RETURNED", "REFUNDED", "REVERSED", "NOT_SENT"].includes(payout.status));
  const canCorrect = (payoutFailed || identityProblem) && !liveOrPaid;

  if (!canOverride && !canCorrect) {
    return null;
  }

  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) =>
    startTransition(async () => {
      const outcome = await action();
      setResult(outcome.ok ? { ok: true, text: success } : { ok: false, text: outcome.error });
      if (outcome.ok) {
        onChanged();
        router.refresh();
      }
    });

  return (
    <section className="space-y-3 rounded-lg border border-rule bg-surface p-4">
      {canOverride && (
        <div className="space-y-2">
          <h4 className="font-semibold">Override the rules decision</h4>
          <p className="text-sm text-muted">A locked rule said Don&apos;t pay. Overriding it needs a written justification and is highlighted in the ethics report.</p>
          <label htmlFor="justification" className="sr-only">
            Justification
          </label>
          <textarea id="justification" rows={3} className={inputClass} value={justification} onChange={(event) => setJustification(event.target.value)} placeholder="Why this response should be paid despite the rule" />
          <Button disabled={pending || justification.trim().length < 20} onClick={() => run(() => reviewDecisionAction(studyId, detail.ref, "pay", justification), "Override recorded.")}>
            Override and pay
          </Button>
        </div>
      )}
      {canCorrect && (
        <div className="space-y-2">
          <h4 className="font-semibold">Correct the payout email or phone</h4>
          <p className="text-sm text-muted">For a typo or a missing address. The change and your reason go into the audit log; a corrected failed payout can be retried.</p>
          <input aria-label="Corrected email or phone" className={inputClass} value={identity} onChange={(event) => setIdentity(event.target.value)} placeholder="name@example.org" />
          <input aria-label="Reason for the correction" className={inputClass} value={identityReason} onChange={(event) => setIdentityReason(event.target.value)} placeholder="Reason, e.g. participant emailed the correct address" />
          <Button disabled={pending || identity.trim().length < 5} onClick={() => run(() => correctIdentityAction(studyId, detail.ref, identity, identityReason), "Payout identity corrected.")}>
            Save correction
          </Button>
        </div>
      )}
      {result && <Notice tone={result.ok ? "info" : "error"} title={result.text} />}
    </section>
  );
}
