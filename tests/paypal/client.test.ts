import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { PayPalClient } from "@/paypal/client";
import { buildCreateBatchRequest, createBatch, getBatch } from "@/paypal/payouts";
import { buildVerificationBody, verifyWebhookSignature } from "@/paypal/webhook";

interface Recorded {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: string;
}

type Handler = (request: Recorded, response: ServerResponse) => void;

let server: Server | null = null;

/** Short timeouts only where a test is about timing out; otherwise a loaded CI machine must not trip them. */
async function fakePayPal(handler: Handler, timeoutMs = 5_000): Promise<{ client: PayPalClient; calls: Recorded[] }> {
  const calls: Recorded[] = [];
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      const recorded = { method: request.method ?? "", path: request.url ?? "", headers: request.headers, body };
      calls.push(recorded);
      if (recorded.path === "/v1/oauth2/token") {
        const tokens = calls.filter((call) => call.path === "/v1/oauth2/token").length;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ access_token: `token-${tokens}`, expires_in: 32_400 }));
        return;
      }
      handler(recorded, response);
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { client: new PayPalClient({ baseUrl: `http://127.0.0.1:${port}`, clientId: "id", clientSecret: "secret", timeoutMs }), calls };
}

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

const apiCalls = (calls: Recorded[]) => calls.filter((call) => call.path !== "/v1/oauth2/token");
const tokenCalls = (calls: Recorded[]) => calls.filter((call) => call.path === "/v1/oauth2/token");

describe("PayPalClient", () => {
  it("caches the OAuth token across requests", async () => {
    const { client, calls } = await fakePayPal((_, response) => json(response, 200, { ok: true }));
    await client.request("GET", "/a");
    await client.request("GET", "/b");
    expect(tokenCalls(calls)).toHaveLength(1);
    expect(apiCalls(calls).map((call) => call.headers.authorization)).toEqual(["Bearer token-1", "Bearer token-1"]);
  });

  it("refreshes the token once on 401 and retries", async () => {
    const { client, calls } = await fakePayPal((request, response) =>
      request.headers.authorization === "Bearer token-1" ? json(response, 401, { name: "AUTHENTICATION_FAILURE" }) : json(response, 200, { ok: true }),
    );
    const result = await client.request("GET", "/a");
    expect(result.ok).toBe(true);
    expect(tokenCalls(calls)).toHaveLength(2);
  });

  it("retries a 5xx once with the same PayPal-Request-Id and body", async () => {
    let attempt = 0;
    const { client, calls } = await fakePayPal((_, response) => {
      attempt += 1;
      return attempt === 1 ? json(response, 503, { name: "SERVICE_UNAVAILABLE" }) : json(response, 201, { batch_header: { payout_batch_id: "B1", batch_status: "PENDING" } });
    });
    const result = await client.request("POST", "/v1/payments/payouts", { body: { a: 1 }, requestId: "batch-uuid-1" });
    expect(result.ok).toBe(true);
    const posts = apiCalls(calls);
    expect(posts).toHaveLength(2);
    expect(posts.map((call) => call.headers["paypal-request-id"])).toEqual(["batch-uuid-1", "batch-uuid-1"]);
    expect(posts[0]?.body).toBe(posts[1]?.body);
  });

  it("reports an uncertain outcome after a timeout and its retry", async () => {
    const { client, calls } = await fakePayPal(() => undefined, 300);
    const result = await client.request("POST", "/slow", { body: {}, requestId: "r1" });
    expect(result).toMatchObject({ ok: false, name: "TIMEOUT", uncertain: true });
    expect(apiCalls(calls)).toHaveLength(2);
  });

  it("parses PayPal errors with issues and debug_id, and does not retry 4xx", async () => {
    const { client, calls } = await fakePayPal((_, response) =>
      json(response, 400, { name: "USER_BUSINESS_ERROR", message: "User business error.", debug_id: "f419415c9497d", details: [{ issue: "DUPLICATE_REQUEST", description: "Batch with given sender_batch_id already exists" }] }),
    );
    const result = await client.request("POST", "/v1/payments/payouts", { body: {}, requestId: "r1" });
    expect(result).toEqual({
      ok: false,
      status: 400,
      name: "USER_BUSINESS_ERROR",
      message: "User business error.",
      issues: ["DUPLICATE_REQUEST: Batch with given sender_batch_id already exists"],
      debugId: "f419415c9497d",
      uncertain: false,
    });
    expect(apiCalls(calls)).toHaveLength(1);
  });
});

