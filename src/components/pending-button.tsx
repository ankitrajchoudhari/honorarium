"use client";

import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";

/** A submit button that disables itself while its form is being submitted (prevents double submits). */
export function PendingButton({ children, pendingText, ...props }: ComponentProps<typeof Button> & { pendingText: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending ? pendingText : children}
    </Button>
  );
}
