import Papa from "papaparse";
import type { ColumnRole } from "@/engine/roles";

export const MAX_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_CSV_ROWS = 50_000;

export type CsvEncoding = "utf-8" | "utf-8 with BOM" | "windows-1252";

export interface DecodedCsv {
  text: string;
  encoding: CsvEncoding;
  warnings: string[];
}

/** UTF-8 (with or without BOM); anything that is not valid UTF-8 is read as Windows-1252 with a warning. */
export function decodeCsvBytes(bytes: Uint8Array): DecodedCsv {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8 with BOM", warnings: [] };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8", warnings: [] };
  } catch {
    return {
      text: new TextDecoder("windows-1252").decode(bytes),
      encoding: "windows-1252",
      warnings: ["The file is not UTF-8, so it was read as Windows-1252. Check that accented letters look right in the preview."],
    };
  }
}

export interface ParsedCsv {
  columns: string[];
  rows: string[][];
  /** Question wording per column, when the export carries it (Qualtrics second header row). */
  questionTexts: Record<string, string>;
  delimiter: string;
  warnings: string[];
}

export type CsvParseResult = { ok: true; csv: ParsedCsv } | { ok: false; error: string };

function uniqueColumns(raw: string[], warnings: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((header, index) => {
    let name = header.trim();
    if (name.length === 0) {
      name = `Column ${index + 1}`;
      warnings.push(`Column ${index + 1} had no header, so it was named "${name}".`);
    }
    const count = seen.get(name.toLowerCase()) ?? 0;
    seen.set(name.toLowerCase(), count + 1);
    if (count > 0) {
      const renamed = `${name} (${count + 1})`;
      warnings.push(`Header "${name}" appears more than once; the copy in column ${index + 1} was renamed "${renamed}".`);
      return renamed;
    }
    return name;
  });
}

export function parseCsvText(text: string): CsvParseResult {
  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: "greedy", delimitersToGuess: [",", ";", "\t", "|"] });
  const warnings: string[] = [];
  const all = parsed.data;
  const headerRow = all[0];
  if (!headerRow || headerRow.length === 0) {
    return { ok: false, error: "The file has no header row." };
  }
  const columns = uniqueColumns(headerRow, warnings);
  let body = all.slice(1);
  const questionTexts: Record<string, string> = {};

  if (body.length >= 2 && body[1]?.some((cell) => cell.startsWith('{"ImportId"'))) {
    body[0]?.forEach((cell, index) => {
      const column = columns[index];
      if (column && cell.trim().length > 0 && cell.trim() !== column) {
        questionTexts[column] = cell.trim();
      }
    });
    body = body.slice(2);
    warnings.push("Qualtrics header rows detected; question wording was read from the second row.");
  }

  if (body.length === 0) {
    return { ok: false, error: "The file has a header row but no responses." };
  }
  if (body.length > MAX_CSV_ROWS) {
    return { ok: false, error: `The file has ${body.length.toLocaleString("en-US")} rows. The limit is ${MAX_CSV_ROWS.toLocaleString("en-US")}.` };
  }

  let ragged = 0;
  const rows = body.map((row) => {
    if (row.length === columns.length) {
      return row;
    }
    ragged += 1;
    return columns.map((_, index) => row[index] ?? "");
  });
  if (ragged > 0) {
    warnings.push(`${ragged} row${ragged === 1 ? "" : "s"} had a different number of cells than the header and were padded or trimmed.`);
  }
  const quoteErrors = parsed.errors.filter((error) => error.type === "Quotes");
  if (quoteErrors.length > 0) {
    warnings.push(`${quoteErrors.length} quoting problem${quoteErrors.length === 1 ? "" : "s"} found (first near row ${(quoteErrors[0]?.row ?? 0) + 2}).`);
  }
  return { ok: true, csv: { columns, rows, questionTexts, delimiter: parsed.meta.delimiter, warnings } };
}

const SUGGESTIONS: [RegExp, ColumnRole][] = [
  [/^(response ?id|responseid|record_id|respondent|participant ?id|id)$/i, "respondent_id"],
  [/(payout|paypal|payment)?.*e-?mail/i, "payout_email"],
  [/(phone|mobile|cell)/i, "payout_phone"],
  [/^(end ?date|submitted|submit(ted)? ?(at|time)|timestamp|completed|recorded ?date)/i, "submitted_at"],
  [/^(start ?date|started|start ?time)/i, "started_at"],
  [/duration/i, "duration_seconds"],
  [/(ip ?address|^ip$)/i, "ip"],
  [/(ip.?country|location.?country|geo.?country)/i, "ip_country"],
  [/^country$/i, "country"],
  [/(user.?agent|browser)/i, "user_agent"],
  [/(honeypot|hidden|hp_)/i, "honeypot"],
  [/^age$/i, "age"],
  [/(birth|dob)/i, "date_of_birth"],
  [/(attention|attn)/i, "attention_check"],
];

export function suggestRole(column: string): ColumnRole {
  for (const [pattern, role] of SUGGESTIONS) {
    if (pattern.test(column.trim())) {
      return role;
    }
  }
  return "other";
}

/** Prevents spreadsheet formula injection when exporting participant text. */
export function escapeCsvCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  return Papa.unparse(rows.map((row) => row.map(escapeCsvCell)));
}
