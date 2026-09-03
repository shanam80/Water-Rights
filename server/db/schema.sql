-- Marketplace v1: listings + inquiries. No user accounts — a listing is
-- "owned" by whoever holds its edit_token (a random secret shown once at
-- creation, like a private "manage this listing" link), not a login. This
-- keeps v1 simple while still letting a seller edit or remove their own
-- listing without anyone else being able to.

CREATE TABLE IF NOT EXISTS listings (
  id SERIAL PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('CO', 'ID', 'UT')),
  right_identifier TEXT,
  right_type TEXT,
  title TEXT NOT NULL,
  description TEXT,
  county TEXT,
  asking_price_usd NUMERIC,
  price_note TEXT,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  edit_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listings_state_status ON listings (state, status);

-- Verification snapshot against the real state record for a listing's
-- claimed right_identifier — see server/services/marketplace/enrichment.js.
-- A snapshot rather than a live join since the source APIs are outside
-- our control and a listing should still display even if they're down.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS verified_data JSONB;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- The marketplace originally launched with only the first three states
-- built; all seven now have live lookups feeding it. Drop-then-add (rather
-- than a bare ADD) keeps this idempotent across reruns, since Postgres has
-- no ADD CONSTRAINT IF NOT EXISTS.
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_state_check;
ALTER TABLE listings ADD CONSTRAINT listings_state_check
  CHECK (state IN ('CO', 'ID', 'UT', 'MT', 'NV', 'TX', 'WY'));

CREATE TABLE IF NOT EXISTS inquiries (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  message TEXT NOT NULL,
  buyer_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inquiries_listing_id ON inquiries (listing_id);

-- buyer_token was added after the table already existed in production —
-- IF NOT EXISTS makes this safe to rerun against a fresh DB (where the
-- CREATE TABLE above already includes it) or an existing one.
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS buyer_token TEXT;

-- The actual back-and-forth for an inquiry. The buyer's opening message
-- stays on inquiries.message (unchanged, so existing rows don't need
-- backfilling) — this table holds everything after that, from either side.
-- Keeping the conversation here instead of raw email is the whole point:
-- see docs/project-briefing.md §1 and the in-platform-messaging design note
-- — off-platform contact exchange loses the platform any visibility into
-- whether a match happened, which is real lead value for a future paid tier.
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  inquiry_id INTEGER NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('buyer', 'seller')),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_inquiry_id ON messages (inquiry_id);

-- General site contact — not tied to any listing. Someone who just finds
-- the site and has a question. Stored regardless of whether the email
-- notification succeeds, same graceful-degradation pattern as inquiries.
CREATE TABLE IF NOT EXISTS contact_messages (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Interest signups for a possible future paid professional tier (bulk/API
-- data access, saved searches, lead export). Deliberately just an email
-- capture, not a real product yet — the point is to see if demand exists
-- before building accounts/billing. See [[business-model-strategy]].
CREATE TABLE IF NOT EXISTS professional_interest (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT,
  context TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Saved point searches with change alerts — no accounts, just an email tied
-- to one point. A competitor (WaterMap NM) offers this and we didn't; see
-- expansion-roadmap memory. CO/ID/UT only for v1, since those are the
-- states server/services/marketplace/enrichment.js already proved support
-- looking up a right by its own identifier — the same underlying
-- point-search functions get reused here to build known_right_ids, and
-- re-run later by server/scripts/checkSavedSearches.js to diff against it.
-- unsubscribe_token is a single opaque link, same "no login" pattern as a
-- listing's edit_token or an inquiry's buyer_token.
CREATE TABLE IF NOT EXISTS saved_searches (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('CO', 'ID', 'UT')),
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  county TEXT, -- CO only; its search API is county-scoped, not pure lat/lon
  label TEXT,
  known_right_ids JSONB NOT NULL DEFAULT '[]',
  unsubscribe_token TEXT NOT NULL UNIQUE,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_state ON saved_searches (state);

-- Texas GCD restriction summaries — LLM-extracted from each district's own
-- management-plan PDF (the plans are legal documents, some scanned with no
-- text layer, so extraction runs offline via server/scripts/extractGcdRestrictions.js,
-- never live per-request). district_name must match the DistrictName string
-- the live TWDB boundary service returns (services.twdb.texas.gov GCD
-- MapServer), since that's how the /api/texas/gcd route looks a row up.
-- Pilot covers 8 West Texas districts only — most districts will have no row
-- here yet, which the frontend treats as "not extracted yet," not an error.
CREATE TABLE IF NOT EXISTS gcd_restrictions (
  id SERIAL PRIMARY KEY,
  district_name TEXT NOT NULL UNIQUE,
  source_pdf_url TEXT NOT NULL,
  plan_year INTEGER,
  summary TEXT,
  spacing_rules TEXT,
  production_limits TEXT,
  permitting_thresholds TEXT,
  drought_rules TEXT,
  extraction_confidence TEXT CHECK (extraction_confidence IN ('high', 'medium', 'low')),
  extraction_notes TEXT,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Texas oil & gas well log depth/metadata, from the Railroad Commission's
-- monthly log inventory spreadsheets.
--
-- Why this table exists: the RRC's Well Logs map layer (layer 8) carries an
-- API number and a location and nothing else — verified live, its complete
-- field list is API, OBJECTID, SHAPE. So it can tell you a log EXISTS but
-- not how deep it starts, nor who operated the well. That detail is only
-- published in per-month inventory workbooks, which is what this caches.
--
-- Coverage is deliberately partial and that's not a defect to hide: each
-- monthly file lists only logs scanned that month (~334 records), against a
-- 237k-row archive. A well with no row here has an UNKNOWN start depth,
-- which the UI shows as its own category — never merged with "shallow".
--
-- top_log_interval_ft is stored NULL rather than 0 when the RRC leaves it
-- unpopulated: ~20% of rows report 0 on holes thousands of feet deep, so 0
-- means "not recorded", not "starts at the surface".
CREATE TABLE IF NOT EXISTS well_log_inventory (
  api TEXT PRIMARY KEY,
  top_log_interval_ft INTEGER,
  bottom_total_depth_ft INTEGER,
  operator_name TEXT,
  lease_name TEXT,
  field_name TEXT,
  well_number TEXT,
  county_name TEXT,
  log_description TEXT,
  document_date TEXT,
  source_file TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Format and size of the log document itself. Format decides what happens
-- when someone clicks: a scan opens in the agency's viewer, LAS curve data
-- just downloads — so the page says which before the click.
ALTER TABLE well_log_inventory ADD COLUMN IF NOT EXISTS log_format TEXT;
ALTER TABLE well_log_inventory ADD COLUMN IF NOT EXISTS image_size TEXT;
