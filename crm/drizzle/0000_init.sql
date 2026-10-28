CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `alarm_days` (
	`condition` text NOT NULL,
	`day` text NOT NULL,
	PRIMARY KEY(`condition`, `day`)
);
--> statement-breakpoint
CREATE TABLE `company_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`email` text,
	`service_area` text,
	`business_number` text,
	`timezone` text NOT NULL,
	`owner_alert_emails` text,
	`texting_enabled` integer DEFAULT false NOT NULL,
	CONSTRAINT "company_settings_single_row" CHECK("company_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `consent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`phone_e164` text NOT NULL,
	`program` text NOT NULL,
	`event` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`disclosure_version` text,
	`source` text NOT NULL,
	`source_ref` text,
	`lead_id` text,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "consent_events_program_check" CHECK("consent_events"."program" in ('sms_followup', 'sms_alerts')),
	CONSTRAINT "consent_events_event_check" CHECK("consent_events"."event" in ('grant', 'revoke')),
	CONSTRAINT "consent_events_source_check" CHECK("consent_events"."source" in ('form', 'text', 'staff'))
);
--> statement-breakpoint
CREATE INDEX `consent_events_phone_idx` ON `consent_events` (`phone_e164`,`program`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `cron_runs` (
	`cron` text PRIMARY KEY NOT NULL,
	`last_run_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `form_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`received_at` integer NOT NULL,
	`schema_version` integer NOT NULL,
	`source` text,
	`raw_body` text NOT NULL,
	`ip_hash` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `form_submissions_submission_key_unique` ON `form_submissions` (`submission_key`);--> statement-breakpoint
CREATE TABLE `lead_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`kind` text NOT NULL,
	`direction` text,
	`outcome` text,
	`duration_min` integer,
	`body` text,
	`author_id` text,
	`follow_up_at` integer,
	`follow_up_done_at` integer,
	`dedupe_key` text,
	`created_at` integer NOT NULL,
	`dispatch_state` text,
	`provider_message_id` text,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "lead_activity_kind_check" CHECK("lead_activity"."kind" in ('note', 'text', 'call', 'email', 'form', 'appointment'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_activity_dedupe_key_unique` ON `lead_activity` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `lead_activity_lead_id_idx` ON `lead_activity` (`lead_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `lead_files` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`kind` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`r2_key` text NOT NULL,
	`uploaded_by` text,
	`uploaded_at` integer NOT NULL,
	`removed_at` integer,
	`removed_by` text,
	`removed_reason` text,
	`replaced_by_id` text,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`removed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "lead_files_kind_check" CHECK("lead_files"."kind" in ('hover_report', 'materials_list', 'customer_quote', 'signed_quote', 'contractor_agreement')),
	CONSTRAINT "lead_files_file_name_check" CHECK(length("lead_files"."file_name") between 1 and 200),
	CONSTRAINT "lead_files_content_type_check" CHECK("lead_files"."content_type" in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic')),
	CONSTRAINT "lead_files_size_check" CHECK("lead_files"."size_bytes" between 1 and 26214400),
	CONSTRAINT "lead_files_removed_reason_check" CHECK("lead_files"."removed_reason" is null or "lead_files"."removed_reason" in ('replaced', 'removed')),
	CONSTRAINT "lead_files_removed_pair" CHECK(("lead_files"."removed_at" is null) = ("lead_files"."removed_reason" is null)),
	CONSTRAINT "lead_files_replaced_by_check" CHECK("lead_files"."replaced_by_id" is null or "lead_files"."removed_reason" = 'replaced')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lead_files_r2_key_unique` ON `lead_files` (`r2_key`);--> statement-breakpoint
CREATE INDEX `lead_files_lead_kind_idx` ON `lead_files` (`lead_id`,`kind`,`uploaded_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `lead_files_one_current` ON `lead_files` (`lead_id`,`kind`) WHERE "lead_files"."removed_at" is null;--> statement-breakpoint
CREATE TABLE `lead_stage_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`from_stage` text,
	`to_stage` text NOT NULL,
	`changed_at` integer NOT NULL,
	`changed_by` text,
	`reason` text,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `lead_stage_changes_lead_idx` ON `lead_stage_changes` (`lead_id`,`changed_at`);--> statement-breakpoint
CREATE INDEX `lead_stage_changes_to_stage_idx` ON `lead_stage_changes` (`to_stage`,`changed_at`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text,
	`last_name` text,
	`email` text,
	`email_lower` text,
	`phone` text,
	`phone_e164` text,
	`street` text,
	`city` text,
	`state` text,
	`zip` text,
	`stage` text DEFAULT 'new' NOT NULL,
	`source` text NOT NULL,
	`first_source` text NOT NULL,
	`service_type` text,
	`message` text,
	`assigned_to` text,
	`lead_score` integer,
	`attribution_json` text,
	`first_touch_json` text,
	`needs_review` integer DEFAULT false NOT NULL,
	`address_key` text,
	`active_leak` integer DEFAULT false NOT NULL,
	`roof_answers_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`assigned_to`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "leads_stage_check" CHECK("leads"."stage" in ('new', 'contacted', 'appointment', 'quoted', 'won', 'lost'))
);
--> statement-breakpoint
CREATE INDEX `leads_address_key_idx` ON `leads` (`address_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `leads_phone_e164_unique` ON `leads` (`phone_e164`) WHERE "leads"."phone_e164" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `leads_email_lower_unique` ON `leads` (`email_lower`) WHERE "leads"."email_lower" is not null;--> statement-breakpoint
CREATE TABLE `notification_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`claimed_until` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`next_attempt_at` integer,
	`first_attempt_at` integer,
	`sent_at` integer,
	`provider_message_id` text,
	`created_at` integer,
	`recipient` text,
	`subject` text,
	`outcome` text,
	CONSTRAINT "notification_jobs_state_check" CHECK("notification_jobs"."state" in ('pending', 'claimed', 'sent', 'failed', 'dead'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_jobs_dedupe_key_unique` ON `notification_jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notification_jobs_state_idx` ON `notification_jobs` (`state`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `r2_prefix_deletes` (
	`prefix` text PRIMARY KEY NOT NULL,
	`sweeps_done` integer DEFAULT 0 NOT NULL,
	`next_sweep_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`impersonated_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `submission_processing` (
	`submission_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'received' NOT NULL,
	`lead_id` text,
	`result_json` text,
	`claimed_until` integer,
	`error` text,
	`processed_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `form_submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "submission_processing_state_check" CHECK("submission_processing"."state" in ('received', 'processing', 'processed', 'rejected', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`role` text DEFAULT 'staff' NOT NULL,
	`banned` integer DEFAULT false NOT NULL,
	`ban_reason` text,
	`ban_expires` integer,
	CONSTRAINT "user_role_check" CHECK("user"."role" in ('admin', 'staff'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
-- The one company settings row. Phone and email are the site's placeholders (src/data/business.ts, CLAIMS.md):
-- Owner alerts go to `email` until an admin sets Owner alert emails in Company settings.
INSERT INTO `company_settings` (`id`, `name`, `phone`, `email`, `service_area`, `timezone`) VALUES (1, 'Turner''s Decks', '(484) 824-0373', 'turnersdecks@gmail.com', 'Berks, Montgomery and Chester counties, PA (about 30 miles of Douglassville)', 'America/New_York');
