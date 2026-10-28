import { createHmac, timingSafeEqual } from "node:crypto";

/** "value.signature" with an HMAC-SHA256 over the value. */
export function sign(value: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(value).digest("base64url");
  return `${value}.${signature}`;
}

/** Returns the value when the signature is valid, otherwise null. Constant-time comparison. */
export function verify(signed: string, secret: string): string | null {
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) {
    return null;
  }
  const value = signed.slice(0, dot);
  const expected = Buffer.from(sign(value, secret).slice(dot + 1));
  const actual = Buffer.from(signed.slice(dot + 1));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  return value;
}
