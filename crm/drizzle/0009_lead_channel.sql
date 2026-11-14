ALTER TABLE `leads` ADD `channel` text;--> statement-breakpoint
-- Backfill (docs/adr/0005-lead-sources.md): the form a website Lead's first Form submission came from, else its Source.
UPDATE `leads` SET `channel` = (
	SELECT CASE fs.`source` WHEN 'estimator' THEN 'estimator' WHEN 'quote_form' THEN 'quote_form' ELSE 'website' END
	FROM `submission_processing` sp JOIN `form_submissions` fs ON fs.`id` = sp.`submission_id`
	WHERE sp.`lead_id` = `leads`.`id` ORDER BY fs.`received_at` LIMIT 1
) WHERE `channel` IS NULL;
--> statement-breakpoint
UPDATE `leads` SET `channel` = CASE `first_source`
	WHEN 'website' THEN 'website' WHEN 'text' THEN 'text' WHEN 'phone' THEN 'call' WHEN 'email' THEN 'email' ELSE 'manual' END
WHERE `channel` IS NULL;
