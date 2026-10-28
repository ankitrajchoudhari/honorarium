# API findings (Phase 0)

## Probe results (sandbox, 2026-10-27)

| Check | Result |
|---|---|
| OAuth token | OK, `expires_in` = 32,400 s (9 h) |
| Create 2-item batch | HTTP 201, `PENDING` → `PROCESSING` → `SUCCESS` (about 25 s) |
| Reused `sender_batch_id` | HTTP 400 `USER_BUSINESS_ERROR` "Batch with given sender_batch_id already exists". Idempotency confirmed |
| Simulator receiver | Item `SUCCESS` |
| Unknown `@example.org` receiver | Item `UNCLAIMED`, `errors.name = RECEIVER_UNREGISTERED` |
| Cancel while batch is `PROCESSING` | HTTP 400 `BATCH_NOT_COMPLETED`: only possible once the batch is processed |
| Cancel after batch `SUCCESS` | **HTTP 500 `INTERNAL_SERVICE_ERROR` twice** (debug_ids `f7616744fe9c7`, `f7434337c44bd`); item stays `UNCLAIMED` |
| Cancel with test value `POSPOI002` | HTTP 200 `RETURNED`, so the request shape is correct and the 500 is a sandbox fault |
| `note = ERRPYO002` | HTTP 403 `SENDER_EMAIL_UNCONFIRMED`, as documented |
| Venmo wallet item | HTTP 400 `VALIDATION_ERROR` "**Recipient wallet not supported in sandbox.**" Venmo is shown disabled with the honest note |

Gemini probe (3 synthetic answers, one a prompt injection, structured JSON):

| Model | Time | Result |
|---|---|---|
| `gemini-3.8-flash` | 201 s; 139 s with `thinkingLevel: LOW` | Correct labels; free-tier queueing makes it unusable |
| `gemini-3.6-flash` | HTTP 503 "high demand" | No answer |
| **`gemini-3.5-flash-lite`** | **1.5–2.4 s** | Same correct labels; the injection was only labelled `off_topic`. **Chosen** |

The app will keep `thinkingLevel: LOW`, set a request timeout, and treat a 503 like a 429 (backoff, then hold unassessed answers).

Consequences for Phase 5: "Cancel unclaimed" is only enabled once the batch is `SUCCESS`. A PayPal 500 is shown as "PayPal could not cancel this payout right now" with the debug_id and a retry option. The ledger moves money back only after PayPal reports `RETURNED`.

Checked on 2026-10-27 against the official docs and OpenAPI specs. Items marked **probe pending** are confirmed in the docs but not yet observed in a real sandbox call. They are settled when `npm run probe:paypal` and `npm run probe:gemini` run with real credentials.

## PayPal Payouts

Source: `https://developer.paypal.com/api/payments.payouts-batch/v1/schema.json` (OpenAPI 3.2), the Payouts "Test and go live" page, and the webhook event names page.

### Endpoints (sandbox base `https://api-m.sandbox.paypal.com`)

| Purpose | Method and path |
|---|---|
| OAuth token | `POST /v1/oauth2/token` (`grant_type=client_credentials`, Basic auth) |
| Create batch | `POST /v1/payments/payouts` (accepts `PayPal-Request-Id`) |
| Show batch | `GET /v1/payments/payouts/{payout_batch_id}` (`page`, `page_size`, `total_required`) |
| Show item | `GET /v1/payments/payouts-item/{payout_item_id}` |
| Cancel unclaimed item | `POST /v1/payments/payouts-item/{payout_item_id}/cancel` |
| Verify webhook signature | `POST /v1/notifications/verify-webhook-signature` |

### Limits and idempotency

