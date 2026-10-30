CREATE TABLE `email_templates` (
	`key` text PRIMARY KEY NOT NULL,
	`template` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `leads` ADD `do_not_contact` integer DEFAULT false NOT NULL;