import "server-only";
import type { Transaction } from "@/db/client";
import { audit } from "@/db/audit";
import { imports, questionMap, respondents } from "@/db/schema";
import { lockedRuleSet, studyImport, touchStudy, type Study } from "@/db/queries";
import { sha256Hex } from "@/engine/canonical";
import { missingFields } from "@/engine/rules";
import { buildRespondents, roleColumnsOf, validateMapping, type ImportMapping } from "@/import/mapping";
import { decodeCsvBytes, MAX_CSV_BYTES, parseCsvText } from "@/lib/csv";

export class ImportError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join(" "));
    this.name = "ImportError";
  }
}

export interface ImportSummary {
  importId: string;
  rowCount: number;
  warnings: string[];
}

/** Parses the file again on the server (the browser preview is never trusted), validates and stores every row. */
export async function importCsv(tx: Transaction, study: Study, actor: string, fileName: string, bytes: Uint8Array, mapping: ImportMapping): Promise<ImportSummary> {
  if (bytes.length > MAX_CSV_BYTES) {
    throw new ImportError([`The file is larger than ${MAX_CSV_BYTES / 1024 / 1024} MB.`]);
  }
  const locked = await lockedRuleSet(study.id, tx);
  if (!locked) {
    throw new ImportError(["Lock the exclusion rules before importing responses, so the rules are decided before anyone sees the data."]);
  }
  if (await studyImport(study.id, tx)) {
    throw new ImportError(["This study already has imported responses."]);
  }

  const decoded = decodeCsvBytes(bytes);
  const parsed = parseCsvText(decoded.text);
  if (!parsed.ok) {
    throw new ImportError([parsed.error]);
  }
  const { columns, rows } = parsed.csv;
  const errors = validateMapping(mapping, columns, rows).filter((issue) => issue.level === "error");
  const missing = missingFields(locked.rules, columns, roleColumnsOf(mapping));
  const problems = [
    ...errors.map((issue) => issue.message),
    ...missing.map((entry) => `Rule ${entry.ruleId} needs ${entry.label}, which is not mapped.`),
  ];
  if (problems.length > 0) {
    throw new ImportError(problems);
  }

  const built = buildRespondents(mapping, columns, rows);
  const warnings = [...decoded.warnings, ...parsed.csv.warnings, ...built.warnings];
  const [created] = await tx
    .insert(imports)
    .values({
      studyId: study.id,
      fileName,
      sha256: sha256Hex(decoded.text),
      rowCount: rows.length,
      columnsJson: columns,
      parseWarningsJson: warnings,
      encoding: decoded.encoding,
      timezone: mapping.timezone,
      dateOrder: mapping.dateOrder,
    })
    .returning({ id: imports.id });
  if (!created) {
    throw new ImportError(["The import could not be saved."]);
  }

  const mapped = new Map(mapping.columns.map((entry) => [entry.column, entry]));
  await tx.insert(questionMap).values(
    columns.map((column, position) => {
      const entry = mapped.get(column);
      return {
        studyId: study.id,
        columnName: column,
        position,
        role: entry?.role ?? "other",
        questionText: entry?.questionText ?? parsed.csv.questionTexts[column] ?? null,
        expectedValue: entry?.expectedValue ?? null,
        contextColumns: entry?.contextColumns ?? [],
      };
    }),
  );

  for (let start = 0; start < built.respondents.length; start += 250) {
    await tx.insert(respondents).values(
      built.respondents.slice(start, start + 250).map((respondent) => ({
        studyId: study.id,
        importId: created.id,
        rowNumber: respondent.rowNumber,
        respondentRef: respondent.ref,
        rawJson: respondent.raw,
        payoutIdentityRaw: respondent.payout?.raw ?? null,
        payoutIdentityNormalized: respondent.payout?.normalized ?? null,
        payoutIdentityType: respondent.payout?.type ?? null,
        submittedAt: respondent.submittedAt,
        durationSeconds: respondent.durationSeconds,
      })),
    );
  }
  await touchStudy(tx, study.id, "data_imported");
  await audit(tx, {
    workspaceId: study.workspaceId,
    studyId: study.id,
    actor,
    action: "data.imported",
    target: fileName,
    after: { rows: rows.length, columns: columns.length, warnings },
  });
  return { importId: created.id, rowCount: rows.length, warnings };
}