- **Items per batch: 15,000** (`payout_item_request_list.maxItems`; the API description also says "up to 15,000 payments per call").
- `sender_batch_id`: PayPal rejects a reused ID for **30 days**. This is our main protection against double payment on retry.
- `PayPal-Request-Id`: PayPal stores the keys for **30 days**.
- Rate limit: the docs give **400** for Payouts POST calls (the unit isn't stated). Going over returns HTTP 429 `RATE_LIMIT_REACHED`. The docs recommend webhooks over polling and caching the OAuth token.
- Notes: an item `note` allows up to 4,000 ASCII or 1,000 non-ASCII characters. The batch note and item note together are limited to 1,000 characters in the email.

### Statuses

- **Batch** (`batch_status`): `DENIED`, `PENDING`, `PROCESSING`, `SUCCESS`, `CANCELED`. Batch `SUCCESS` only means processing finished; each item can still be held or unclaimed.
- **Item** (`transaction_status`): `SUCCESS`, `FAILED`, `PENDING`, `UNCLAIMED`, `RETURNED`, `ONHOLD`, `BLOCKED`, `REFUNDED`, `REVERSED`.
  - `UNCLAIMED`: the recipient has no PayPal account. **The money returns after 30 days** if it isn't claimed.
  - Cancelling an unclaimed item returns `transaction_status = RETURNED`. There is no `CANCELED` item status in the enum, although a `PAYMENT.PAYOUTS-ITEM.CANCELED` webhook exists. The state machine will treat both as "money back to budget".
  - `REVERSED` is documented as specific to web uploads, so we don't expect it from the API. We'll still handle it.

### Webhook events (11)

`PAYMENT.PAYOUTSBATCH.DENIED`, `PAYMENT.PAYOUTSBATCH.PROCESSING`, `PAYMENT.PAYOUTSBATCH.SUCCESS`, `PAYMENT.PAYOUTS-ITEM.BLOCKED`, `PAYMENT.PAYOUTS-ITEM.CANCELED`, `PAYMENT.PAYOUTS-ITEM.FAILED`, `PAYMENT.PAYOUTS-ITEM.HELD`, `PAYMENT.PAYOUTS-ITEM.REFUNDED`, `PAYMENT.PAYOUTS-ITEM.RETURNED`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `PAYMENT.PAYOUTS-ITEM.UNCLAIMED`.

- Batch events don't carry item details.
- Webhook resources **don't include error objects**. To show why an item failed, we GET the item.

### Webhook signature verification

The request body needs `auth_algo`, `cert_url`, `transmission_id`, `transmission_sig`, `transmission_time` (from the `PAYPAL-*` headers), plus `webhook_id` and `webhook_event`. The response is `verification_status: SUCCESS | FAILURE`. `webhook_event` must be the event exactly as received. Parsing it and serializing it again can change the bytes, so the route will insert the raw body text into the verification request unchanged.

### Sandbox test values (case-sensitive)

- Create payout, put in `items[0].note`: `ERRPYO002` → `SENDER_EMAIL_UNCONFIRMED`. The table also lists `ERRPYO001`, `003`, `005`, `006`, `010`, `011`, `012`, `014` and `035`–`040` (restricted sender, insufficient funds, rate limit, timeout and others). `POSPYO001` forces a 201. `POSPYO003` forces a 201 for a Venmo receiver.
- `ERRPYO013`, put in `items[0].sender_batch_id`: Venmo validation error for a missing note.
- Path-parameter values for show batch, show item and cancel, for example `ERRPYOB001`–`ERRPYOB004` force a batch status of `SUCCESS`, `PENDING`, `PROCESSING` or `DENIED`. `ERRPYO007` simulates an item that was already cancelled.
- Sandbox simulator receiver: `payouts-simulator-receiver@paypal.com`.

### Venmo: conflicts with the spec (decision needed)

The spec plans Venmo as `recipient_type: USER_HANDLE` with a normalized `@handle`. **The current API has no `USER_HANDLE`.** `recipient_type` is `EMAIL | PHONE | PAYPAL_ID`. Venmo is chosen with `recipient_wallet: "VENMO"` and needs a **US mobile number** (`PHONE`) and a `note`. Proposal: drop the `venmo_handle` column role. A US phone number with "Pay to Venmo" sets `recipient_wallet: VENMO`. **Probe result: the sandbox rejects the Venmo wallet** ("Recipient wallet not supported in sandbox."). The option is shown disabled with the note "Venmo payouts are tested in live mode only".

## Gemini

Sources: ai.google.dev models, pricing, structured output and text generation pages, and the `@google/genai` 2.31.0 type definitions.

- SDK: `@google/genai` **2.31.0**. Both `ai.models.generateContent` and the newer `ai.interactions.create` exist. Google's docs say generateContent "remains fully supported".
- **Choice: `generateContent`** with `systemInstruction`, `responseMimeType: "application/json"` and `responseJsonSchema` (standard JSON Schema built from zod with `z.toJSONSchema`). Reasons: it is stateless, while Interactions stores state server-side by default (`store: true`). Its fields are stable, while the Interactions response shape changed shortly after release.
- Free-tier text models (pricing page): `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3-flash-preview`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`. `.env.local` now uses `gemini-3.5-flash-lite` (stable), chosen on measured speed (see Probe results).
- Free-tier RPM/RPD aren't published in the docs, only in AI Studio. **Please check AI Studio → Rate limits and tell me the RPD for the chosen model**, so I can set `AI_DAILY_CALL_LIMIT` below it.

### Conflicts with the spec

1. **`temperature: 0` isn't possible.** The docs say Gemini 4 and Gemini 3.6+ models ignore custom `temperature`/`top_p`/`top_k` and return deprecation warnings. We won't send temperature. Repeatability comes from the `ai_cache` (same input, same stored output), schema validation, and the rule that AI can only cause a review.
2. **Free-tier data is "used to improve our products"** (pricing page). This is acceptable because Honorarium only sends synthetic data and pseudonymous refs. The ethics report's data statement and the README must say so plainly.

## Neon Postgres

- Project `steep-sky-56379920`, region `aws-us-east-2`, Postgres 18.6, compute 0.25–2 CU, 6 h history retention (Free plan limits). Only Postgres is used; Neon auth, AI gateway, object storage, functions and realtime are not provisioned because Honorarium doesn't need them.
- Pooled connection string fetched with `neon connection-string production --pooled` and written to `.env.local` only. The home page system check reports "Connected · Postgres 18.6".
- US East sits next to Vercel's default region (`iad1`), so production queries stay short. Local development from India adds network latency.

## Gemini free-tier limits (AI Studio, 2026-10-27)

| Model | RPM | TPM | RPD |
|---|---|---|---|
| `gemini-3.5-flash-lite` (chosen) | 15 | 250K | 500 |
| `gemini-3.8-flash` | 5 | 250K | 20 |
| `gemini-3.6-flash` | 5 | 250K | 20 |

`AI_DAILY_CALL_LIMIT=400` stays below the 500 RPD. AI jobs space calls at least 4 s apart (15 RPM).

## Tooling notes

- `npm audit`: 4 moderate advisories, all in `drizzle-kit` (dev only) through an old `esbuild` dev server. They aren't in the deployed app. No fix exists without a drizzle-kit beta.
- Next.js 16.4.3 with `cacheComponents` enabled. Data reads render inside `<Suspense>` after `await connection()`.
- `drizzle.config.ts` points at `src/db/schema.ts`, which Phase 2 creates. No migration commands are wired up until then.
