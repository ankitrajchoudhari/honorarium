"use client";

import { createContext, useContext, useTransition, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui";

const PendingContext = createContext(false);

/**
 * A form that runs a server action from the client. Passing a server action straight to `<form action>` makes the
 * server prepend hidden inputs that React can fail to hydrate against; submitting here avoids that, and the pending
 * state disables the submit button so a double click cannot send twice.
 */
export function ActionForm({ action, children, className }: { action: (data: FormData) => Promise<void>; children: ReactNode; className?: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
    </form>
  );
}

/** The submit button of an ActionForm: disabled and relabelled while the action runs. */
export function ActionSubmit({ children, pendingText, ...props }: ComponentProps<typeof Button> & { pendingText: ReactNode }) {
  const pending = useContext(PendingContext);
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending ? pendingText : children}
    </Button>
  );
}
