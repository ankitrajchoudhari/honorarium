import "server-only";
import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db/client";
import { aiCache, aiUsage } from "@/db/schema";
import { canonicalJson, sha256Hex } from "@/engine/canonical";
import { env } from "@/lib/env";

/** Free tier allows 15 requests per minute for the chosen model; one call every 4 seconds stays under it. */
export const MIN_CALL_SPACING_MS = 4_000;
const REQUEST_TIMEOUT_MS = 60_000;

export type AiFailure =
  | { ok: false; kind: "cap_reached"; message: string }
  | { ok: false; kind: "too_soon"; retryAfterMs: number; message: string }
  | { ok: false; kind: "rate_limited" | "unavailable"; message: string }
  | { ok: false; kind: "invalid_output"; message: string }
  | { ok: false; kind: "failed"; message: string };

export type AiResult<T> = { ok: true; data: T; cached: boolean; calls: number } | AiFailure;

export interface StructuredRequest<T> {
  promptVersion: string;
  systemInstruction: string;
  /** Everything the model sees besides the system instruction. Serialized as JSON, never concatenated into instructions. */
  payload: unknown;
  schema: z.ZodType<T>;
  jsonSchema: unknown;
  /** Extra checks beyond the schema, e.g. "one result per input item". Return an error message or null. */
  validate?: (data: T) => string | null;
}

let client: GoogleGenAI | undefined;

function genai(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: env().GEMINI_API_KEY });
  return client;
}

export function aiModel(): string {
  return env().GEMINI_MODEL;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Atomically claims one call from today's global budget while keeping calls spaced out. */
async function claimCall(): Promise<AiFailure | null> {
  const limit = env().AI_DAILY_CALL_LIMIT;
  const day = today();
  const claimed = await db().execute(sql`
    insert into ${aiUsage} (day, calls, last_call_at) values (${day}, 1, now())
    on conflict (day) do update set calls = ${aiUsage}.calls + 1, last_call_at = now()
    where ${aiUsage}.calls < ${limit}
      and (${aiUsage}.last_call_at is null or ${aiUsage}.last_call_at < now() - make_interval(secs => ${MIN_CALL_SPACING_MS / 1000}))
    returning calls`);
  if (claimed.rows.length > 0) {
    return null;
  }
  const [row] = await db().select().from(aiUsage).where(eq(aiUsage.day, day));
  if (row && row.calls >= limit) {
    return { ok: false, kind: "cap_reached", message: `The daily limit of ${limit} AI calls for this demo has been reached.` };
  }
  const waited = row?.lastCallAt ? Date.now() - row.lastCallAt.getTime() : MIN_CALL_SPACING_MS;
  return { ok: false, kind: "too_soon", retryAfterMs: Math.max(250, MIN_CALL_SPACING_MS - waited), message: "Waiting to stay within the rate limit." };
}

export async function aiUsageToday(): Promise<{ calls: number; limit: number }> {
  const [row] = await db().select().from(aiUsage).where(eq(aiUsage.day, today()));
  return { calls: row?.calls ?? 0, limit: env().AI_DAILY_CALL_LIMIT };
}

function classify(error: unknown): AiFailure {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return { ok: false, kind: "rate_limited", message: "Gemini rate limit reached (HTTP 429)." };
    }
    if (error.status >= 500) {
      return { ok: false, kind: "unavailable", message: `Gemini is unavailable right now (HTTP ${error.status}).` };
    }
    return { ok: false, kind: "failed", message: `Gemini rejected the request (HTTP ${error.status}).` };
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return { ok: false, kind: "unavailable", message: "Gemini did not answer within 60 seconds." };
  }
  return { ok: false, kind: "unavailable", message: "Could not reach Gemini." };
}

async function generate(system: string, contents: string, jsonSchema: unknown): Promise<string | AiFailure> {
  try {
    const response = await genai().models.generateContent({
      model: aiModel(),
      contents,
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        httpOptions: { retryOptions: { attempts: 1 } },
      },
    });
    return response.text ?? { ok: false, kind: "invalid_output", message: "Gemini returned an empty response." };
  } catch (error) {
    return classify(error);
  }
}

function parse<T>(raw: string, request: StructuredRequest<T>): { data: T } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { error: "The response was not valid JSON." };
  }
  const parsed = request.schema.safeParse(json);
  if (!parsed.success) {
    return { error: parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  }
  const extra = request.validate?.(parsed.data) ?? null;
  return extra ? { error: extra } : { data: parsed.data };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One structured Gemini call with caching, the global daily cap, call spacing and schema validation.
 * Malformed output is retried once with the validation error appended; then it fails.
 */
export async function callStructured<T>(request: StructuredRequest<T>): Promise<AiResult<T>> {
  const payloadJson = canonicalJson(request.payload);
  const hash = sha256Hex(`${aiModel()}\n${request.promptVersion}\n${payloadJson}`);
  const [hit] = await db().select().from(aiCache).where(eq(aiCache.hash, hash));
  if (hit) {
    const parsed = request.schema.safeParse(hit.outputJson);
    if (parsed.success) {
      return { ok: true, data: parsed.data, cached: true, calls: 0 };
    }
  }

  let contents = payloadJson;
  let calls = 0;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let gate = await claimCall();
    if (gate?.kind === "too_soon" && attempt === 2) {
      await wait(gate.retryAfterMs);
      gate = await claimCall();
    }
    if (gate) {
      return gate;
    }
    calls += 1;
    const raw = await generate(request.systemInstruction, contents, request.jsonSchema);
    if (typeof raw !== "string") {
      return raw;
    }
    const result = parse(raw, request);
    if ("data" in result) {
      await db().insert(aiCache).values({ hash, model: aiModel(), promptVersion: request.promptVersion, outputJson: result.data as object }).onConflictDoNothing();
      return { ok: true, data: result.data, cached: false, calls };
    }
    contents = canonicalJson({ input: request.payload, previous_output_error: `Your previous output was rejected: ${result.error}. Return JSON that matches the schema exactly.` });
  }
  return { ok: false, kind: "invalid_output", message: "Gemini returned output that did not match the required format twice." };
}
