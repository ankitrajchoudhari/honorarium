import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

const id = uuid("id").primaryKey().defaultRandom();

export const studyStatus = pgEnum("study_status", ["draft", "rules_locked", "data_imported", "verifying", "reviewing", "paying", "closed"]);
export const layer = pgEnum("check_layer", ["deterministic", "similarity", "ai"]);
export const checkSource = pgEnum("check_source", ["rule", "system", "advisory"]);
export const outcome = pgEnum("check_outcome", ["pass", "note", "review", "exclude"]);
export const decisionValue = pgEnum("decision_value", ["pay", "hold", "dont_pay"]);
export const decisionSource = pgEnum("decision_source", ["rules", "reviewer", "payout"]);
export const jobKind = pgEnum("job_kind", ["verify"]);
export const jobStatus = pgEnum("job_status", ["running", "paused", "done", "failed"]);
export const bucket = pgEnum("ledger_bucket", ["budget", "unallocated", "allocated_pay", "held_review", "in_flight", "paid", "unclaimed", "withheld"]);
export const payoutIdentityType = pgEnum("payout_identity_type", ["email", "phone"]);
export const batchStatus = pgEnum("payout_batch_status", [
  "created",
  "request_failed",
  "rejected",
  "PENDING",
  "PROCESSING",
  "SUCCESS",
  "DENIED",
  "CANCELED",
]);
export const itemStatus = pgEnum("payout_item_status", [
  "NEW",
  "PENDING",
  "ONHOLD",
  "UNCLAIMED",
  "SUCCESS",
  "FAILED",
  "RETURNED",
  "BLOCKED",
  "REFUNDED",
  "REVERSED",
  "NOT_SENT",
]);

/** Item statuses where the money is back with the sender; such items no longer block a new payout. */
export const RELEASED_ITEM_STATUSES = ["FAILED", "RETURNED", "REFUNDED", "REVERSED", "NOT_SENT"] as const;
const releasedList = sql.raw(RELEASED_ITEM_STATUSES.map((status) => `'${status}'`).join(", "));

