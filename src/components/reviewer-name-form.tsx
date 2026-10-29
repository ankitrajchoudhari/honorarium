"use client";

import { useState, useTransition } from "react";
import { setReviewerNameAction, type FormState } from "@/app/actions/studies";
import { Button, Field, inputClass } from "@/components/ui";

export function ReviewerNameForm({ current }: { current: string | null }) {
  const [state, setState] = useState<FormState>({});
  const [pending, startTransition] = useTransition();
  return (
    <form
      // Submitted from the client with plain state: a server-action form (or useActionState) makes the server add
      // hidden inputs and form-state markers that React can fail to hydrate against.
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(async () => setState(await setReviewerNameAction({}, data)));
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <div className="w-64">
        <Field label="Your name or initials" htmlFor="reviewerName" error={state.fieldErrors?.reviewerName} hint="Recorded on every decision and approval in this browser.">
          <input id="reviewerName" name="reviewerName" defaultValue={current ?? ""} className={inputClass} maxLength={60} autoComplete="name" />
        </Field>
      </div>
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "Saving…" : current ? "Change" : "Save"}
      </Button>
    </form>
  );
}