describe("payout requests", () => {
  it("builds a batch with decimal string amounts and the PayPal wallet", () => {
    const request = buildCreateBatchRequest({
      senderBatchId: "hon_SLEEP26_1",
      emailSubject: "Thank you",
      emailMessage: "Thanks",
      currency: "USD",
      items: [{ senderItemId: "hon_SLEEP26_1_R-0001", recipientType: "EMAIL", receiver: "a@example.org", amountCents: 1_000, note: "Thank you" }],
    });
    expect(request.items[0]).toEqual({
      recipient_type: "EMAIL",
      amount: { value: "10.00", currency: "USD" },
      receiver: "a@example.org",
      sender_item_id: "hon_SLEEP26_1_R-0001",
      note: "Thank you",
      recipient_wallet: "PAYPAL",
    });
    expect(() => buildCreateBatchRequest({ senderBatchId: "x", emailSubject: "s", emailMessage: "m", currency: "USD", items: [] })).toThrow();
  });

  it("sends the batch with the request id and reads every page of items", async () => {
    const { client, calls } = await fakePayPal((request, response) => {
      if (request.method === "POST") {
        return json(response, 201, { batch_header: { payout_batch_id: "B1", batch_status: "PENDING" } });
      }
      const page = new URL(request.path, "http://x").searchParams.get("page");
      const item = (id: string, status: string) => ({ payout_item_id: id, transaction_status: status, payout_item: { sender_item_id: `s-${id}` } });
      return json(response, 200, {
        batch_header: { payout_batch_id: "B1", batch_status: "SUCCESS" },
        total_pages: 2,
        items: page === "1" ? [item("I1", "SUCCESS")] : [item("I2", "UNCLAIMED")],
      });
    });
    const request = buildCreateBatchRequest({ senderBatchId: "b", emailSubject: "s", emailMessage: "m", currency: "USD", items: [{ senderItemId: "i", recipientType: "EMAIL", receiver: "a@b.co", amountCents: 1, note: "n" }] });
    expect((await createBatch(client, request, "uuid-1")).ok).toBe(true);
    expect(apiCalls(calls)[0]?.headers["paypal-request-id"]).toBe("uuid-1");
    const batch = await getBatch(client, "B1");
    expect(batch.ok && batch.items.map((entry) => entry.transaction_status)).toEqual(["SUCCESS", "UNCLAIMED"]);
  });
});

describe("webhook verification", () => {
  const headers = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
    "paypal-transmission-id": "tid",
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "2026-10-27T10:00:00Z",
  };
  const raw = '{"id":"WH-1","event_type":"PAYMENT.PAYOUTS-ITEM.SUCCEEDED","resource":{"amount":{"value":"10.00"},"z":1.0,"a":2}}';

  it("embeds the raw event bytes unchanged", () => {
    const body = buildVerificationBody(headers, "WEBHOOK123", raw);
    expect(body.endsWith(`"webhook_event":${raw}}`)).toBe(true);
    expect(JSON.parse(body)).toMatchObject({ webhook_id: "WEBHOOK123", transmission_id: "tid", webhook_event: { id: "WH-1" } });
  });

  it("accepts only verification_status SUCCESS", async () => {
    let verdict = "SUCCESS";
    const { client, calls } = await fakePayPal((_, response) => json(response, 200, { verification_status: verdict }));
    expect(await verifyWebhookSignature(client, headers, "WEBHOOK123", raw)).toBe(true);
    expect(apiCalls(calls)[0]?.body.includes(`"webhook_event":${raw}`)).toBe(true);
    verdict = "FAILURE";
    expect(await verifyWebhookSignature(client, headers, "WEBHOOK123", raw)).toBe(false);
  });
});
