-- Leads from the quote form and the price estimator (Cloudflare D1 / SQLite).
-- Same columns as the Lovable/Supabase table, so data can move between them.
CREATE TABLE IF NOT EXISTS quote_requests (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('quote_form', 'estimator')),
  first_name TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 60),
  last_name TEXT NOT NULL CHECK (length(last_name) BETWEEN 1 AND 60),
  email TEXT NOT NULL CHECK (length(email) <= 255),
  phone TEXT NOT NULL CHECK (length(phone) = 10),
  zip TEXT NOT NULL CHECK (length(zip) = 5),
  project_type TEXT CHECK (length(project_type) <= 60),
  approx_size TEXT CHECK (length(approx_size) <= 120),
  material TEXT CHECK (length(material) <= 60),
  height TEXT CHECK (length(height) <= 60),
  railing TEXT CHECK (length(railing) <= 120),
  stairs TEXT CHECK (length(stairs) <= 120),
  estimate_low INTEGER,
  estimate_high INTEGER,
  estimate_mid INTEGER,
  notes TEXT CHECK (length(notes) <= 2000),
  answers TEXT,            -- JSON of every estimator answer
  review_flags TEXT,       -- JSON array of manual-review flags
  calculator_version TEXT,
  pricing_version TEXT,
  address TEXT CHECK (length(address) <= 200),
  contact_method TEXT,
  timing TEXT,
  wants_financing INTEGER, -- 1 / 0
  lead_summary TEXT CHECK (length(lead_summary) <= 6000)
);

CREATE INDEX IF NOT EXISTS quote_requests_created_at ON quote_requests (created_at DESC);
