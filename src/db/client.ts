import { Pool } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { env } from "@/lib/env";
import * as schema from "@/db/schema";

export type Database = NeonDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Executor = Database | Transaction;

let instance: Database | undefined;

export function db(): Database {
  if (!instance) {
    const pool = new Pool({ connectionString: env().DATABASE_URL, max: 5 });
    instance = drizzle({ client: pool, schema });
  }
  return instance;
}

/**
 * Runs work in a transaction that holds a per-study advisory lock, so decisions, ledger moves and
 * payout batches for one study never interleave (two tabs, double clicks, webhook + poll).
 * Statement and idle timeouts make sure a stalled connection can never hold the lock for long.
 */
export async function withStudyLock<T>(studyId: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '30s'`);
    await tx.execute(sql`set local idle_in_transaction_session_timeout = '60s'`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`study:${studyId}`}))`);
    return work(tx);
  });
}
