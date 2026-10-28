export type PayPalResult =
  | { ok: true; status: number; body: unknown; debugId: string | null }
  | {
      ok: false;
      status: number | null;
      name: string;
      message: string;
      issues: string[];
      debugId: string | null;
      /** True when PayPal never gave a definite answer (timeout, network, 5xx), so the outcome is unknown. */
      uncertain: boolean;
    };

export interface PayPalClientOptions {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

const TOKEN_MARGIN_MS = 60_000;

function field(source: unknown, key: string): unknown {
  return typeof source === "object" && source !== null ? (source as Record<string, unknown>)[key] : undefined;
}

function text(source: unknown, key: string): string | null {
  const value = field(source, key);
  return typeof value === "string" ? value : null;
}

/**
 * Minimal PayPal REST client: cached OAuth token (refreshed once on 401), idempotent POSTs via PayPal-Request-Id,
 * a 15 s timeout and one retry with the same request id on network errors or 5xx.
 */
export class PayPalClient {
  private token: CachedToken | null = null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: PayPalClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async fetchToken(): Promise<string> {
    const response = await this.fetchImpl(`${this.options.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body: unknown = await response.json().catch(() => null);
    const value = text(body, "access_token");
    const expiresIn = field(body, "expires_in");
    if (!response.ok || !value || typeof expiresIn !== "number") {
      throw new Error(`PayPal authentication failed (HTTP ${response.status}). Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.`);
    }
    this.token = { value, expiresAt: Date.now() + expiresIn * 1000 - TOKEN_MARGIN_MS };
    return value;
  }

  private async accessToken(force: boolean): Promise<string> {
    if (!force && this.token && this.token.expiresAt > Date.now()) {
      return this.token.value;
    }
    return this.fetchToken();
  }

  private async send(method: "GET" | "POST", path: string, body: string | undefined, requestId: string | undefined, token: string): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    if (requestId) {
      headers["PayPal-Request-Id"] = requestId;
    }
    return this.fetchImpl(`${this.options.baseUrl}${path}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  /** `rawBody` is sent byte-for-byte (used for webhook verification); otherwise `body` is JSON-encoded. */
  async request(method: "GET" | "POST", path: string, options: { body?: unknown; rawBody?: string; requestId?: string } = {}): Promise<PayPalResult> {
    const payload = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    let token: string;
    try {
      token = await this.accessToken(false);
    } catch (error) {
      return { ok: false, status: null, name: "AUTHENTICATION_FAILED", message: error instanceof Error ? error.message : "PayPal authentication failed.", issues: [], debugId: null, uncertain: false };
    }

    let refreshed = false;
    let retried = false;
    for (;;) {
      let response: Response;
      try {
        response = await this.send(method, path, payload, options.requestId, token);
      } catch (error) {
        if (!retried) {
          retried = true;
          continue;
        }
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        return {
          ok: false,
          status: null,
          name: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
          message: timedOut ? "PayPal did not answer within 15 seconds." : "Could not reach PayPal.",
          issues: [],
          debugId: null,
          uncertain: true,
        };
      }

      if (response.status === 401 && !refreshed) {
        refreshed = true;
        try {
          token = await this.accessToken(true);
        } catch (error) {
          return { ok: false, status: 401, name: "AUTHENTICATION_FAILED", message: error instanceof Error ? error.message : "PayPal authentication failed.", issues: [], debugId: null, uncertain: false };
        }
        continue;
      }
      if (response.status >= 500 && !retried) {
        retried = true;
        continue;
      }

      const raw = await response.text();
      let parsed: unknown = null;
      try {
        parsed = raw.length > 0 ? JSON.parse(raw) : null;
      } catch {
        parsed = null;
      }
      const debugId = text(parsed, "debug_id") ?? response.headers.get("paypal-debug-id");
      if (response.ok) {
        return { ok: true, status: response.status, body: parsed, debugId };
      }
      const details = field(parsed, "details");
      const issues = Array.isArray(details)
        ? details.map((detail) => [text(detail, "issue"), text(detail, "description")].filter(Boolean).join(": ")).filter((entry) => entry.length > 0)
        : [];
      return {
        ok: false,
        status: response.status,
        name: text(parsed, "name") ?? `HTTP_${response.status}`,
        message: text(parsed, "message") ?? `PayPal returned HTTP ${response.status}.`,
        issues,
        debugId,
        uncertain: response.status >= 500,
      };
    }
  }
}
