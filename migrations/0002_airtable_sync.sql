-- Airtable record id once a lead has been copied to Pat's Leads table.
-- NULL means it hasn't synced (no token set, or Airtable was down): check these.
ALTER TABLE quote_requests ADD COLUMN airtable_id TEXT;
