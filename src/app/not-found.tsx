import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-xl font-extrabold tracking-tight">Not found</h1>
      <p className="mt-2 text-muted">This page does not exist, or it belongs to a different workspace. Each browser only sees its own studies.</p>
      <Link href="/" className="mt-4 inline-block text-primary hover:underline">
        Back to studies
      </Link>
    </main>
  );
}
