"use client";

import { useActionState, useState } from "react";
import { createStudyAction, type FormState } from "@/app/actions/studies";
import { PendingButton } from "@/components/pending-button";
import { Field, inputClass, Notice } from "@/components/ui";
import { formatCents, parseDollarsToCents } from "@/lib/money";

const CONSENT_SUGGESTION = "If responses cannot be verified, compensation may not be issued.";

export function NewStudyForm() {
  const [state, action] = useActionState<FormState, FormData>(createStudyAction, {});
  const [budget, setBudget] = useState("");
  const [amount, setAmount] = useState("");
  const budgetCents = parseDollarsToCents(budget);
  const amountCents = parseDollarsToCents(amount);
  const covers = budgetCents && amountCents ? Math.floor(budgetCents / amountCents) : null;
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="mt-6 space-y-6" noValidate>
      {state.error && <Notice tone="error" title="The study was not created">{state.error}</Notice>}

      <fieldset className="space-y-4 rounded-lg border border-rule bg-surface p-5">
        <legend className="px-1 font-semibold">Study details</legend>
        <Field label="Title" htmlFor="title" error={errors.title}>
          <input id="title" name="title" className={inputClass} required maxLength={200} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Short code" htmlFor="shortCode" error={errors.shortCode} hint="Typed by the PI to approve payouts, e.g. SLEEP-26.">
            <input id="shortCode" name="shortCode" className={`${inputClass} font-mono uppercase`} required maxLength={16} autoCapitalize="characters" />
          </Field>
          <Field label="Protocol number (optional)" htmlFor="protocolNumber" error={errors.protocolNumber}>
            <input id="protocolNumber" name="protocolNumber" className={inputClass} maxLength={100} />
          </Field>
        </div>
        <Field label="Principal investigator" htmlFor="piName" error={errors.piName}>
          <input id="piName" name="piName" className={inputClass} required maxLength={200} />
        </Field>
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border border-rule bg-surface p-5">
        <legend className="px-1 font-semibold">Budget</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Total budget (USD)" htmlFor="budget" error={errors.budget}>
            <input id="budget" name="budget" inputMode="decimal" className={`${inputClass} font-mono`} value={budget} onChange={(event) => setBudget(event.target.value)} />
          </Field>
          <Field label="Amount per participant (USD)" htmlFor="amount" error={errors.amount}>
            <input id="amount" name="amount" inputMode="decimal" className={`${inputClass} font-mono`} value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>
        </div>
        <p className="text-muted" aria-live="polite">
          {covers !== null && budgetCents && amountCents
            ? `${formatCents(budgetCents)} covers up to ${covers} participant${covers === 1 ? "" : "s"} at ${formatCents(amountCents)}.`
            : "Payments are sent in USD through PayPal Payouts (sandbox)."}
        </p>
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border border-rule bg-surface p-5">
        <legend className="px-1 font-semibold">Consent and review</legend>
        <Field label="Consent wording about verification" htmlFor="consent" error={errors.consentTextExcerpt} hint="Quoted in the ethics report. Participants should know payment depends on verification.">
          <textarea id="consent" name="consent" rows={3} className={inputClass} defaultValue={CONSENT_SUGGESTION} />
        </Field>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="twoReviewer" className="mt-1 h-4 w-4 accent-[var(--primary)]" />
          <span>
            <span className="font-semibold">Two-reviewer mode</span>
            <span className="block text-muted">A held response is resolved only when two different reviewers agree.</span>
          </span>
        </label>
      </fieldset>

      <PendingButton variant="primary" pendingText="Creating study…">
        Create study
      </PendingButton>
    </form>
  );
}
