CREATE TABLE `quo_connection` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`phone_number_id` text NOT NULL,
	`phone_number_e164` text NOT NULL,
	`webhook_id` text NOT NULL,
	`signing_secret` text NOT NULL,
	`connected_at` integer NOT NULL,
	`connected_by` text,
	FOREIGN KEY (`connected_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "quo_connection_single_row" CHECK("quo_connection"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `quo_webhook_events` (
	`webhook_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `company_settings` ADD `owner_mobile` text;