import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { workspaces } from "@/db/schema";
import { env } from "@/lib/env";
import { sign, verify } from "@/lib/signing";

const WORKSPACE_COOKIE = "hon_ws";
const REVIEWER_COOKIE = "hon_reviewer";
const ONE_YEAR = 60 * 60 * 24 * 365;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface Workspace {
  id: string;
  name: string;
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env().APP_BASE_URL.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: ONE_YEAR,
  };
}

/** The visitor's workspace, or null if they have none yet. Never creates one. */
export async function currentWorkspace(): Promise<Workspace | null> {
  const store = await cookies();
  const raw = store.get(WORKSPACE_COOKIE)?.value;
  const workspaceId = raw ? verify(raw, env().SESSION_SECRET) : null;
  if (!workspaceId || !UUID.test(workspaceId)) {
    return null;
  }
  const [row] = await db().select({ id: workspaces.id, name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId));
  return row ?? null;
}

/** Returns the visitor's workspace, creating one (and setting the signed cookie) on first write. */
export async function ensureWorkspace(): Promise<Workspace> {
  const existing = await currentWorkspace();
  if (existing) {
    await db().update(workspaces).set({ lastActiveAt: new Date() }).where(eq(workspaces.id, existing.id));
    return existing;
  }
  const [created] = await db().insert(workspaces).values({ name: "My workspace" }).returning({ id: workspaces.id, name: workspaces.name });
  if (!created) {
    throw new Error("Could not create a workspace.");
  }
  const store = await cookies();
  store.set(WORKSPACE_COOKIE, sign(created.id, env().SESSION_SECRET), cookieOptions());
  return created;
}

/** For pages and actions on a study: a browser without a workspace (e.g. a shared link in a private window) gets the 404 page, never an error. */
export async function requireWorkspace(): Promise<Workspace> {
  const workspace = await currentWorkspace();
  if (!workspace) {
    notFound();
  }
  return workspace;
}

export async function clearWorkspaceCookie(): Promise<void> {
  const store = await cookies();
  store.delete(WORKSPACE_COOKIE);
}

/** The name this browser records on review decisions and approvals. */
export async function reviewerName(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(REVIEWER_COOKIE)?.value;
  const value = raw ? verify(raw, env().SESSION_SECRET) : null;
  return value ? decodeURIComponent(value) : null;
}

export async function setReviewerName(name: string): Promise<void> {
  const store = await cookies();
  store.set(REVIEWER_COOKIE, sign(encodeURIComponent(name), env().SESSION_SECRET), cookieOptions());
}
