import "server-only";
import { and, count, eq, gt, lt } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { rateLimitHits } from "@/db/schema";

export class RateLimitError extends Error {}

/** True when the key already has `limit` hits inside the window. Does not record a hit. */
export async function isLimited(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const since = new Date(Date.now() - windowSeconds * 1000);
  const [row] = await db()
    .select({ total: count() })
    .from(rateLimitHits)
    .where(and(eq(rateLimitHits.key, key), gt(rateLimitHits.createdAt, since)));
  return (row?.total ?? 0) >= limit;
}

export async function recordHit(key: string): Promise<void> {
  await db().insert(rateLimitHits).values({ key });
}

/** Counts hits for a key over a sliding window; refuses when the limit is reached. */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  if (await isLimited(key, limit, windowSeconds)) {
    const minutes = Math.ceil(windowSeconds / 60);
    throw new RateLimitError(`Too many requests. This action is limited to ${limit} per ${minutes >= 60 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minutes`}.`);
  }
  await recordHit(key);
  if (Math.random() < 0.02) {
    await db().delete(rateLimitHits).where(lt(rateLimitHits.createdAt, new Date(Date.now() - 86_400_000)));
  }
}

export async function clientIp(): Promise<string> {
  const store = await headers();
  return store.get("x-forwarded-for")?.split(",")[0]?.trim() || store.get("x-real-ip") || "unknown";
}

/** Applies the same limit per workspace and per IP. */
export async function rateLimitAction(action: string, workspaceId: string, limit: number, windowSeconds: number): Promise<void> {
  const ip = await clientIp();
  await rateLimit(`${action}:ws:${workspaceId}`, limit, windowSeconds);
  await rateLimit(`${action}:ip:${ip}`, limit * 3, windowSeconds);
}
