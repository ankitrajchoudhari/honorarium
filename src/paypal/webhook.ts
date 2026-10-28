import type { PayPalClient } from "@/paypal/client";

export const SIGNATURE_HEADERS = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"] as const;

export type SignatureHeaders = Record<(typeof SIGNATURE_HEADERS)[number], string>;

export function readSignatureHeaders(headers: Headers): SignatureHeaders | null {
  const result: Partial<SignatureHeaders> = {};
  for (const name of SIGNATURE_HEADERS) {
    const value = headers.get(name);
    if (!value) {
      return null;
    }
    result[name] = value;
  }
  return result as SignatureHeaders;
}

/**
 * The verification body must carry the event exactly as PayPal sent it. Parsing and re-serializing could change
 * the bytes, so the raw body text is inserted unchanged as the webhook_event value.
 */
export function buildVerificationBody(headers: SignatureHeaders, webhookId: string, rawEvent: string): string {
  const fields = JSON.stringify({
    auth_algo: headers["paypal-auth-algo"],
    cert_url: headers["paypal-cert-url"],
    transmission_id: headers["paypal-transmission-id"],
    transmission_sig: headers["paypal-transmission-sig"],
    transmission_time: headers["paypal-transmission-time"],
    webhook_id: webhookId,
  });
  return `${fields.slice(0, -1)},"webhook_event":${rawEvent.trim()}}`;
}

export async function verifyWebhookSignature(client: PayPalClient, headers: SignatureHeaders, webhookId: string, rawEvent: string): Promise<boolean> {
  const result = await client.request("POST", "/v1/notifications/verify-webhook-signature", { rawBody: buildVerificationBody(headers, webhookId, rawEvent) });
  if (!result.ok) {
    return false;
  }
  const status = typeof result.body === "object" && result.body !== null ? (result.body as Record<string, unknown>).verification_status : undefined;
  return status === "SUCCESS";
}
