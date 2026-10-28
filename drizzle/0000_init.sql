CREATE TYPE "public"."payout_batch_status" AS ENUM('created', 'request_failed', 'rejected', 'PENDING', 'PROCESSING', 'SUCCESS', 'DENIED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."ledger_bucket" AS ENUM('budget', 'unallocated', 'allocated_pay', 'held_review', 'in_flight', 'paid', 'unclaimed', 'withheld');--> statement-breakpoint
CREATE TYPE "public"."check_source" AS ENUM('rule', 'system', 'advisory');--> statement-breakpoint
CREATE TYPE "public"."decision_source" AS ENUM('rules', 'reviewer', 'payout');--> statement-breakpoint
CREATE TYPE "public"."decision_value" AS ENUM('pay', 'hold', 'dont_pay');--> statement-breakpoint
CREATE TYPE "public"."payout_item_status" AS ENUM('NEW', 'PENDING', 'ONHOLD', 'UNCLAIMED', 'SUCCESS', 'FAILED', 'RETURNED', 'BLOCKED', 'REFUNDED', 'REVERSED', 'NOT_SENT');--> statement-breakpoint
CREATE TYPE "public"."job_kind" AS ENUM('verify');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('running', 'paused', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."check_layer" AS ENUM('deterministic', 'similarity', 'ai');--> statement-breakpoint
CREATE TYPE "public"."check_outcome" AS ENUM('pass', 'note', 'review', 'exclude');--> statement-breakpoint
CREATE TYPE "public"."payout_identity_type" AS ENUM('email', 'phone');--> statement-breakpoint
CREATE TYPE "public"."study_status" AS ENUM('draft', 'rules_locked', 'data_imported', 'verifying', 'reviewing', 'paying', 'closed');--> statement-breakpoint
CREATE TABLE "ai_cache" (
	"hash" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"output_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"day" date PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"last_call_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"study_id" uuid,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"respondent_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"layer" "check_layer" NOT NULL,
	"source" "check_source" NOT NULL,
	"outcome" "check_outcome" NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"rule_set_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"respondent_id" uuid NOT NULL,
	"decision" "decision_value" NOT NULL,
	"source" "decision_source" NOT NULL,
	"reasons_json" jsonb NOT NULL,
	"justification" text,
	"is_override" boolean DEFAULT false NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"second_reviewer" text,
	"second_decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"sha256" text NOT NULL,
	"row_count" integer NOT NULL,
	"columns_json" jsonb NOT NULL,
	"parse_warnings_json" jsonb NOT NULL,
	"encoding" text NOT NULL,
	"timezone" text,
	"date_order" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"kind" "job_kind" NOT NULL,
	"status" "job_status" DEFAULT 'running' NOT NULL,
	"cursor_json" jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"calls_used" integer DEFAULT 0 NOT NULL,
	"not_before" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"respondent_id" uuid,
	"payout_item_id" uuid,
	"from_bucket" "ledger_bucket" NOT NULL,
	"to_bucket" "ledger_bucket" NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"source_event" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"batch_number" integer NOT NULL,
	"sender_batch_id" text NOT NULL,
	"approval_nonce" text NOT NULL,
	"paypal_batch_id" text,
	"status" "payout_batch_status" DEFAULT 'created' NOT NULL,
	"item_count" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email_subject" text NOT NULL,
	"request_json" jsonb NOT NULL,
	"response_json" jsonb,
	"error_json" jsonb,
	"retry_of_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"study_id" uuid NOT NULL,
	"respondent_id" uuid NOT NULL,
	"sender_item_id" text NOT NULL,
	"paypal_item_id" text,
	"transaction_id" text,
	"receiver" text NOT NULL,
	"recipient_type" text NOT NULL,
	"identity_normalized" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "payout_item_status" DEFAULT 'NEW' NOT NULL,
	"last_event_at" timestamp with time zone,
	"unclaimed_since" timestamp with time zone,
	"error_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"column_name" text NOT NULL,
	"position" integer NOT NULL,
	"role" text NOT NULL,
	"question_text" text,
	"expected_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "respondents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"respondent_ref" text NOT NULL,
	"raw_json" jsonb NOT NULL,
	"payout_identity_raw" text,
	"payout_identity_normalized" text,
	"payout_identity_type" "payout_identity_type",
	"submitted_at" timestamp with time zone,
	"duration_seconds" double precision,
	"current_decision" "decision_value",
	"current_decision_source" "decision_source",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"respondent_id" uuid NOT NULL,
	"reviewer" text NOT NULL,
	"decision" "decision_value" NOT NULL,
	"reason" text NOT NULL,
	"resolved_decision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"source_text" text NOT NULL,
	"compiled_json" jsonb,
	"could_not_compile_json" jsonb,
	"compiled_by" text,
	"change_note" text,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"short_code" text NOT NULL,
	"protocol_number" text,
	"pi_name" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"budget_cents" integer NOT NULL,
	"amount_per_participant_cents" integer NOT NULL,
	"status" "study_status" DEFAULT 'draft' NOT NULL,
	"consent_text_excerpt" text NOT NULL,
	"two_reviewer_mode" boolean DEFAULT false NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paypal_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"resource_id" text,
	"verified" boolean NOT NULL,
	"payload_json" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"process_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_respondent_id_respondents_id_fk" FOREIGN KEY ("respondent_id") REFERENCES "public"."respondents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_respondent_id_respondents_id_fk" FOREIGN KEY ("respondent_id") REFERENCES "public"."respondents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_respondent_id_respondents_id_fk" FOREIGN KEY ("respondent_id") REFERENCES "public"."respondents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payout_item_id_payout_items_id_fk" FOREIGN KEY ("payout_item_id") REFERENCES "public"."payout_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_batch_id_payout_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payout_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_respondent_id_respondents_id_fk" FOREIGN KEY ("respondent_id") REFERENCES "public"."respondents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_map" ADD CONSTRAINT "question_map_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "respondents" ADD CONSTRAINT "respondents_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "respondents" ADD CONSTRAINT "respondents_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_votes" ADD CONSTRAINT "review_votes_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_votes" ADD CONSTRAINT "review_votes_respondent_id_respondents_id_fk" FOREIGN KEY ("respondent_id") REFERENCES "public"."respondents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_votes" ADD CONSTRAINT "review_votes_resolved_decision_id_decisions_id_fk" FOREIGN KEY ("resolved_decision_id") REFERENCES "public"."decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_sets" ADD CONSTRAINT "rule_sets_study_id_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studies" ADD CONSTRAINT "studies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_study" ON "audit_log" USING btree ("study_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "checks_respondent_rule" ON "checks" USING btree ("respondent_id","rule_id");--> statement-breakpoint
CREATE INDEX "checks_study_layer" ON "checks" USING btree ("study_id","layer");--> statement-breakpoint
CREATE INDEX "decisions_respondent" ON "decisions" USING btree ("respondent_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "imports_study" ON "imports" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "jobs_study" ON "jobs" USING btree ("study_id");--> statement-breakpoint
CREATE INDEX "ledger_study" ON "ledger_entries" USING btree ("study_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_respondent" ON "ledger_entries" USING btree ("respondent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_batches_sender_batch_id" ON "payout_batches" USING btree ("sender_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_batches_study_number" ON "payout_batches" USING btree ("study_id","batch_number");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_batches_nonce" ON "payout_batches" USING btree ("approval_nonce");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_items_sender_item_id" ON "payout_items" USING btree ("sender_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payout_items_live_respondent" ON "payout_items" USING btree ("respondent_id") WHERE status not in ('FAILED', 'RETURNED', 'REFUNDED', 'REVERSED', 'NOT_SENT');--> statement-breakpoint
CREATE UNIQUE INDEX "payout_items_live_identity" ON "payout_items" USING btree ("study_id","identity_normalized") WHERE status not in ('FAILED', 'RETURNED', 'REFUNDED', 'REVERSED', 'NOT_SENT');--> statement-breakpoint
CREATE INDEX "payout_items_batch" ON "payout_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "payout_items_paypal_id" ON "payout_items" USING btree ("paypal_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "question_map_study_column" ON "question_map" USING btree ("study_id","column_name");--> statement-breakpoint
CREATE INDEX "rate_limit_key_time" ON "rate_limit_hits" USING btree ("key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "respondents_study_ref" ON "respondents" USING btree ("study_id","respondent_ref");--> statement-breakpoint
CREATE INDEX "respondents_study_decision" ON "respondents" USING btree ("study_id","current_decision");--> statement-breakpoint
CREATE INDEX "review_votes_respondent" ON "review_votes" USING btree ("respondent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_votes_open_per_reviewer" ON "review_votes" USING btree ("respondent_id","reviewer") WHERE resolved_decision_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "rule_sets_study_version" ON "rule_sets" USING btree ("study_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "studies_workspace_code" ON "studies" USING btree ("workspace_id","short_code");--> statement-breakpoint
CREATE INDEX "studies_workspace" ON "studies" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_paypal_event" ON "webhook_events" USING btree ("paypal_event_id");