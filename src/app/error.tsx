"use client";

import { Button } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-xl font-extrabold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-muted">The page could not load. Nothing was paid or changed by this error. Try again; if it keeps happening, the database or a service may be unavailable.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-muted">Reference {error.digest}</p>}
      <Button className="mt-4" variant="primary" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
