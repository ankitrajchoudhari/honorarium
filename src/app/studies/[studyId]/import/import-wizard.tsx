"use client";

import { MdUploadFile } from "react-icons/md";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, inputClass, Notice, tableClass, tdClass, thClass } from "@/components/ui";
import type { RuleSet } from "@/engine/dsl";
import { COLUMN_ROLES, IDENTIFYING_ROLES, ROLE_LABELS, type ColumnRole } from "@/engine/roles";
import { missingFields } from "@/engine/rules";
import { roleColumnsOf, validateMapping, type ColumnMapping, type ImportMapping } from "@/import/mapping";
import { decodeCsvBytes, MAX_CSV_BYTES, parseCsvText, suggestRole, type ParsedCsv } from "@/lib/csv";

interface Loaded {
  name: string;
  bytes: Uint8Array;
  csv: ParsedCsv;
  encodingWarnings: string[];
}

async function gzip(bytes: Uint8Array): Promise<Blob> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Asia/Kolkata"];
  }
}

export function ImportWizard({ studyId, ruleSet }: { studyId: string; ruleSet: RuleSet }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [columns, setColumns] = useState<ColumnMapping[]>([]);
  const [timezone, setTimezone] = useState<string>("");
  const [dateOrder, setDateOrder] = useState<"MDY" | "DMY">("MDY");
  const [fileError, setFileError] = useState<string | null>(null);
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const zones = useMemo(() => timeZones(), []);

  const readFile = async (file: File) => {
    setFileError(null);
    setServerProblems([]);
    if (file.size > MAX_CSV_BYTES) {
      setFileError(`The file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`);
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const decoded = decodeCsvBytes(bytes);
    const parsed = parseCsvText(decoded.text);
    if (!parsed.ok) {
      setFileError(parsed.error);
      setLoaded(null);
      return;
    }
    setLoaded({ name: file.name, bytes, csv: parsed.csv, encodingWarnings: decoded.warnings });
    setColumns(
      parsed.csv.columns.map((column) => {
        const role = suggestRole(column);
        return { column, role, questionText: parsed.csv.questionTexts[column] };
      }),
    );
  };

  const mapping: ImportMapping = { columns, timezone: timezone || null, dateOrder };
  const issues = loaded ? validateMapping(mapping, loaded.csv.columns, loaded.csv.rows) : [];
  const missing = loaded ? missingFields(ruleSet, loaded.csv.columns, roleColumnsOf(mapping)) : [];
  const errors = [...issues.filter((issue) => issue.level === "error").map((issue) => issue.message), ...missing.map((entry) => `Rule ${entry.ruleId} needs ${entry.label}. Map it below.`)];
  const warnings = [...(loaded?.encodingWarnings ?? []), ...(loaded?.csv.warnings ?? []), ...issues.filter((issue) => issue.level === "warning").map((issue) => issue.message)];
  const contextCandidates = columns.filter((entry) => !IDENTIFYING_ROLES.has(entry.role) && entry.role !== "open_text").map((entry) => entry.column);

  const setColumn = (index: number, patch: Partial<ColumnMapping>) => setColumns((current) => current.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)));

  const upload = async () => {
    if (!loaded) {
      return;
    }
    setUploading(true);
    setServerProblems([]);
    const body = new FormData();
    body.set("file", await gzip(loaded.bytes), `${loaded.name}.gz`);
    body.set("fileName", loaded.name);
    body.set("mapping", JSON.stringify(mapping));
    const response = await fetch(`/api/studies/${studyId}/import`, { method: "POST", body });
    const result = (await response.json().catch(() => ({ problems: [`The server answered HTTP ${response.status}.`] }))) as { ok?: boolean; problems?: string[] };
    setUploading(false);
    if (result.ok) {
      router.push(`/studies/${studyId}/verify`);
      router.refresh();
    } else {
      setServerProblems(result.problems ?? ["The import failed."]);
    }
  };

  return (
    <div className="space-y-4">
      <label
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-rule bg-surface px-4 py-8 text-center hover:bg-subtle"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) {
            void readFile(file);
          }
        }}
      >
        <MdUploadFile size={28} aria-hidden className="text-primary" />
        <span className="font-semibold">{loaded ? `${loaded.name} · ${loaded.csv.rows.length} rows · ${loaded.csv.columns.length} columns` : "Drop a CSV file here, or choose one"}</span>
        <span className="text-xs text-muted">Up to 10 MB and 50,000 rows. UTF-8 (with or without BOM) or Windows-1252.</span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void readFile(file);
            }
          }}
        />
      </label>
      {fileError && <Notice tone="error" title="The file could not be read">{fileError}</Notice>}

      {loaded && (
        <>
          {warnings.length > 0 && (
            <Notice tone="warning" title="Check before importing">
              <ul className="list-disc pl-5">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Notice>
          )}

          <section className="rounded-lg border border-rule bg-surface p-5">
            <h3 className="mb-2 font-semibold">Column mapping</h3>
            <p className="mb-3 text-xs text-muted">Roles were suggested from the header names. Identifying columns (payout email, phone, IP, respondent ID) are never sent to the AI service.</p>
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th scope="col" className={thClass}>Column</th>
                    <th scope="col" className={thClass}>First values</th>
                    <th scope="col" className={thClass}>Role</th>
                    <th scope="col" className={thClass}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((entry, index) => (
                    <tr key={entry.column}>
                      <td className={`${tdClass} font-mono text-xs`}>{entry.column}</td>
                      <td className={`${tdClass} max-w-[220px] truncate text-xs text-muted`}>
                        {loaded.csv.rows
                          .slice(0, 3)
                          .map((row) => row[index] ?? "")
                          .filter(Boolean)
                          .join(" · ")}
                      </td>
                      <td className={tdClass}>
                        <select aria-label={`Role for ${entry.column}`} className={`${inputClass} w-48`} value={entry.role} onChange={(event) => setColumn(index, { role: event.target.value as ColumnRole })}>
                          {COLUMN_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={`${tdClass} min-w-[240px]`}>
                        {entry.role === "open_text" && (
                          <div className="space-y-1">
                            <input
                              aria-label={`Question wording for ${entry.column}`}
                              className={inputClass}
                              placeholder="Question wording shown to participants"
                              value={entry.questionText ?? ""}
                              onChange={(event) => setColumn(index, { questionText: event.target.value })}
                            />
                            <details>
                              <summary className="cursor-pointer text-xs text-muted">Closed answers to compare against ({entry.contextColumns?.length ?? 0} of up to 4)</summary>
                              <div className="mt-1 grid max-h-40 gap-0.5 overflow-y-auto">
                                {contextCandidates.map((candidate) => {
                                  const checked = entry.contextColumns?.includes(candidate) ?? false;
                                  return (
                                    <label key={candidate} className="flex items-center gap-2 text-xs">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={!checked && (entry.contextColumns?.length ?? 0) >= 4}
                                        onChange={() =>
                                          setColumn(index, {
                                            contextColumns: checked ? (entry.contextColumns ?? []).filter((value) => value !== candidate) : [...(entry.contextColumns ?? []), candidate],
                                          })
                                        }
                                      />
                                      <span className="font-mono">{candidate}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </details>
                          </div>
                        )}
                        {entry.role === "attention_check" && (
                          <input
                            aria-label={`Expected answer for ${entry.column}`}
                            className={inputClass}
                            placeholder="Expected answer"
                            value={entry.expectedValue ?? ""}
                            onChange={(event) => setColumn(index, { expectedValue: event.target.value })}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-4 rounded-lg border border-rule bg-surface p-5 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="timezone" className="block font-semibold">
                Time zone of timestamps without one
              </label>
              <select id="timezone" className={inputClass} value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                <option value="">Not chosen</option>
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted">Honorarium never guesses. Times with an offset (e.g. 2026-10-14T09:15:00-04:00) don&apos;t need this.</p>
            </div>
            <div className="space-y-1">
              <label htmlFor="date-order" className="block font-semibold">
                Date order in slash dates
              </label>
              <select id="date-order" className={inputClass} value={dateOrder} onChange={(event) => setDateOrder(event.target.value as "MDY" | "DMY")}>
                <option value="MDY">Month/Day/Year (10/14/2026)</option>
                <option value="DMY">Day/Month/Year (14/10/2026)</option>
              </select>
            </div>
          </section>

          <section className="rounded-lg border border-rule bg-surface p-5">
            <h3 className="mb-2 font-semibold">Preview (first 5 rows)</h3>
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead>
                  <tr>
                    {loaded.csv.columns.map((column) => (
                      <th key={column} scope="col" className={`${thClass} whitespace-nowrap font-mono`}>
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loaded.csv.rows.slice(0, 5).map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className={`${tdClass} max-w-[240px] truncate whitespace-nowrap text-xs`}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div aria-live="polite" className="space-y-2">
            {errors.length > 0 && (
              <Notice tone="error" title="Fix these before importing">
                <ul className="list-disc pl-5">
                  {errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </Notice>
            )}
            {serverProblems.length > 0 && (
              <Notice tone="error" title="The server did not import the file">
                <ul className="list-disc pl-5">
                  {serverProblems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </Notice>
            )}
          </div>
          <Button variant="primary" disabled={errors.length > 0 || uploading} onClick={() => void upload()}>
            {uploading ? `Importing ${loaded.csv.rows.length} rows…` : `Import ${loaded.csv.rows.length} responses`}
          </Button>
        </>
      )}
    </div>
  );
}
