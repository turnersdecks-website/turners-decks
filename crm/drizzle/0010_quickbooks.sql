CREATE TABLE `qbo_connection` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`realm_id` text NOT NULL,
	`company_name` text,
	`access_token_enc` text NOT NULL,
	`refresh_token_enc` text NOT NULL,
	`access_expires_at` integer NOT NULL,
	`refresh_expires_at` integer NOT NULL,
	`connected_at` integer NOT NULL,
	`connected_by` text,
	`backfilled_at` integer,
	`last_sync_at` integer,
	`last_sync_error` text,
	FOREIGN KEY (`connected_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "qbo_connection_single_row" CHECK("qbo_connection"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `qbo_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`qbo_id` text NOT NULL,
	`kind` text NOT NULL,
	`txn_date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`party_name` text,
	`party_qbo_id` text,
	`account` text,
	`memo` text,
	`doc_number` text,
	`lines_json` text,
	`deleted` integer DEFAULT false NOT NULL,
	`qbo_updated_at` integer,
	`synced_at` integer NOT NULL,
	`job_id` text,
	`assignment` text,
	`assigned_by` text,
	`assigned_at` integer,
	`suggested_job_id` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`suggested_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `qbo_txn_job_idx` ON `qbo_transactions` (`job_id`);--> statement-breakpoint
CREATE INDEX `qbo_txn_date_idx` ON `qbo_transactions` (`txn_date`);--> statement-breakpoint
CREATE INDEX `qbo_txn_assignment_idx` ON `qbo_transactions` (`assignment`,`txn_date`);