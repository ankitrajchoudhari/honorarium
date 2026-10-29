"use client";

import { startTransition, useEffect, useState } from "react";

/**
 * False on the server and during hydration, true afterwards. The switch is a transition, so React finishes
 * hydrating every streamed part of the page before any browser-only value (local time, animation, stored flag)
 * replaces the server HTML. An urgent update here would race slow-streaming pages and force React to discard them.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    startTransition(() => setHydrated(true));
  }, []);
  return hydrated;
}
