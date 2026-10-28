import { z } from "@/lib/zod";
import { payoutIdentity } from "@/engine/normalize";
import { COLUMN_ROLES, SINGLE_COLUMN_ROLES, type ColumnRole } from "@/engine/roles";
import { isValidTimeZone, parseTimestamp, type DateOrder } from "@/engine/time";
import type { EngineRespondent, RoleColumns } from "@/engine/types";

export const columnMappingSchema = z.object({
  column: z.string().min(1).max(300),
  role: z.enum(COLUMN_ROLES),
  questionText: z.string().trim().max(2_000).optional(),
  expectedValue: z.string().trim().max(500).optional(),
  contextColumns: z.array(z.string()).max(4).optional(),
});

export const importMappingSchema = z.object({
  columns: z.array(columnMappingSchema).min(1).max(1_000),
  timezone: z.string().nullable(),
  dateOrder: z.enum(["MDY", "DMY"]),
});

export type ColumnMapping = z.infer<typeof columnMappingSchema>;
export type ImportMapping = z.infer<typeof importMappingSchema>;

export function roleColumnsOf(mapping: ImportMapping): RoleColumns {
  const result: RoleColumns = {};
  for (const entry of mapping.columns) {
    (result[entry.role] ??= []).push(entry.column);
  }
  return result;
}

export interface MappingIssue {
  level: "error" | "warning";
  message: string;
}

/** Validates a mapping against the parsed rows before anything is written. */
export function validateMapping(mapping: ImportMapping, columns: readonly string[], rows: readonly string[][]): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const known = new Set(columns);
  const roles = roleColumnsOf(mapping);

  for (const entry of mapping.columns) {
    if (!known.has(entry.column)) {
      issues.push({ level: "error", message: `Column "${entry.column}" is not in the file.` });
    }
    if (entry.role === "open_text" && !entry.questionText) {
      issues.push({ level: "error", message: `Add the question wording for open-text column "${entry.column}" so answers can be checked against it.` });
    }
    for (const context of entry.contextColumns ?? []) {
      if (!known.has(context)) {
        issues.push({ level: "error", message: `Context column "${context}" for "${entry.column}" is not in the file.` });
      }
      const contextRole = mapping.columns.find((candidate) => candidate.column === context)?.role;
      if (contextRole && ["payout_email", "payout_phone", "respondent_id", "ip", "user_agent"].includes(contextRole)) {
        issues.push({ level: "error", message: `"${context}" identifies a person and cannot be sent to the AI service as context.` });
      }
    }
  }
  for (const role of SINGLE_COLUMN_ROLES) {
    if ((roles[role]?.length ?? 0) > 1) {
      issues.push({ level: "error", message: `Only one column can be "${role}". Columns: ${roles[role]?.join(", ")}.` });
    }
  }
  if (!roles.payout_email && !roles.payout_phone) {
    issues.push({ level: "error", message: "Map a payout email or payout phone column. Without it nobody can be paid." });
  }
  if (!roles.submitted_at) {
    issues.push({ level: "warning", message: "No submission time column. Duplicate handling will use row order, and burst rules cannot run." });
  }
  if (mapping.timezone !== null && !isValidTimeZone(mapping.timezone)) {
    issues.push({ level: "error", message: `"${mapping.timezone}" is not a valid time zone.` });
  }
  const timeColumns = [...(roles.submitted_at ?? []), ...(roles.started_at ?? [])];
  if (mapping.timezone === null && timeColumns.length > 0) {
    const indexes = timeColumns.map((column) => columns.indexOf(column));
    const needsZone = rows.some((row) => indexes.some((index) => needsTimezone(row[index] ?? "", mapping.dateOrder)));
    if (needsZone) {
      issues.push({ level: "error", message: "Some timestamps have no time zone. Choose the time zone the survey tool exported them in." });
    }
  }
  return issues;
}

function needsTimezone(raw: string, dateOrder: DateOrder): boolean {
  const result = parseTimestamp(raw, { timezone: null, dateOrder });
  return !result.ok && result.reason === "needs_timezone";
}

export interface BuiltRespondent extends EngineRespondent {
  raw: Record<string, string>;
}

export interface BuildResult {
  respondents: BuiltRespondent[];
  warnings: string[];
}

function cell(row: readonly string[], columns: readonly string[], column: string | undefined): string | undefined {
  if (column === undefined) {
    return undefined;
  }
  const index = columns.indexOf(column);
  return index === -1 ? undefined : row[index];
}

/** Builds respondents with pseudonymous refs (R-0001…) in file order. Raw strings are kept exactly. */
export function buildRespondents(mapping: ImportMapping, columns: readonly string[], rows: readonly string[][]): BuildResult {
  const roles = roleColumnsOf(mapping);
  const first = (role: ColumnRole) => roles[role]?.[0];
  const options = { timezone: mapping.timezone, dateOrder: mapping.dateOrder };
  const width = Math.max(4, String(rows.length).length);
  let badTimes = 0;
  let badDurations = 0;

  const respondents = rows.map((row, index): BuiltRespondent => {
    const raw: Record<string, string> = {};
    columns.forEach((column, position) => {
      raw[column] = row[position] ?? "";
    });
    const submittedRaw = cell(row, columns, first("submitted_at"));
    const submitted = submittedRaw === undefined ? null : parseTimestamp(submittedRaw, options);
    if (submitted && !submitted.ok && submitted.reason !== "empty") {
      badTimes += 1;
    }
    const submittedAt = submitted?.ok ? submitted.date : null;

    let durationSeconds: number | null = null;
    const durationRaw = cell(row, columns, first("duration_seconds"));
    if (durationRaw !== undefined) {
      const value = Number(durationRaw.trim());
      durationSeconds = durationRaw.trim().length > 0 && Number.isFinite(value) && value >= 0 ? value : null;
      if (durationSeconds === null && durationRaw.trim().length > 0) {
        badDurations += 1;
      }
    } else {
      const startedRaw = cell(row, columns, first("started_at"));
      const started = startedRaw === undefined ? null : parseTimestamp(startedRaw, options);
      if (started?.ok && submittedAt) {
        durationSeconds = Math.max(0, (submittedAt.getTime() - started.date.getTime()) / 1000);
      }
    }

    return {
      ref: `R-${String(index + 1).padStart(width, "0")}`,
      rowNumber: index + 1,
      values: raw,
      raw,
      submittedAt,
      durationSeconds,
      payout: payoutIdentity(cell(row, columns, first("payout_email")), cell(row, columns, first("payout_phone"))),
    };
  });

  const warnings: string[] = [];
  if (badTimes > 0) {
    warnings.push(`${badTimes} submission time${badTimes === 1 ? " could not be read and was" : "s could not be read and were"} left empty.`);
  }
  if (badDurations > 0) {
    warnings.push(`${badDurations} duration value${badDurations === 1 ? " was not a number and was" : "s were not numbers and were"} left empty.`);
  }
  return { respondents, warnings };
}
