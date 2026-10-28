import { describe, expect, it } from "vitest";
import { buildRespondents, validateMapping, type ImportMapping } from "@/import/mapping";

const columns = ["ResponseId", "EndDate", "Duration", "Email", "Q3", "Q2"];
const rows = [
  ["a1", "2026-10-14T09:00:00-04:00", "600", "Roy.K@gmail.com", "Coffee keeps me up", "Every night"],
  ["a2", "2026-10-14 10:00:00", "abc", "", "Notes", "Never"],
];

const mapping = (overrides: Partial<ImportMapping> = {}): ImportMapping => ({
  columns: [
    { column: "ResponseId", role: "respondent_id" },
    { column: "EndDate", role: "submitted_at" },
    { column: "Duration", role: "duration_seconds" },
    { column: "Email", role: "payout_email" },
    { column: "Q3", role: "open_text", questionText: "What keeps you awake?", contextColumns: ["Q2"] },
    { column: "Q2", role: "other" },
  ],
  timezone: null,
  dateOrder: "MDY",
  ...overrides,
});

describe("validateMapping", () => {
  it("asks for a time zone when any timestamp lacks one", () => {
    const issues = validateMapping(mapping(), columns, rows);
    expect(issues.some((issue) => issue.level === "error" && issue.message.includes("time zone"))).toBe(true);
    expect(validateMapping(mapping({ timezone: "America/New_York" }), columns, rows).filter((issue) => issue.level === "error")).toEqual([]);
  });

  it("requires a payout column, question wording and non-identifying context", () => {
    const broken = mapping({
      timezone: "UTC",
      columns: [
        { column: "Email", role: "other" },
        { column: "Q3", role: "open_text", contextColumns: ["ResponseId"] },
        { column: "ResponseId", role: "respondent_id" },
      ],
    });
    const messages = validateMapping(broken, columns, rows).map((issue) => issue.message);
    expect(messages.some((message) => message.includes("payout email"))).toBe(true);
    expect(messages.some((message) => message.includes("question wording"))).toBe(true);
    expect(messages.some((message) => message.includes("identifies a person"))).toBe(true);
  });

  it("rejects two columns for a single-column role", () => {
    const doubled = mapping({ timezone: "UTC", columns: [...mapping().columns, { column: "Q2", role: "payout_email" }] });
    expect(validateMapping(doubled, columns, rows).some((issue) => issue.message.startsWith('Only one column can be "payout_email"'))).toBe(true);
  });
});

describe("buildRespondents", () => {
  it("builds pseudonymous refs, normalized identities, UTC times and keeps raw strings", () => {
    const { respondents, warnings } = buildRespondents(mapping({ timezone: "America/New_York" }), columns, rows);
    expect(respondents.map((respondent) => respondent.ref)).toEqual(["R-0001", "R-0002"]);
    expect(respondents[0]?.payout).toEqual({ type: "email", raw: "Roy.K@gmail.com", normalized: "royk@gmail.com" });
    expect(respondents[0]?.submittedAt?.toISOString()).toBe("2026-10-14T13:00:00.000Z");
    expect(respondents[1]?.submittedAt?.toISOString()).toBe("2026-10-14T14:00:00.000Z");
    expect(respondents[1]?.payout).toBeNull();
    expect(respondents[1]?.durationSeconds).toBeNull();
    expect(respondents[0]?.raw.Email).toBe("Roy.K@gmail.com");
    expect(warnings).toEqual(["1 duration value was not a number and was left empty."]);
  });
});
