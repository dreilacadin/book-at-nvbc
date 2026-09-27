-- NVBC Court Reservations (badminton + pickleball) — database schema
-- Safe to run more than once (uses IF NOT EXISTS / ON CONFLICT).

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid() on older Postgres

-- Courts that can be booked. Deactivate a court instead of deleting it.
CREATE TABLE IF NOT EXISTS courts (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row of settings the admin can change from /admin.
CREATE TABLE IF NOT EXISTS settings (
  id                    INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  open_hour             INT NOT NULL DEFAULT 6  CHECK (open_hour BETWEEN 0 AND 23),
  close_hour            INT NOT NULL DEFAULT 22 CHECK (close_hour BETWEEN 1 AND 24),
  max_hours_per_booking INT NOT NULL DEFAULT 2  CHECK (max_hours_per_booking BETWEEN 1 AND 12),
  max_hours_per_day     INT NOT NULL DEFAULT 3  CHECK (max_hours_per_day BETWEEN 1 AND 24),
  booking_window_days   INT NOT NULL DEFAULT 14 CHECK (booking_window_days BETWEEN 0 AND 90),
  announcement          TEXT NOT NULL DEFAULT '',
  CHECK (close_hour > open_hour)
);

-- A reservation. player_name / contact are PRIVATE: never returned by public endpoints.
CREATE TABLE IF NOT EXISTS bookings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  court_id      INT NOT NULL REFERENCES courts(id),
  booking_date  DATE NOT NULL,
  start_hour    INT NOT NULL CHECK (start_hour BETWEEN 0 AND 23),
  end_hour      INT NOT NULL CHECK (end_hour BETWEEN 1 AND 24),
  player_name   TEXT NOT NULL,
  contact       TEXT NOT NULL,
  notes         TEXT NOT NULL DEFAULT '',
  cancel_code   TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  cancelled_by  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at  TIMESTAMPTZ,
  CHECK (end_hour > start_hour)
);

CREATE INDEX IF NOT EXISTS bookings_date_idx ON bookings (booking_date);
CREATE INDEX IF NOT EXISTS bookings_contact_idx ON bookings (contact, booking_date);

-- One row per booked hour. The primary key makes double-booking impossible,
-- even if two people press "Book" at the same instant.
CREATE TABLE IF NOT EXISTS booking_slots (
  court_id    INT  NOT NULL REFERENCES courts(id),
  slot_date   DATE NOT NULL,
  slot_hour   INT  NOT NULL CHECK (slot_hour BETWEEN 0 AND 23),
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  PRIMARY KEY (court_id, slot_date, slot_hour)
);

-- v2: each court belongs to a sport. Courts created before this change become pickleball.
ALTER TABLE courts ADD COLUMN IF NOT EXISTS sport TEXT NOT NULL DEFAULT 'pickleball';
DO $$ BEGIN
  ALTER TABLE courts ADD CONSTRAINT courts_sport_check CHECK (sport IN ('badminton', 'pickleball'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS courts_sport_idx ON courts (sport, is_active);

-- Defaults
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Starting courts for a brand-new database: 4 badminton + 2 pickleball.
-- Change the counts any time from /admin → Courts.
INSERT INTO courts (name, sport, sort_order)
SELECT v.name, v.sport, v.sort_order
FROM (VALUES
  ('Badminton Court 1', 'badminton', 1),
  ('Badminton Court 2', 'badminton', 2),
  ('Badminton Court 3', 'badminton', 3),
  ('Badminton Court 4', 'badminton', 4),
  ('Pickleball Court 1', 'pickleball', 5),
  ('Pickleball Court 2', 'pickleball', 6)
) AS v(name, sport, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM courts);

-- v3: pricing, member/coach discounts and payments -------------------------------

-- Hourly rate per sport (₱), discounts (%) and optional codes players must enter
-- to get the member/coach rate. Leave a code blank to let staff verify at the desk.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS hourly_rates JSONB NOT NULL
  DEFAULT '{"badminton": 200, "pickleball": 200}';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS member_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 10
  CHECK (member_discount_pct BETWEEN 0 AND 100);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS coach_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 20
  CHECK (coach_discount_pct BETWEEN 0 AND 100);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS member_code TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS coach_code  TEXT NOT NULL DEFAULT '';

-- Which payment methods players may choose, and the details shown to them.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS payment_methods TEXT[] NOT NULL
  DEFAULT ARRAY['cash', 'gcash', 'qrph', 'bpi'];
ALTER TABLE settings ADD COLUMN IF NOT EXISTS gcash_name   TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS gcash_number TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS bpi_account_name   TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS bpi_account_number TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS qrph_image TEXT NOT NULL DEFAULT '';   -- data: URL of the QR image
ALTER TABLE settings ADD COLUMN IF NOT EXISTS payment_note TEXT NOT NULL DEFAULT '';

-- Each booking keeps a snapshot of the price it was booked at, so later rate
-- changes never alter what an existing booking owes.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rate_type TEXT NOT NULL DEFAULT 'regular'
  CHECK (rate_type IN ('regular', 'member', 'coach'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS hourly_rate  NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(5,2)  NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS amount       NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash'
  CHECK (payment_method IN ('cash', 'gcash', 'qrph', 'bpi'));
-- unpaid → for_verification (player sent a reference no.) → paid; or waived / refunded by staff
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'
  CHECK (payment_status IN ('unpaid', 'for_verification', 'paid', 'waived', 'refunded'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS bookings_payment_ref_idx ON bookings (payment_ref) WHERE payment_ref <> '';
