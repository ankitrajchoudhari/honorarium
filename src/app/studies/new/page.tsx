import type { Metadata } from "next";
import { Shell } from "@/components/shell";
import { NewStudyForm } from "./new-study-form";

export const metadata: Metadata = { title: "New study" };

export default function NewStudyPage() {
  return (
    <Shell>
      <main id="main" className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-lg font-semibold">New study</h1>
        <p className="mt-1 text-muted">Set the budget and payment first. Exclusion rules come next and are locked before any data is imported.</p>
        <NewStudyForm />
      </main>
    </Shell>
  );
}
