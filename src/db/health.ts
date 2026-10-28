import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export type DbHealth = { ok: true; serverVersion: string } | { ok: false; message: string };

export async function checkDatabase(): Promise<DbHealth> {
  try {
    const rows = await db().execute<{ version: string }>(sql`select current_setting('server_version') as version`);
    const version = rows.rows[0]?.version;
    if (!version) {
      return { ok: false, message: "The database answered but returned no version." };
    }
    return { ok: true, serverVersion: version };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error.";
    return { ok: false, message: message.replace(/postgres(ql)?:\/\/\S+/gi, "[connection string hidden]") };
  }
}
