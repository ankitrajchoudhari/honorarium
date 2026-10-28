export const COLUMN_ROLES = [
  "payout_email",
  "payout_phone",
  "respondent_id",
  "submitted_at",
  "started_at",
  "duration_seconds",
  "ip",
  "ip_country",
  "country",
  "user_agent",
  "attention_check",
  "honeypot",
  "age",
  "date_of_birth",
  "open_text",
  "eligibility",
  "other",
] as const;

export type ColumnRole = (typeof COLUMN_ROLES)[number];

export const ROLE_LABELS: Record<ColumnRole, string> = {
  payout_email: "Payout email",
  payout_phone: "Payout phone",
  respondent_id: "Respondent ID",
  submitted_at: "Submitted at",
  started_at: "Started at",
  duration_seconds: "Duration (seconds)",
  ip: "IP address",
  ip_country: "Country from IP",
  country: "Country (self-reported)",
  user_agent: "User agent",
  attention_check: "Attention check",
  honeypot: "Hidden field (honeypot)",
  age: "Age",
  date_of_birth: "Date of birth",
  open_text: "Open-text answer",
  eligibility: "Eligibility answer",
  other: "Other",
};

/** Roles that identify a person. Values for these never leave the server and never go to the AI service. */
export const IDENTIFYING_ROLES: ReadonlySet<ColumnRole> = new Set([
  "payout_email",
  "payout_phone",
  "respondent_id",
  "ip",
  "user_agent",
]);

/** Roles where at most one column can be mapped. */
export const SINGLE_COLUMN_ROLES: ReadonlySet<ColumnRole> = new Set([
  "payout_email",
  "payout_phone",
  "respondent_id",
  "submitted_at",
  "started_at",
  "duration_seconds",
  "ip",
  "ip_country",
  "country",
  "user_agent",
  "honeypot",
  "age",
  "date_of_birth",
]);
