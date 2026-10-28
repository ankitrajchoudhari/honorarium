# Honorarium

Verify study responses, then pay real participants through PayPal.

Honorarium is for university research labs that pay participants in online surveys recruited through open links, and for the ethics boards (IRBs) that oversee them. Every respondent is checked against exclusion rules the lab locked before seeing the data, then gets one of three decisions with evidence: **Pay**, **Hold for review** or **Don't pay**. A person reviews the holds, the PI approves a batch, and PayPal Payouts sends the money. An append-only ledger accounts for every cent, and the ethics report records what happened.

All payments are PayPal **sandbox** test money.

## The problem

When a study is advertised on social media, mailing lists or posters, bots and fraudsters flood it for the payment:

- Fraudulent responses are commonly estimated at 15–30%, and up to 45% on some platforms (NORC literature review, 2026).
- Published cases: 981 responses in 4 hours with only 3 genuine; 94.5% fraudulent in a health study; over 95% bots from Twitter recruitment; 4 valid out of 1,200+ voucher claims.
- AI-written answers passed 99.8% of standard quality checks in a 2025 test.
- Johns Hopkins guidance (2025) says not to pay automatically on completion, to verify first and to state exclusion rules in the consent form. Manual review works, but it is slow and costly.

Sources are listed in [DATA_SOURCES.md](DATA_SOURCES.md).

## How it works

```
 plain-English rules ──Gemini──▶ exact rule checks ──researcher locks (sha256)──┐
                                                                                ▼
 CSV export ──▶ column mapping ──▶ verification job (resumable, chunked)
                                    1. locked rules        (can exclude)
                                    2. similarity clusters (can only hold)
                                    3. Gemini open-text    (can only hold)
                                                │
                       Pay ◀────────────────────┼────────────▶ Don't pay
                                                ▼
                                          Hold for review ──▶ human decides, with a reason
                                                │
                     pre-flight checks ──▶ PI types study code ──▶ PayPal Payouts batch
                                                │
                     webhooks (signature-verified) + polling ──▶ item statuses ──▶ ledger
                                                │
                                          ethics report
```

## How PayPal is used

- **Payouts batches.** `POST /v1/payments/payouts` with one item per participant (EMAIL or PHONE recipients), split at the verified limit of 15,000 items per batch. The item note is a thank-you with the study title and never mentions fraud checks.
- **Idempotency.** Each batch has a deterministic `sender_batch_id` (`hon_<code>_<study id prefix>_<n>`), and every POST sends a `PayPal-Request-Id` derived from our own row ID. A timeout is retried with the same IDs, so PayPal cannot create a second batch. The approval form carries a one-time nonce, and Postgres unique indexes stop a respondent or a payout identity from being in two live payouts.
- **OAuth.** The client-credentials token is cached until about 60 seconds before expiry and refreshed once on a 401. Requests time out after 15 s and are retried once on a network error or 5xx.
- **Item tracking.** Every item status (`PENDING`, `ONHOLD`, `UNCLAIMED`, `SUCCESS`, `FAILED`, `RETURNED`, `BLOCKED`, `REFUNDED`, `REVERSED`) goes through one state machine that only moves forward, so a late `PENDING` never overwrites `SUCCESS`. PayPal's `debug_id` is kept and shown on errors.
- **Webhooks.** `/api/webhooks/paypal` reads the raw body and verifies it with `POST /v1/notifications/verify-webhook-signature`, passing the event bytes unchanged. Unverified events are stored and never processed. Events are deduplicated by event ID and processed after the 200 response. A redelivery that verifies after an earlier failure is still processed.
- **Polling fallback.** The payouts page refreshes every 20 s while items are in flight, and has a "Refresh statuses" button. Polling uses the same transition rules.
- **Failures and unclaimed money.** Failed items return to the review queue with PayPal's reason in plain English. A new batch only re-sends items whose address was corrected. Unclaimed items show the days left of PayPal's 30-day return period and can be cancelled (`POST /v1/payments/payouts-item/{id}/cancel`). The money returns to the budget only when PayPal confirms.
- **Venmo.** The current API selects Venmo with `recipient_wallet: VENMO` and a US phone number. The sandbox rejects that wallet ("Recipient wallet not supported in sandbox"), so the option is shown switched off with that explanation.

Details and probe results are in [docs/api-findings.md](docs/api-findings.md).

## How AI is used

The model is **Gemini `gemini-3.5-flash-lite`** (set by `GEMINI_MODEL`) through `@google/genai`, using `generateContent` with a JSON schema for structured output. It has two jobs:

1. **Compiling rules.** It turns the researcher's plain-English exclusion rules into a typed rule format, validated with zod, and lists any phrase it could not turn into a rule. It never adds rules the researcher didn't write. The researcher reads each rule back in plain English, can edit thresholds, and locks the set.
2. **Assessing open-text answers** in batches of up to 20. It labels answers as off topic, contradicting the respondent's own closed answers, gibberish, or reading like a generic template. Each label comes with a confidence, an exact quote and a one-sentence explanation. Medium and high labels cause a review, and low labels are notes.

**AI can never deny payment.** Only locked, deterministic rules can produce Don't pay. The decision combiner and its tests enforce this at the type level and at runtime. The worst a wrong or manipulated AI label can do is send a response to a human. Answers the AI could not assess (quota, outage, malformed output) are held, never paid. Text is never called "AI-written".

**Data sent to Gemini:** pseudonymous refs (`R-0147`), question wording, answer text with emails, phone numbers and IPs redacted, and two to four closed answers the researcher mapped. **Never sent:** payout emails or phones, names, IPs, user agents or any other identifier. A payload check refuses to send if any respondent identifier appears. Answer text is wrapped as escaped JSON data, and the system instruction states that it is never instructions. The sample includes prompt-injection answers to test this.

