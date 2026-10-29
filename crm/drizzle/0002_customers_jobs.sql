CREATE TABLE `customers` (
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
	`customer_since` integer,
	`how_found` text,
	`referred_by_id` text,
	`review_left` integer DEFAULT false NOT NULL,
	`ok_to_contact` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`referred_by_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_phone_e164_unique` ON `customers` (`phone_e164`) WHERE "customers"."phone_e164" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `customers_email_lower_unique` ON `customers` (`email_lower`) WHERE "customers"."email_lower" is not null;--> statement-breakpoint
CREATE INDEX `customers_referred_by_idx` ON `customers` (`referred_by_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`lead_id` text,
	`name` text NOT NULL,
	`city` text,
	`project_type` text,
	`material` text,
	`status` text DEFAULT 'not_scheduled' NOT NULL,
	`start_date` text,
	`finish_date` text,
	`square_footage` real,
	`quoted_price_cents` integer,
	`quoted_material_cost_cents` integer,
	`actual_material_cost_cents` integer,
	`labor_cost_cents` integer,
	`actual_labor_hours` real,
	`permit_needed` integer DEFAULT false NOT NULL,
	`permit_pulled` integer DEFAULT false NOT NULL,
	`hoa_needed` integer DEFAULT false NOT NULL,
	`hoa_approved` integer DEFAULT false NOT NULL,
	`ok_to_show_photos` integer DEFAULT false NOT NULL,
	`on_website` integer DEFAULT false NOT NULL,
	`review_asked` integer DEFAULT false NOT NULL,
	`review_received` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "jobs_status_check" CHECK("jobs"."status" in ('not_scheduled', 'scheduled', 'in_progress', 'done', 'on_hold', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `jobs_customer_idx` ON `jobs` (`customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_lead_idx` ON `jobs` (`lead_id`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
ALTER TABLE `leads` ADD `customer_id` text REFERENCES customers(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `leads_customer_idx` ON `leads` (`customer_id`);