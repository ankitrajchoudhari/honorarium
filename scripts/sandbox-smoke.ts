/**
 * Sandbox smoke test (Phase 0 probe): token, a 1-item payout, status, an error simulation. Run manually: npm run probe:paypal
 * Prints statuses, IDs and debug_ids only; never prints credentials or tokens.
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { PAYPAL_API_BASE, readEnv } from "../src/lib/env";

config({ path: ".env.local", quiet: true });

const SIMULATOR_RECEIVER = "payouts-simulator-receiver@paypal.com";
const FINAL_ITEM_STATUSES = new Set(["SUCCESS", "FAILED", "UNCLAIMED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED"]);
const POLL_INTERVAL_MS = 5_000;
const POLL_ATTEMPTS = 18;

type Json = Record<string, unknown>;
type CallResult = { status: number; body: Json; debugId: string | undefined };

function field(source: unknown, ...path: string[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Json)[key];
  }
  return current;
}

function text(source: unknown, ...path: string[]): string | undefined {
  const value = field(source, ...path);
  return typeof value === "string" ? value : undefined;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getToken(clientId: string, clientSecret: string): Promise<{ token: string; expiresIn: number }> {
  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as Json;
  const token = text(body, "access_token");
  const expiresIn = field(body, "expires_in");
  if (!response.ok || !token || typeof expiresIn !== "number") {
    throw new Error(`Token request failed: HTTP ${response.status} ${text(body, "error") ?? ""} ${text(body, "error_description") ?? ""}`);
  }
  return { token, expiresIn };
}

async function call(token: string, method: "GET" | "POST", path: string, body?: Json, requestId?: string): Promise<CallResult> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (requestId) {
    headers["PayPal-Request-Id"] = requestId;
  }
  const response = await fetch(`${PAYPAL_API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await response.text();
  const parsed = raw.length > 0 ? (JSON.parse(raw) as Json) : {};
  return { status: response.status, body: parsed, debugId: text(parsed, "debug_id") ?? response.headers.get("paypal-debug-id") ?? undefined };
}

function describeError(result: CallResult): string {
  const details = field(result.body, "details");
  const issues = Array.isArray(details) ? details.map((detail) => text(detail, "issue")).filter(Boolean).join(", ") : "";
  return `HTTP ${result.status} ${text(result.body, "name") ?? ""} ${text(result.body, "message") ?? ""}${issues ? ` [${issues}]` : ""} debug_id=${result.debugId ?? "none"}`;
}

function item(receiver: string, senderItemId: string, extra: Json = {}): Json {
  return {
    recipient_type: "EMAIL",
    amount: { value: "1.00", currency: "USD" },
    receiver,
    sender_item_id: senderItemId,
    note: "Honorarium sandbox probe. Thank you for taking part.",
    ...extra,
  };
}

async function createBatch(token: string, label: string, items: Json[]): Promise<CallResult & { senderBatchId: string }> {
  const senderBatchId = `hon_probe_${label}_${Date.now()}`;
  const result = await call(
    token,
    "POST",
    "/v1/payments/payouts",
    {
      sender_batch_header: {
        sender_batch_id: senderBatchId,
        email_subject: "Honorarium sandbox probe",
        email_message: "Sandbox test payment.",
      },
      items,
    },
    randomUUID(),
  );
  return { ...result, senderBatchId };
}

async function main(): Promise<void> {
  const envResult = readEnv();
  if (!envResult.ok) {
    console.error("Environment problems:", envResult.problems.map((problem) => `${problem.variable}: ${problem.message}`).join("; "));
    process.exitCode = 1;
    return;
  }
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = envResult.env;

  console.log("1. OAuth token");
  const { token, expiresIn } = await getToken(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET);
  console.log(`   OK, expires_in=${expiresIn}s`);

  console.log("2. Create batch: simulator receiver + unknown address (expect UNCLAIMED)");
  const unknownReceiver = `honorarium-probe-${Date.now()}@example.org`;
  const batch = await createBatch(token, "main", [item(SIMULATOR_RECEIVER, "probe_item_1"), item(unknownReceiver, "probe_item_2")]);
  if (batch.status !== 201) {
    console.log(`   FAILED ${describeError(batch)}`);
    process.exitCode = 1;
    return;
  }
  const payoutBatchId = text(batch.body, "batch_header", "payout_batch_id");
  console.log(`   HTTP 201 batch_status=${text(batch.body, "batch_header", "batch_status")} payout_batch_id=${payoutBatchId}`);
  if (!payoutBatchId) {
    process.exitCode = 1;
    return;
  }

  console.log("3. Duplicate sender_batch_id is rejected");
  const duplicate = await call(
    token,
    "POST",
    "/v1/payments/payouts",
    { sender_batch_header: { sender_batch_id: batch.senderBatchId }, items: [item(SIMULATOR_RECEIVER, "probe_item_dup")] },
    randomUUID(),
  );
  console.log(`   ${duplicate.status === 201 ? "NOT REJECTED (unexpected)" : describeError(duplicate)}`);

  console.log("4. Poll batch until items are final");
  let items: unknown[] = [];
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    const shown = await call(token, "GET", `/v1/payments/payouts/${payoutBatchId}`);
    const listed = field(shown.body, "items");
    items = Array.isArray(listed) ? listed : [];
    const statuses = items.map((entry) => text(entry, "transaction_status") ?? "?");
    console.log(`   attempt ${attempt}: batch_status=${text(shown.body, "batch_header", "batch_status")} items=[${statuses.join(", ")}]`);
    if (statuses.length > 0 && statuses.every((status) => FINAL_ITEM_STATUSES.has(status))) {
      break;
    }
    await wait(POLL_INTERVAL_MS);
  }

  for (const entry of items) {
    const payoutItemId = text(entry, "payout_item_id");
    if (!payoutItemId) {
      continue;
    }
    console.log(`5. GET item ${payoutItemId}`);
    const shownItem = await call(token, "GET", `/v1/payments/payouts-item/${payoutItemId}`);
    const status = text(shownItem.body, "transaction_status");
    console.log(`   HTTP ${shownItem.status} transaction_status=${status} sender_item_id=${text(shownItem.body, "payout_item", "sender_item_id")} errors=${text(shownItem.body, "errors", "name") ?? "none"}`);
    if (status === "UNCLAIMED") {
      console.log(`6. Cancel unclaimed item ${payoutItemId}`);
      const cancelled = await call(token, "POST", `/v1/payments/payouts-item/${payoutItemId}/cancel`, undefined, randomUUID());
      console.log(`   ${cancelled.status === 200 ? `HTTP 200 transaction_status=${text(cancelled.body, "transaction_status")}` : describeError(cancelled)}`);
    }
  }

  console.log("7. Error simulation: note=ERRPYO002 (expect SENDER_EMAIL_UNCONFIRMED)");
  const simulated = await createBatch(token, "err", [item(SIMULATOR_RECEIVER, "probe_err_1", { note: "ERRPYO002" })]);
  console.log(`   ${simulated.status === 201 ? "HTTP 201 (simulation did not trigger)" : describeError(simulated)}`);

  console.log("8. Venmo wallet: recipient_type=PHONE, recipient_wallet=VENMO, US test number");
  const venmo = await createBatch(token, "venmo", [
    item("4085550123", "probe_venmo_1", { recipient_type: "PHONE", recipient_wallet: "VENMO" }),
  ]);
  console.log(
    `   ${venmo.status === 201 ? `HTTP 201 batch_status=${text(venmo.body, "batch_header", "batch_status")} payout_batch_id=${text(venmo.body, "batch_header", "payout_batch_id")}` : describeError(venmo)}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
