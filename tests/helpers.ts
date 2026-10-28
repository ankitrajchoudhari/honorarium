import { payoutIdentity } from "@/engine/normalize";
import type { EngineRespondent } from "@/engine/types";

let counter = 0;

export function respondent(overrides: Partial<EngineRespondent> & { email?: string; values?: Record<string, string> } = {}): EngineRespondent {
  counter += 1;
  const ref = overrides.ref ?? `R-${String(counter).padStart(4, "0")}`;
  const { email, ...rest } = overrides;
  return {
    ref,
    rowNumber: counter,
    values: {},
    submittedAt: new Date(Date.UTC(2026, 9, 1, 12, 0, counter)),
    durationSeconds: 600,
    payout: payoutIdentity(email ?? `${ref.toLowerCase()}@example.org`, undefined),
    ...rest,
  };
}
