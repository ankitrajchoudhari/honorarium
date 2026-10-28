import { describe, expect, it } from "vitest";
import { decodeCsvBytes, escapeCsvCell, parseCsvText, suggestRole, toCsv } from "@/lib/csv";

const encoder = new TextEncoder();

describe("decodeCsvBytes", () => {
  it("strips a UTF-8 BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode("Name\nZoë")]);
    expect(decodeCsvBytes(bytes)).toEqual({ text: "Name\nZoë", encoding: "utf-8 with BOM", warnings: [] });
  });

  it("falls back to Windows-1252 with a warning", () => {
    const bytes = new Uint8Array([...encoder.encode("Name\nZo"), 0xeb]);
    const result = decodeCsvBytes(bytes);
    expect(result.text).toBe("Name\nZoë");
    expect(result.encoding).toBe("windows-1252");
    expect(result.warnings).toHaveLength(1);
  });
});

describe("parseCsvText", () => {
  it("handles semicolons and quoted newlines", () => {
    const result = parseCsvText('id;answer\n1;"line one\nline two"\n2;plain\n');
    expect(result.ok && result.csv.rows).toEqual([
      ["1", "line one\nline two"],
      ["2", "plain"],
    ]);
    expect(result.ok && result.csv.delimiter).toBe(";");
  });

  it("names blank headers and renames duplicates with a warning", () => {
    const result = parseCsvText("Q1,,Q1\na,b,c\n");
    expect(result.ok && result.csv.columns).toEqual(["Q1", "Column 2", "Q1 (2)"]);
    expect(result.ok && result.csv.warnings).toHaveLength(2);
  });

  it("reads Qualtrics question rows and drops them from the data", () => {
    const text = 'ResponseId,Q3\nResponse ID,What keeps you awake?\n{"ImportId":"_recordId"},{"ImportId":"QID3_TEXT"}\nR_1,Coffee\n';
    const result = parseCsvText(text);
    expect(result.ok && result.csv.rows).toEqual([["R_1", "Coffee"]]);
    expect(result.ok && result.csv.questionTexts).toEqual({ ResponseId: "Response ID", Q3: "What keeps you awake?" });
  });

  it("pads short rows and keeps raw strings exactly", () => {
    const result = parseCsvText("a,b,c\n007,1/2/2026\n");
    expect(result.ok && result.csv.rows).toEqual([["007", "1/2/2026", ""]]);
  });

  it("rejects empty files", () => {
    expect(parseCsvText("").ok).toBe(false);
    expect(parseCsvText("only,headers\n").ok).toBe(false);
  });
});

describe("export safety", () => {
  it("escapes formula-leading cells", () => {
    expect(escapeCsvCell("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(escapeCsvCell("+1")).toBe("'+1");
    expect(escapeCsvCell("@SUM")).toBe("'@SUM");
    expect(escapeCsvCell("-2")).toBe("'-2");
    expect(escapeCsvCell("plain")).toBe("plain");
    expect(toCsv([["=1+1", "ok"]])).toBe("'=1+1,ok");
  });
});

describe("suggestRole", () => {
  it("recognises common survey export headers", () => {
    expect(suggestRole("ResponseId")).toBe("respondent_id");
    expect(suggestRole("Payout email")).toBe("payout_email");
    expect(suggestRole("EndDate")).toBe("submitted_at");
    expect(suggestRole("Duration (in seconds)")).toBe("duration_seconds");
    expect(suggestRole("IPAddress")).toBe("ip");
    expect(suggestRole("hp_website")).toBe("honeypot");
    expect(suggestRole("Date of birth")).toBe("date_of_birth");
    expect(suggestRole("Q7")).toBe("other");
  });
});
