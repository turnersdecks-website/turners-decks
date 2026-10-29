ALTER TABLE `customers` ADD `referred_by_name` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `client_type` text DEFAULT 'residential' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `how_found` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `referred_by_id` text REFERENCES customers(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `leads` ADD `referred_by_name` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `client_type` text DEFAULT 'residential' NOT NULL;--> statement-breakpoint
CREATE INDEX `leads_referred_by_idx` ON `leads` (`referred_by_id`);