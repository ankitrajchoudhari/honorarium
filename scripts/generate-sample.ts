/**
 * Generates the synthetic sample study (seeded, reproducible). Run: npm run sample:generate
 * Writes data/sample/sleep-study-responses.csv, mapping.json, study.json and MANIFEST.md.
 * The 4 genuine respondents meant to receive real sandbox payouts use SANDBOX_RECEIVERS from .env.local.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import Papa from "papaparse";
import { findClusters } from "../src/engine/similarity";
import type { ImportMapping } from "../src/import/mapping";
import {
  BOT_Q3,
  FIRST_NAMES,
  GENUINE_Q3,
  GENUINE_Q4,
  GIBBERISH,
  INJECTIONS,
  LAST_NAMES,
  OFF_TOPIC,
  SHORT_Q3,
  PHONE_CONTRADICTIONS,
  QUESTION_Q3,
  QUESTION_Q4,
  TEMPLATE_BASE,
  TEMPLATE_SWAPS,
  type PhoneInBed,
} from "./sample-content";

config({ path: ".env.local", quiet: true });

const OUT_DIR = join(process.cwd(), "data", "sample");
const SIMULATOR_RECEIVER = "payouts-simulator-receiver@paypal.com";
const STUDY_DAY = { year: 2026, month: 10, day: 14 };
const EDT_OFFSET_HOURS = -4;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20261014);
const between = (min: number, max: number) => Math.floor(random() * (max - min + 1)) + min;
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

type Pattern =
  | "genuine"
  | "genuine_sandbox_receiver"
  | "genuine_shared_campus_ip"
  | "duplicate_identity_kept"
  | "duplicate_identity_later"
  | "bot_burst"
  | "templated_text"
  | "age_dob_contradiction"
  | "phone_contradiction"
  | "gibberish"
  | "off_topic"
  | "prompt_injection"
  | "missing_payout_email"
  | "invalid_phone"
  | "too_old"
  | "speeder"
  | "failed_attention"
  | "edge_accented_name"
  | "edge_excel_date_of_birth"
  | "edge_timestamp_without_zone";

interface Row {
  patterns: Pattern[];
  endMs: number;
  durationSeconds: number;
  ip: string;
  firstName: string;
  email: string;
  phone: string;
  age: number;
  dob: string;
  student: string;
  sleepHours: number;
  phoneInBed: PhoneInBed;
  attention: string;
  honeypot: string;
  q3: string;
  q4: string;
  endOverride?: string;
}

const dayStartUtc = Date.UTC(STUDY_DAY.year, STUDY_DAY.month - 1, STUDY_DAY.day) - EDT_OFFSET_HOURS * 3_600_000;
const atLocal = (hour: number, minute: number, second: number) => dayStartUtc + ((hour * 60 + minute) * 60 + second) * 1000;
const randomDaytime = () => atLocal(between(8, 23), between(0, 59), between(0, 59));

function birthDateForAge(age: number): { year: number; month: number; day: number } {
  const month = between(1, 12);
  const day = between(1, 28);
  const hadBirthday = month < STUDY_DAY.month || (month === STUDY_DAY.month && day <= STUDY_DAY.day);
  return { year: STUDY_DAY.year - age - (hadBirthday ? 0 : 1), month, day };
}

const isoDate = (date: { year: number; month: number; day: number }) =>
  `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;

function excelSerial(date: { year: number; month: number; day: number }): string {
  return String((Date.UTC(date.year, date.month - 1, date.day) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

function formatLocal(ms: number, withOffset: boolean): string {
  const local = new Date(ms + EDT_OFFSET_HOURS * 3_600_000);
  const text = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}T${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}:${String(local.getUTCSeconds()).padStart(2, "0")}`;
  return withOffset ? `${text}-04:00` : text.replace("T", " ");
}

let emailCounter = 0;
function uniqueEmail(first: string, last: string, domain: string): string {
  emailCounter += 1;
  const local = `${first}.${last}`.normalize("NFD").replace(/[^\w.]/g, "").toLowerCase();
  return `${local}${emailCounter}@${domain}`;
}

function person(): { firstName: string; lastName: string } {
  return { firstName: pick(FIRST_NAMES), lastName: pick(LAST_NAMES) };
}

function humanRow(patterns: Pattern[], overrides: Partial<Row> = {}): Row {
  const { firstName, lastName } = person();
  const age = between(18, 30);
  const q3 = pick(SHORT_Q3);
  const phoneInBed = pick(["Sometimes", "Most nights"] as const);
  return {
    patterns,
    endMs: randomDaytime(),
    durationSeconds: between(6 * 60, 25 * 60),
    ip: `${between(24, 98)}.${between(1, 254)}.${between(1, 254)}.${between(1, 254)}`,
    firstName,
    email: uniqueEmail(firstName, lastName, "example.org"),
    phone: "",
    age,
    dob: isoDate(birthDateForAge(age)),
    student: "Yes",
    sleepHours: between(4, 9),
    phoneInBed,
    attention: "Strongly disagree",
    honeypot: "",
    q3,
    q4: pick(GENUINE_Q4),
    ...overrides,
  };
}

function templated(): string {
  let text = TEMPLATE_BASE;
  const swaps = between(0, 2);
  for (let index = 0; index < swaps; index += 1) {
    const [from, options] = pick(TEMPLATE_SWAPS);
    text = text.replace(from, pick(options));
  }
  return random() < 0.3 ? text.replace(/\.$/, "") : text;
}

function buildRows(receivers: string[]): Row[] {
  const rows: Row[] = [];

  const genuineAnswers = [...GENUINE_Q3].sort(() => random() - 0.5);
  for (let index = 0; index < 48; index += 1) {
    const [q3, phoneInBed] = genuineAnswers[index]!;
    const patterns: Pattern[] = ["genuine"];
    const overrides: Partial<Row> = { q3, phoneInBed };
    const receiver = receivers[index];
    if (index < 4) {
      patterns.push("genuine_sandbox_receiver");
      if (receiver) {
        overrides.email = receiver;
      } else if (index === 0) {
        overrides.email = SIMULATOR_RECEIVER;
      }
    }
    if (index >= 4 && index < 16) {
      patterns.push("genuine_shared_campus_ip");
      overrides.ip = "128.59.20.17";
    }
    if (index === 16) {
      patterns.push("duplicate_identity_kept");
      overrides.email = "r.oyk.hon.sample@gmail.com";
      overrides.endMs = atLocal(9, 5, 12);
    }
    if (index === 17) {
      patterns.push("edge_accented_name");
      overrides.firstName = "Zoë Ångström-Núñez";
    }
    if (index === 18) {
      patterns.push("edge_excel_date_of_birth");
      const age = 22;
      overrides.age = age;
      overrides.dob = excelSerial(birthDateForAge(age));
    }
    if (index === 19) {
      patterns.push("edge_timestamp_without_zone");
      overrides.endMs = atLocal(14, 2, 11);
    }
    rows.push(humanRow(patterns, overrides));
  }

  const variants = ["roy.k.hon.sample+1@gmail.com", "ROYKHONSAMPLE@googlemail.com", "royk.hon.sample+survey@gmail.com", "R.O.Y.K.HON.SAMPLE@gmail.com"];
  variants.forEach((email, index) => {
    rows.push(humanRow(["duplicate_identity_later"], { email, endMs: atLocal(11 + index * 2, between(0, 59), between(0, 59)) }));
  });

  let burstMs = atLocal(2, 10, 0);
  for (let index = 0; index < 300; index += 1) {
    burstMs += between(1, 3) * 1000;
    const { firstName, lastName } = person();
    const age = between(18, 60);
    rows.push({
      patterns: ["bot_burst"],
      endMs: burstMs,
      durationSeconds: between(40, 90),
      ip: `${pick(["45.133.1", "45.133.2", "103.152.112", "185.220.101"])}.${between(2, 254)}`,
      firstName,
      email: uniqueEmail(firstName, lastName, "example.net"),
      phone: "",
      age,
      dob: isoDate({ year: between(1965, 2008), month: between(1, 12), day: between(1, 28) }),
      student: pick(["Yes", "No"]),
      sleepHours: between(1, 12),
      phoneInBed: pick(["Never", "Sometimes", "Most nights", "Every night"] as const),
      attention: random() < 0.15 ? "Strongly disagree" : pick(["Agree", "Strongly agree", "Neutral", "Disagree"]),
      honeypot: random() < 0.4 ? pick(["http://cheap-pills.example", "best offer", "admin", "1"]) : "",
      q3: pick(BOT_Q3),
      q4: pick(["nothing", "good", "", "sleep more"]),
    });
  }

  for (let index = 0; index < 60; index += 1) {
    rows.push(humanRow(["templated_text"], { q3: templated(), q4: "Going to bed earlier would help.", durationSeconds: between(5 * 60, 9 * 60) }));
  }

  for (let index = 0; index < 3; index += 1) {
    rows.push(humanRow(["age_dob_contradiction"], { age: 19, dob: isoDate({ year: 1987, month: between(1, 12), day: between(1, 28) }) }));
  }
  for (const text of PHONE_CONTRADICTIONS) {
    rows.push(humanRow(["phone_contradiction"], { q3: text, phoneInBed: "Every night" }));
  }
  for (const text of GIBBERISH) {
    rows.push(humanRow(["gibberish"], { q3: text }));
  }
  for (const text of OFF_TOPIC) {
    rows.push(humanRow(["off_topic"], { q3: text }));
  }
  for (const text of INJECTIONS) {
    rows.push(humanRow(["prompt_injection"], { q3: text }));
  }
  rows.push(humanRow(["missing_payout_email"], { email: "" }));
  rows.push(humanRow(["invalid_phone"], { email: "", phone: "555-12" }));
  for (const age of [34, 41, 52]) {
    rows.push(humanRow(["too_old"], { age, dob: isoDate(birthDateForAge(age)) }));
  }
  for (let index = 0; index < 55; index += 1) {
    rows.push(humanRow(["speeder"], { durationSeconds: between(70, 220) }));
  }
  for (let index = 0; index < 30; index += 1) {
    rows.push(humanRow(["failed_attention"], { attention: pick(["Agree", "Neutral", "Strongly agree"]) }));
  }
  return rows;
}

const randomId = () => `R_${Array.from({ length: 15 }, () => pick([..."abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"])).join("")}`;

function main(): void {
  const receivers = (process.env.SANDBOX_RECEIVERS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (receivers.length < 4) {
    console.warn(
      `SANDBOX_RECEIVERS has ${receivers.length} of 4 addresses. Missing ones fall back to ${SIMULATOR_RECEIVER} (first) or an example.org address. Re-run after adding them.`,
    );
  }

  const rows = buildRows(receivers).sort((a, b) => a.endMs - b.endMs);
  const header = [
    "ResponseId",
    "StartDate",
    "EndDate",
    "Duration (in seconds)",
    "IPAddress",
    "FirstName",
    "Email",
    "Phone",
    "Age",
    "DateOfBirth",
    "Student",
    "Q1_SleepHours",
    "Q2_PhoneInBed",
    "Q14_Attention",
    "hp_website",
    "Q3_KeepsAwake",
    "Q4_OneChange",
  ];
  const records = rows.map((row) => {
    const withOffset = !row.patterns.includes("edge_timestamp_without_zone");
    return [
      randomId(),
      formatLocal(row.endMs - row.durationSeconds * 1000, withOffset),
      formatLocal(row.endMs, withOffset),
      String(row.durationSeconds),
      row.ip,
      row.firstName,
      row.email,
      row.phone,
      String(row.age),
      row.dob,
      row.student,
      String(row.sleepHours),
      row.phoneInBed,
      row.attention,
      row.honeypot,
      row.q3,
      row.q4,
    ];
  });

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "sleep-study-responses.csv"), `${Papa.unparse([header, ...records])}\n`, "utf8");

  const mapping: ImportMapping = {
    timezone: "America/New_York",
    dateOrder: "MDY",
    columns: [
      { column: "ResponseId", role: "respondent_id" },
      { column: "StartDate", role: "started_at" },
      { column: "EndDate", role: "submitted_at" },
      { column: "Duration (in seconds)", role: "duration_seconds" },
      { column: "IPAddress", role: "ip" },
      { column: "FirstName", role: "other" },
      { column: "Email", role: "payout_email" },
      { column: "Phone", role: "payout_phone" },
      { column: "Age", role: "age" },
      { column: "DateOfBirth", role: "date_of_birth" },
      { column: "Student", role: "eligibility" },
      { column: "Q1_SleepHours", role: "other" },
      { column: "Q2_PhoneInBed", role: "other" },
      { column: "Q14_Attention", role: "attention_check", expectedValue: "Strongly disagree" },
      { column: "hp_website", role: "honeypot" },
      { column: "Q3_KeepsAwake", role: "open_text", questionText: QUESTION_Q3, contextColumns: ["Q1_SleepHours", "Q2_PhoneInBed"] },
      { column: "Q4_OneChange", role: "open_text", questionText: QUESTION_Q4, contextColumns: ["Q1_SleepHours", "Q2_PhoneInBed"] },
    ],
  };
  writeFileSync(join(OUT_DIR, "mapping.json"), `${JSON.stringify(mapping, null, 2)}\n`, "utf8");

  const refs = new Map<Pattern, string[]>();
  rows.forEach((row, index) => {
    const ref = `R-${String(index + 1).padStart(4, "0")}`;
    for (const pattern of row.patterns) {
      refs.set(pattern, [...(refs.get(pattern) ?? []), ref]);
    }
  });
  const clusters = findClusters(rows.map((row, index) => ({ ref: `R-${String(index + 1).padStart(4, "0")}`, text: row.q3 })));
  const burstRows = rows.filter((row) => row.patterns.includes("bot_burst"));
  const burstMinutes = ((burstRows.at(-1)!.endMs - burstRows[0]!.endMs) / 60_000).toFixed(1);

  const describe: Record<Pattern, string> = {
    genuine: "Genuine respondents: 6–25 min, consistent answers, specific open text in varied styles (typos, non-native English, short answers).",
    genuine_sandbox_receiver: "Genuine respondents paid to PayPal sandbox personal accounts (SANDBOX_RECEIVERS), expected SUCCESS.",
    genuine_shared_campus_ip: "Genuine respondents sharing one campus IP (128.59.20.17). Must end Pay (or Hold at most), never Don't pay.",
    duplicate_identity_kept: "Earliest submission for the Gmail address royk.hon.sample (dot variant). Kept by the one-payment rule.",
    duplicate_identity_later: "Later submissions using Gmail dot / +tag / googlemail variants of the same inbox.",
    bot_burst: `Bot burst: ${burstRows.length} rows at 1–3 s intervals over ${burstMinutes} minutes, 40–90 s durations, mostly failed attention check, honeypot filled for some.`,
    templated_text: "Fluent generic paraphrases of one paragraph (similarity cluster), otherwise passing all rules.",
    age_dob_contradiction: "Age 19 with a 1987 date of birth.",
    phone_contradiction: '"I never use my phone in bed" while selecting "Every night" on Q2.',
    gibberish: "Random characters / word salad in Q3.",
    off_topic: "Fluent answers that do not answer Q3.",
    prompt_injection: "Answers that try to instruct the AI to approve payment.",
    missing_payout_email: "No payout email or phone.",
    invalid_phone: "No email; phone 555-12 cannot receive a payout.",
    too_old: "Ages 34, 41, 52 (outside the 18–30 eligibility rule), consistent dates of birth.",
    speeder: "Human-looking answers finished in 70–220 seconds (under the 4-minute rule), outside the burst.",
    failed_attention: "Normal durations but wrong answer to the Q14 attention check.",
    edge_accented_name: "UTF-8 name with accents in FirstName.",
    edge_excel_date_of_birth: "Date of birth stored as an Excel serial number.",
    edge_timestamp_without_zone: "StartDate/EndDate without a UTC offset (the mapping states America/New_York).",
  };

  const manifest = [
    "# Sample study manifest",
    "",
    "Synthetic data for the fictional study “Sleep and Study Habits of University Students” (protocol IRB-2026-041 (synthetic)). No real people. Generated by `scripts/generate-sample.ts` with a fixed seed.",
    "",
    `Rows: ${rows.length}. Refs are R-0001… in file order (sorted by EndDate), as Honorarium assigns them on import.`,
    "",
    "| Pattern | Rows | Description | Respondent refs |",
    "|---|---|---|---|",
    ...(Object.keys(describe) as Pattern[]).map((pattern) => {
      const list = refs.get(pattern) ?? [];
      const shown = list.length > 12 ? `${list.slice(0, 12).join(", ")} … (${list.length} total)` : list.join(", ");
      return `| \`${pattern}\` | ${list.length} | ${describe[pattern]} | ${shown} |`;
    }),
    "",
    "## Similarity check on Q3 (computed by the engine when this file was generated)",
    "",
    ...clusters.map((cluster, index) => `- Cluster ${index + 1}: ${cluster.refs.length} respondents (${cluster.refs.slice(0, 8).join(", ")}${cluster.refs.length > 8 ? ", …" : ""})`),
    "",
    "## Full ref lists",
    "",
    ...(Object.keys(describe) as Pattern[]).map((pattern) => `- \`${pattern}\`: ${(refs.get(pattern) ?? []).join(", ") || "none"}`),
    "",
  ].join("\n");
  writeFileSync(join(OUT_DIR, "MANIFEST.md"), manifest, "utf8");
  writeFileSync(join(OUT_DIR, "manifest.json"), `${JSON.stringify(Object.fromEntries(refs), null, 2)}\n`, "utf8");

  console.log(`Wrote ${rows.length} rows, ${clusters.length} similarity cluster(s) on Q3 (sizes ${clusters.map((cluster) => cluster.refs.length).join(", ")}).`);
}

main();
