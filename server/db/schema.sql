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

CREATE TABLE IF NOT EXISTS inquiries (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inquiries_listing_id ON inquiries (listing_id);
