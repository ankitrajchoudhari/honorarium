"use client";

import { useActionState } from "react";
import { setReviewerNameAction, type FormState } from "@/app/actions/studies";
import { PendingButton } from "@/components/pending-button";
import { Field, inputClass } from "@/components/ui";

export function ReviewerNameForm({ current }: { current: string | null }) {
  const [state, action] = useActionState<FormState, FormData>(setReviewerNameAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="w-64">
        <Field label="Your name or initials" htmlFor="reviewerName" error={state.fieldErrors?.reviewerName} hint="Recorded on every decision and approval in this browser.">
          <input id="reviewerName" name="reviewerName" defaultValue={current ?? ""} className={inputClass} maxLength={60} autoComplete="name" />
        </Field>
      </div>
      <PendingButton pendingText="Saving…">{current ? "Change" : "Save"}</PendingButton>
    </form>
  );
}
