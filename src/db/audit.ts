import type { Executor } from "@/db/client";
import { auditLog } from "@/db/schema";

export interface AuditEntry {
  workspaceId: string;
  studyId?: string | null;
  actor: string;
  action: string;
  target?: string | null;
  before?: unknown;
  after?: unknown;
}

export async function audit(executor: Executor, entry: AuditEntry): Promise<void> {
  await executor.insert(auditLog).values({
    workspaceId: entry.workspaceId,
    studyId: entry.studyId ?? null,
    actor: entry.actor,
    action: entry.action,
    target: entry.target ?? null,
    beforeJson: entry.before ?? null,
    afterJson: entry.after ?? null,
  });
}
