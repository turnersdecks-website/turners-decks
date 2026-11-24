ALTER TABLE `company_settings` ADD `appointment_digest_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `company_settings` ADD `appointment_digest_to` text;