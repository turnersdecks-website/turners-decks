ALTER TABLE `crew_time` ADD `paid_via` text;--> statement-breakpoint
ALTER TABLE `crew_time` ADD `qbo_txn_id` text REFERENCES qbo_transactions(id);--> statement-breakpoint
ALTER TABLE `crew_time` ADD `paid_note` text;--> statement-breakpoint
ALTER TABLE `crew_time` ADD `verified_at` integer;--> statement-breakpoint
ALTER TABLE `crew_time` ADD `verified_by` text REFERENCES user(id);--> statement-breakpoint
CREATE INDEX `crew_time_qbo_idx` ON `crew_time` (`qbo_txn_id`);