Results are cached by sha256 of model, prompt version and payload. Calls are spaced 4 s apart for the free-tier 15 RPM, retried with backoff on 429, and capped per day by `AI_DAILY_CALL_LIMIT`.

## Safety design

- Rules are locked with a sha256 hash of their canonical JSON before any data can be imported. Later changes create a new version, which the report shows.
- A shared IP can at most cause a review, so students on campus Wi-Fi are never excluded for it. Shared payout emails link the respondents for review, and only a locked "one payment per identity" rule excludes later duplicates, keeping the earliest.
- Gmail dot, `+tag` and `googlemail.com` variants are normalized before duplicate checks. The raw address is kept for paying.
- Reviewers must give a reason. Overriding a rule-based Don't pay needs a written justification of at least 20 characters and is highlighted in the report. An optional two-reviewer mode resolves a hold only when two different reviewers agree.
- **Ledger invariant:** `budget = unallocated + allocated_pay + held_review + in_flight + paid + unclaimed`, checked inside every write transaction. If it fails, the write rolls back and payouts are blocked. Money for held respondents is reserved, so pending reviews can't be overspent.
- Every study read is scoped to the browser's signed workspace cookie (HMAC, HttpOnly, SameSite=Lax, Secure on HTTPS). Payout identities are masked, and every reveal is audit-logged. Participant text is rendered as text only. CSV exports escape formula-leading cells. Imports, AI jobs and payout batches are rate-limited.
- Every response carries a Content-Security-Policy (same-origin scripts, styles, images and connections; no framing; no `eval`), HSTS, `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy`. Senders of events that fail webhook verification are rate-limited before PayPal is asked again, and only the event ID and type of an unverified event are stored.

## How it differs from existing tools

Incentive platforms such as Tremendous check payment-side signals. Panel platforms such as Prolific and Respondent pay only within their own panels. Honorarium is for researcher-run studies with open recruitment. It combines answer-level and payment-level checks in one verify-then-pay flow, pays through PayPal, and produces an audit trail for the ethics board.

## Results on the sample study

518 synthetic responses, $1,500 budget, $10 per participant (patterns in [data/sample/MANIFEST.md](data/sample/MANIFEST.md)):

| | Count |
|---|---|
| Pay | 48 (the 48 genuine respondents) |
| Hold for review | 78 (templated answers, AI flags, contradictions, prompt injection, unusable payout identities) |
| Don't pay | 392 (bot burst, speeders, failed attention check, hidden field, ineligible age, later Gmail duplicates) |
| Campus Wi-Fi students (12 sharing one IP) | all 12 Pay |

A real sandbox run sent all Pay decisions in one batch: items addressed to sandbox accounts reached `SUCCESS`, `example.org` recipients stayed `UNCLAIMED`, and the ledger stayed balanced throughout.

Tests: 123 unit tests (engine, ledger, PayPal client and state machine, AI payload and injection fixtures, CSV, money, chart data), 7 database integration tests (workspace isolation, double approval, webhook replay and out-of-order events, failed-payout ledger path), and one Playwright end-to-end run against the real sandbox. Lighthouse accessibility scores 100 on every page of the production build; no page scrolls sideways at 375px in light or dark mode.

## Limitations

- Sandbox only, and USD only.
- CSV import only. There is no live Qualtrics, REDCap or Google Forms connection.
- AI labels can be wrong. That is why they only ever cause a review.
- No detector stops every sophisticated fraud. Honorarium makes fraud expensive and decisions accountable.
- It is not a replacement for IRB judgement.

## Run it yourself

Requirements: Node 22+, a free [Neon](https://neon.tech) Postgres database, a PayPal developer sandbox app, and a Gemini API key from [AI Studio](https://aistudio.google.com/apikey).

```bash
npm ci
cp .env.example .env.local      # fill in every value; see comments in the file
npm run db:migrate
npm run dev                     # http://localhost:3000
```

The app refuses to start with `PAYPAL_ENV` set to anything but `sandbox`, and shows a setup page if a variable is missing.

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Unit tests (no network) |
| `npm run test:integration` | Integration tests against the database in `.env.local` (PayPal faked; cleans up after itself) |
| `npm run test:e2e` | Playwright happy path against a running app, real Gemini and the PayPal sandbox (manual, not in CI) |
| `npm run probe:paypal` | Sandbox smoke test: token, a 1-item payout, status, an error simulation |
| `npm run probe:gemini` | Checks the Gemini model and structured output |
| `npm run sample:generate` | Regenerates the synthetic sample CSV and manifest (uses `SANDBOX_RECEIVERS`) |
| `npm run lint` / `npm run typecheck` | Static checks (also run in CI with the build) |

## Judge testing

1. Open the hosted demo: https://honorarium-ruby.vercel.app Each browser gets its own private workspace.
2. Click **Open the sample study**. The rules are already locked, and verification starts at once.
3. Open any row for its evidence, or go to **Review** to decide the holds (keys `J`/`K`, `P`, `D`, `/`).
4. On **Payouts**, type `SLEEP-26` to approve. Statuses update from PayPal, and the money strip and **Ledger** follow.
5. To see a received payment, log in at [sandbox.paypal.com](https://www.sandbox.paypal.com) with a sandbox receiver account: `<sandbox receiver logins>`.

## Built with

Next.js 16 (App Router), TypeScript (strict), Tailwind CSS 4, Radix UI, AG Grid, Recharts (charts), three.js with React Three Fiber (the home page coins), Google Material icons via react-icons, Drizzle ORM on Neon Postgres, zod, Papa Parse, Vitest and Playwright. The logo and sticker illustrations are original SVG artwork. Development was assisted by Claude Code.

## Licence

MIT.
