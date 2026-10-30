CREATE TABLE `job_checklist` (
	`job_id` text NOT NULL,
	`item_key` text NOT NULL,
	`done_at` integer NOT NULL,
	`done_by` text,
	PRIMARY KEY(`job_id`, `item_key`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`done_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `jobs` ADD `step` text DEFAULT 'deposit' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `township` text;
--> statement-breakpoint
UPDATE `jobs` SET `step` = 'done' WHERE `status` = 'done';