CREATE TABLE `photo_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`name` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	`last_used_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photo_devices_token_hash_unique` ON `photo_devices` (`token_hash`);--> statement-breakpoint
CREATE TABLE `photo_links` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`lead_id` text,
	`job_id` text,
	`stage` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`done_at` integer,
	`last_used_at` integer,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photo_links_token_hash_unique` ON `photo_links` (`token_hash`);--> statement-breakpoint
CREATE INDEX `photo_links_lead_idx` ON `photo_links` (`lead_id`);--> statement-breakpoint
CREATE INDEX `photo_links_job_idx` ON `photo_links` (`job_id`);--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text,
	`job_id` text,
	`stage` text NOT NULL,
	`r2_key` text NOT NULL,
	`thumb_r2_key` text,
	`size_bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`taken_at` integer,
	`uploaded_at` integer NOT NULL,
	`photo_link_id` text,
	`uploaded_by` text,
	`caption` text,
	`favorite` integer DEFAULT false NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`photo_link_id`) REFERENCES `photo_links`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`uploaded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photos_r2_key_unique` ON `photos` (`r2_key`);--> statement-breakpoint
CREATE INDEX `photos_job_idx` ON `photos` (`job_id`,`uploaded_at`);--> statement-breakpoint
CREATE INDEX `photos_lead_idx` ON `photos` (`lead_id`,`uploaded_at`);