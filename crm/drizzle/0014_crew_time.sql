CREATE TABLE `crew_checkins` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`work_date` text NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`sent_at` integer NOT NULL,
	`answered_at` integer,
	`reply` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crew_checkins_job_day_unique` ON `crew_checkins` (`job_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `crew_checkins_status_idx` ON `crew_checkins` (`status`,`sent_at`);--> statement-breakpoint
CREATE TABLE `crew_members` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`aliases` text,
	`pay_type` text,
	`rate_cents` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `crew_time` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`checkin_id` text,
	`crew_member_id` text,
	`name` text NOT NULL,
	`work_date` text NOT NULL,
	`hours` real,
	`pay_type` text,
	`rate_cents` integer,
	`cost_cents` integer,
	`needs_review` integer DEFAULT false NOT NULL,
	`source` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`checkin_id`) REFERENCES `crew_checkins`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`crew_member_id`) REFERENCES `crew_members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `crew_time_job_idx` ON `crew_time` (`job_id`,`work_date`);--> statement-breakpoint
ALTER TABLE `company_settings` ADD `crew_checkin_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `company_settings` ADD `crew_checkin_hour` integer DEFAULT 18 NOT NULL;