export const workspaces = pgTable("workspaces", {
  id,
  name: text("name").notNull(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
  ...timestamps,
});

export const studies = pgTable(
  "studies",
  {
    id,
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    shortCode: text("short_code").notNull(),
    protocolNumber: text("protocol_number"),
    piName: text("pi_name").notNull(),
    currency: text("currency").notNull().default("USD"),
    budgetCents: integer("budget_cents").notNull(),
    amountPerParticipantCents: integer("amount_per_participant_cents").notNull(),
    status: studyStatus("status").notNull().default("draft"),
    consentTextExcerpt: text("consent_text_excerpt").notNull(),
    twoReviewerMode: boolean("two_reviewer_mode").notNull().default(false),
    isSample: boolean("is_sample").notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("studies_workspace_code").on(t.workspaceId, t.shortCode), index("studies_workspace").on(t.workspaceId)],
);

export const ruleSets = pgTable(
  "rule_sets",
  {
    id,
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    sourceText: text("source_text").notNull(),
    compiledJson: jsonb("compiled_json"),
    couldNotCompileJson: jsonb("could_not_compile_json"),
    compiledBy: text("compiled_by"),
    changeNote: text("change_note"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    sha256: text("sha256"),
    ...timestamps,
  },
  (t) => [uniqueIndex("rule_sets_study_version").on(t.studyId, t.version)],
);

export const imports = pgTable(
  "imports",
  {
    id,
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    sha256: text("sha256").notNull(),
    rowCount: integer("row_count").notNull(),
    columnsJson: jsonb("columns_json").notNull(),
    parseWarningsJson: jsonb("parse_warnings_json").notNull(),
    encoding: text("encoding").notNull(),
    timezone: text("timezone"),
    dateOrder: text("date_order").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("imports_study").on(t.studyId)],
);

export const questionMap = pgTable(
  "question_map",
  {
    id,
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    columnName: text("column_name").notNull(),
    position: integer("position").notNull(),
    role: text("role").notNull(),
    questionText: text("question_text"),
    expectedValue: text("expected_value"),
    /** For open-text columns: the closed-answer columns the AI may compare against (2–4). */
    contextColumns: jsonb("context_columns").$type<string[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [uniqueIndex("question_map_study_column").on(t.studyId, t.columnName)],
);

export const respondents = pgTable(
  "respondents",
  {
    id,
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    importId: uuid("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    respondentRef: text("respondent_ref").notNull(),
    rawJson: jsonb("raw_json").$type<Record<string, string>>().notNull(),
    payoutIdentityRaw: text("payout_identity_raw"),
    payoutIdentityNormalized: text("payout_identity_normalized"),
    payoutIdentityType: payoutIdentityType("payout_identity_type"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    durationSeconds: doublePrecision("duration_seconds"),
    currentDecision: decisionValue("current_decision"),
    currentDecisionSource: decisionSource("current_decision_source"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("respondents_study_ref").on(t.studyId, t.respondentRef),
    index("respondents_study_decision").on(t.studyId, t.currentDecision),
  ],
);

export const checks = pgTable(
  "checks",
  {
    id,
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    respondentId: uuid("respondent_id")
      .notNull()
      .references(() => respondents.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").notNull(),
    layer: layer("layer").notNull(),
    source: checkSource("source").notNull(),
    outcome: outcome("outcome").notNull(),
    evidenceJson: jsonb("evidence_json").notNull(),
    ruleSetVersion: integer("rule_set_version").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("checks_respondent_rule").on(t.respondentId, t.ruleId), index("checks_study_layer").on(t.studyId, t.layer)],
);

export const decisions = pgTable(
  "decisions",
  {
    id,
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    respondentId: uuid("respondent_id")
      .notNull()
      .references(() => respondents.id, { onDelete: "cascade" }),
    decision: decisionValue("decision").notNull(),
    source: decisionSource("source").notNull(),
    reasonsJson: jsonb("reasons_json").notNull(),
    justification: text("justification"),
    isOverride: boolean("is_override").notNull().default(false),
    decidedBy: text("decided_by").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    secondReviewer: text("second_reviewer"),
    secondDecidedAt: timestamp("second_decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("decisions_respondent").on(t.respondentId, t.decidedAt)],
);

export const reviewVotes = pgTable(
  "review_votes",
  {
    id,
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    respondentId: uuid("respondent_id")
      .notNull()
      .references(() => respondents.id, { onDelete: "cascade" }),
    reviewer: text("reviewer").notNull(),
    decision: decisionValue("decision").notNull(),
    reason: text("reason").notNull(),
    resolvedDecisionId: uuid("resolved_decision_id").references(() => decisions.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("review_votes_respondent").on(t.respondentId),
    uniqueIndex("review_votes_open_per_reviewer").on(t.respondentId, t.reviewer).where(sql`resolved_decision_id is null`),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id,
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    kind: jobKind("kind").notNull(),
    status: jobStatus("status").notNull().default("running"),
    cursorJson: jsonb("cursor_json").notNull(),
    version: integer("version").notNull().default(0),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    callsUsed: integer("calls_used").notNull().default(0),
    notBefore: timestamp("not_before", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("jobs_study").on(t.studyId)],
);

export const aiCache = pgTable("ai_cache", {
  hash: text("hash").primaryKey(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  outputJson: jsonb("output_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiUsage = pgTable("ai_usage", {
  day: date("day").primaryKey(),
  calls: integer("calls").notNull().default(0),
  lastCallAt: timestamp("last_call_at", { withTimezone: true }),
});

export const payoutBatches = pgTable(
  "payout_batches",
  {
    id,
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    batchNumber: integer("batch_number").notNull(),
    senderBatchId: text("sender_batch_id").notNull(),
    approvalNonce: text("approval_nonce").notNull(),
    paypalBatchId: text("paypal_batch_id"),
    status: batchStatus("status").notNull().default("created"),
    itemCount: integer("item_count").notNull(),
    totalCents: integer("total_cents").notNull(),
    approvedBy: text("approved_by").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
    emailSubject: text("email_subject").notNull(),
    requestJson: jsonb("request_json").notNull(),
    responseJson: jsonb("response_json"),
    errorJson: jsonb("error_json"),
    retryOfBatchId: uuid("retry_of_batch_id"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("payout_batches_sender_batch_id").on(t.senderBatchId),
    uniqueIndex("payout_batches_study_number").on(t.studyId, t.batchNumber),
    uniqueIndex("payout_batches_nonce").on(t.approvalNonce),
  ],
);

export const payoutItems = pgTable(
  "payout_items",
  {
    id,
    batchId: uuid("batch_id")
      .notNull()
      .references(() => payoutBatches.id, { onDelete: "cascade" }),
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    respondentId: uuid("respondent_id")
      .notNull()
      .references(() => respondents.id, { onDelete: "cascade" }),
    senderItemId: text("sender_item_id").notNull(),
    paypalItemId: text("paypal_item_id"),
    transactionId: text("transaction_id"),
    receiver: text("receiver").notNull(),
    recipientType: text("recipient_type").notNull(),
    identityNormalized: text("identity_normalized").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: itemStatus("status").notNull().default("NEW"),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    unclaimedSince: timestamp("unclaimed_since", { withTimezone: true }),
    errorJson: jsonb("error_json"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("payout_items_sender_item_id").on(t.senderItemId),
    uniqueIndex("payout_items_live_respondent").on(t.respondentId).where(sql`status not in (${releasedList})`),
    uniqueIndex("payout_items_live_identity").on(t.studyId, t.identityNormalized).where(sql`status not in (${releasedList})`),
    index("payout_items_batch").on(t.batchId),
    index("payout_items_paypal_id").on(t.paypalItemId),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id,
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "cascade" }),
    respondentId: uuid("respondent_id").references(() => respondents.id, { onDelete: "cascade" }),
    payoutItemId: uuid("payout_item_id").references(() => payoutItems.id, { onDelete: "cascade" }),
    fromBucket: bucket("from_bucket").notNull(),
    toBucket: bucket("to_bucket").notNull(),
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason").notNull(),
    sourceEvent: text("source_event").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ledger_study").on(t.studyId, t.createdAt), index("ledger_respondent").on(t.respondentId)],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id,
    paypalEventId: text("paypal_event_id").notNull(),
    eventType: text("event_type").notNull(),
    resourceId: text("resource_id"),
    verified: boolean("verified").notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processResult: text("process_result"),
    ...timestamps,
  },
  (t) => [uniqueIndex("webhook_events_paypal_event").on(t.paypalEventId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id,
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    studyId: uuid("study_id").references(() => studies.id, { onDelete: "cascade" }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    target: text("target"),
    beforeJson: jsonb("before_json"),
    afterJson: jsonb("after_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_study").on(t.studyId, t.createdAt)],
);

export const rateLimitHits = pgTable(
  "rate_limit_hits",
  {
    id,
    key: text("key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rate_limit_key_time").on(t.key, t.createdAt)],
);
