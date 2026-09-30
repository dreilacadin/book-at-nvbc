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

-- v4: fixed member & coach prices -----------------------------------------------
-- Instead of a % discount, members and coaches have their own hourly price per sport.
-- On upgrade, the old discount % is converted into prices so nothing changes until
-- you edit them in /admin → Settings.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS member_rates JSONB;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS coach_rates  JSONB;
UPDATE settings SET member_rates = COALESCE(
  (SELECT jsonb_object_agg(key, round(value::numeric * (100 - member_discount_pct) / 100, 2))
     FROM jsonb_each_text(hourly_rates)), '{}'::jsonb)
 WHERE member_rates IS NULL;
UPDATE settings SET coach_rates = COALESCE(
  (SELECT jsonb_object_agg(key, round(value::numeric * (100 - coach_discount_pct) / 100, 2))
     FROM jsonb_each_text(hourly_rates)), '{}'::jsonb)
 WHERE coach_rates IS NULL;
ALTER TABLE settings ALTER COLUMN member_rates SET DEFAULT '{}'::jsonb;
ALTER TABLE settings ALTER COLUMN member_rates SET NOT NULL;
ALTER TABLE settings ALTER COLUMN coach_rates  SET DEFAULT '{}'::jsonb;
ALTER TABLE settings ALTER COLUMN coach_rates  SET NOT NULL;
-- member_discount_pct / coach_discount_pct are no longer used (kept so older data stays readable).
-- bookings.discount_pct is kept for bookings made before v4; new bookings store 0 there.

-- v5: "pending" bookings ---------------------------------------------------------
-- A booking paid by GCash / QR Ph / BPI stays "pending" (the slot is held) until staff
-- mark the payment Paid; then it becomes "confirmed". Cash bookings are confirmed at once.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
-- ('reserved' is from v15 — listed here too so re-running this file never rejects existing rows.)
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN ('pending', 'reserved', 'confirmed', 'cancelled'));
UPDATE bookings SET status = 'pending'
 WHERE status = 'confirmed' AND payment_method <> 'cash' AND amount > 0
   AND payment_status IN ('unpaid', 'for_verification');

-- v6: weekday/weekend prices and optional member & coach prices ------------------
-- One price plan per sport:
--   {"memberRates": true, "weekendRates": false,
--    "weekday": {"regular": 200, "member": 180, "coach": 160}, "weekend": {...}}
-- memberRates = false → one standard rate for everyone; weekendRates = false → weekends
-- use weekday prices. On upgrade, the v4 prices become the weekday (and weekend) prices.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS rate_plans JSONB;
UPDATE settings SET rate_plans = COALESCE(
  (SELECT jsonb_object_agg(sp, jsonb_build_object(
            'memberRates', true, 'weekendRates', false, 'weekday', r, 'weekend', r))
     FROM (SELECT key AS sp, jsonb_build_object(
                    'regular', value::numeric,
                    'member',  COALESCE((member_rates ->> key)::numeric, value::numeric),
                    'coach',   COALESCE((coach_rates  ->> key)::numeric, value::numeric)) AS r
             FROM jsonb_each_text(hourly_rates)) t), '{}'::jsonb)
 WHERE rate_plans IS NULL;
ALTER TABLE settings ALTER COLUMN rate_plans SET DEFAULT '{}'::jsonb;
ALTER TABLE settings ALTER COLUMN rate_plans SET NOT NULL;
-- hourly_rates / member_rates / coach_rates are no longer read (kept so older data stays readable).

-- v7: payment screenshots ---------------------------------------------------------
-- Players paying by GCash / QR Ph / BPI must give a reference number, a screenshot of
-- the receipt, or both. The screenshot is stored as a data: URL (shrunk by the browser).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_proof TEXT NOT NULL DEFAULT '';

-- v8: reserved times -----------------------------------------------------------------
-- Courts taken out of public booking at set times (Open Play, Queueing, Reserved, …).
-- One-off: weekdays = '{}' and end_date = start_date. Weekly: weekdays lists the days
-- (0 = Sunday … 6 = Saturday) it repeats on, from start_date until end_date (NULL = no end).
CREATE TABLE IF NOT EXISTS court_blocks (
  id          SERIAL PRIMARY KEY,
  label       TEXT  NOT NULL,
  court_ids   INT[] NOT NULL,
  weekdays    INT[] NOT NULL DEFAULT '{}',
  start_date  DATE  NOT NULL,
  end_date    DATE,
  start_hour  INT   NOT NULL CHECK (start_hour BETWEEN 0 AND 23),
  end_hour    INT   NOT NULL CHECK (end_hour BETWEEN 1 AND 24),
  notes       TEXT  NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_hour > start_hour),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

-- v9: half-hour slots ------------------------------------------------------------------
-- Times are hours in half-hour steps (10.5 = 10:30 AM). booking_slots has one row per
-- 30 minutes. Existing bookings get their missing :30 slots so they stay fully protected.
ALTER TABLE bookings      DROP CONSTRAINT IF EXISTS bookings_start_hour_check;
ALTER TABLE bookings      DROP CONSTRAINT IF EXISTS bookings_end_hour_check;
ALTER TABLE booking_slots DROP CONSTRAINT IF EXISTS booking_slots_slot_hour_check;
ALTER TABLE court_blocks  DROP CONSTRAINT IF EXISTS court_blocks_start_hour_check;
ALTER TABLE court_blocks  DROP CONSTRAINT IF EXISTS court_blocks_end_hour_check;

ALTER TABLE bookings      ALTER COLUMN start_hour TYPE NUMERIC(3,1), ALTER COLUMN end_hour TYPE NUMERIC(3,1);
ALTER TABLE booking_slots ALTER COLUMN slot_hour  TYPE NUMERIC(3,1);
ALTER TABLE court_blocks  ALTER COLUMN start_hour TYPE NUMERIC(3,1), ALTER COLUMN end_hour TYPE NUMERIC(3,1);

ALTER TABLE bookings ADD CONSTRAINT bookings_start_hour_check
  CHECK (start_hour BETWEEN 0 AND 23.5 AND start_hour * 2 = trunc(start_hour * 2));
ALTER TABLE bookings ADD CONSTRAINT bookings_end_hour_check
  CHECK (end_hour BETWEEN 0.5 AND 24 AND end_hour * 2 = trunc(end_hour * 2));
ALTER TABLE booking_slots ADD CONSTRAINT booking_slots_slot_hour_check
  CHECK (slot_hour BETWEEN 0 AND 23.5 AND slot_hour * 2 = trunc(slot_hour * 2));
ALTER TABLE court_blocks ADD CONSTRAINT court_blocks_start_hour_check
  CHECK (start_hour BETWEEN 0 AND 23.5 AND start_hour * 2 = trunc(start_hour * 2));
ALTER TABLE court_blocks ADD CONSTRAINT court_blocks_end_hour_check
  CHECK (end_hour BETWEEN 0.5 AND 24 AND end_hour * 2 = trunc(end_hour * 2));

INSERT INTO booking_slots (court_id, slot_date, slot_hour, booking_id)
SELECT b.court_id, b.booking_date, h, b.id
  FROM bookings b, generate_series(b.start_hour, b.end_hour - 0.5, 0.5) AS h
 WHERE b.status <> 'cancelled'
ON CONFLICT DO NOTHING;

-- v10: memberships ---------------------------------------------------------------------
-- Apply online → pay the fee → staff approve → member code + QR, valid for 365 days.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS membership_fee_student NUMERIC(10,2) NOT NULL DEFAULT 500
  CHECK (membership_fee_student >= 0);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS membership_fee_adult NUMERIC(10,2) NOT NULL DEFAULT 600
  CHECK (membership_fee_adult >= 0);

CREATE TABLE IF NOT EXISTS memberships (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token            TEXT NOT NULL UNIQUE,   -- secret part of the applicant's status-page link
  member_code      TEXT UNIQUE,            -- NVBC-XXXX-XXXX, set when approved
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected')),
  member_type      TEXT NOT NULL CHECK (member_type IN ('student', 'adult')),
  full_name        TEXT NOT NULL,
  email            TEXT NOT NULL,
  mobile           TEXT NOT NULL,
  address          TEXT NOT NULL,
  birthdate        DATE NOT NULL,
  gender           TEXT NOT NULL DEFAULT '',
  school           TEXT NOT NULL DEFAULT '',
  student_id       TEXT NOT NULL DEFAULT '',
  sports           TEXT[] NOT NULL DEFAULT '{}',
  emergency_name   TEXT NOT NULL,
  emergency_mobile TEXT NOT NULL,
  fee              NUMERIC(10,2) NOT NULL,
  payment_method   TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'gcash', 'qrph', 'bpi')),
  payment_status   TEXT NOT NULL DEFAULT 'unpaid'
                   CHECK (payment_status IN ('unpaid', 'for_verification', 'paid', 'waived', 'refunded')),
  payment_ref      TEXT NOT NULL DEFAULT '',
  payment_proof    TEXT NOT NULL DEFAULT '',  -- receipt screenshot (image data: URL)
  paid_at          TIMESTAMPTZ,
  member_since     DATE,                      -- first approval
  starts_on        DATE,                      -- current 365-day period
  expires_on       DATE,
  staff_notes      TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS memberships_status_idx ON memberships (status, created_at DESC);
CREATE INDEX IF NOT EXISTS memberships_email_idx ON memberships (lower(email));

-- v11: member-rate bookings are tied to a verified membership -------------------------
-- Players booking at the member rate must enter an active member code; the booking keeps
-- a link to that membership so staff can see whose code was used.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS membership_id UUID REFERENCES memberships(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS bookings_membership_idx ON bookings (membership_id) WHERE membership_id IS NOT NULL;

-- v12: importing existing members --------------------------------------------------------
-- Records brought in from older sign-up sheets may not have a birthdate.
ALTER TABLE memberships ALTER COLUMN birthdate DROP NOT NULL;

-- v13: expired memberships — remind, then renew or forfeit ----------------------------------
-- An expired membership stays in the system (status 'active' with a past expires_on) until the
-- member renews or forfeits. Staff note when they reminded them.
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_status_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_status_check
  CHECK (status IN ('pending', 'active', 'rejected', 'forfeited'));
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS reminded_on  DATE;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS forfeited_on DATE;

-- v14: reminder emails ---------------------------------------------------------------------
-- When staff last emailed an expired member a "please renew" reminder.
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS emailed_on DATE;

-- v15: staff accounts, court notes, "reserved" coach bookings, 15-minute payment window ---------
-- Staff log in to /admin with their own username and password (ADMIN_PASSWORD still works as
-- the "owner" login). token_version changes when a password changes or an account is disabled,
-- which logs out that account's old sessions.
CREATE TABLE IF NOT EXISTS admin_users (
  id             SERIAL PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  display_name   TEXT NOT NULL,
  password_hash  TEXT NOT NULL,           -- scrypt, salted
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  token_version  INT NOT NULL DEFAULT 0,
  created_by     TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ
);

-- A note players see for a court (e.g. "If it rains, this outdoor court may be moved indoors").
ALTER TABLE courts ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';

-- 'reserved' = a coach paying in cash at the desk (still released if unpaid 10 minutes before).
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'reserved', 'confirmed', 'cancelled'));

-- Online bookings must be paid (reference or screenshot sent) by pay_by — 15 minutes after
-- booking — or the slot is released. NULL for staff bookings and coach cash bookings.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pay_by TIMESTAMPTZ;

-- v16: in progress / completed, and restoring released bookings ---------------------------
-- phase: set by staff by hand (NULL = automatic: a paid booking is "in progress" during its
-- time and "completed" after). auto_release = FALSE keeps a booking from being released for
-- non-payment (set when staff restore a released booking). Bookings with a phase are never released.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS phase TEXT;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_phase_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_phase_check CHECK (phase IS NULL OR phase IN ('in_progress', 'completed'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS auto_release BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS restored_by TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ;

-- v17: staff notifications (in the admin panel, and push to phones/computers) ----------------
-- One row per event. kind: booking_new | payment_sent | booking_gone (cancelled by the player or
-- released) | member_applied. push_title uses the booker's first name + last initial only,
-- because push notifications can show on a locked screen.
CREATE TABLE IF NOT EXISTS admin_events (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  push_title    TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  booking_code  TEXT,
  membership_id UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_events_created_idx ON admin_events (created_at);
-- Per staff member ("owner" or an admin_users id): what they've seen, and which kinds they want.
CREATE TABLE IF NOT EXISTS admin_notify_state (
  who           TEXT PRIMARY KEY,
  last_seen_id  BIGINT NOT NULL DEFAULT 0,
  kinds         TEXT[] NOT NULL DEFAULT ARRAY['booking_new', 'payment_sent', 'booking_gone', 'member_applied']
);
-- Devices that turned on push notifications. Removed automatically when they stop accepting pushes.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          SERIAL PRIMARY KEY,
  who         TEXT NOT NULL,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  device      TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- v18: payment checks for staff ----------------------------------------------------------------
-- When the player last sent payment proof (NULL on older bookings: created_at is used instead).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_sent_at TIMESTAMPTZ;
-- For spotting a reference number or screenshot that was also sent for another booking. The
-- reference is compared without spaces/dashes and ignoring case; the screenshot by its MD5.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_ref_key TEXT
  GENERATED ALWAYS AS (upper(regexp_replace(payment_ref, '[^A-Za-z0-9]', '', 'g'))) STORED;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_proof_hash TEXT
  GENERATED ALWAYS AS (CASE WHEN payment_proof = '' THEN '' ELSE md5(payment_proof) END) STORED;
CREATE INDEX IF NOT EXISTS bookings_payment_ref_key_idx ON bookings (payment_ref_key) WHERE payment_ref_key <> '';
CREATE INDEX IF NOT EXISTS bookings_payment_proof_hash_idx ON bookings (payment_proof_hash) WHERE payment_proof_hash <> '';

-- v19: more than one GCash account -----------------------------------------------------------
-- Extra GCash accounts shown to players after the main one (gcash_name / gcash_number):
-- [{"name": "...", "number": "09..."}, ...]
ALTER TABLE settings ADD COLUMN IF NOT EXISTS gcash_more JSONB NOT NULL DEFAULT '[]'::jsonb;

-- v20: rejected payments, and notifications for customers ------------------------------------
-- 'rejected': staff couldn't verify the payment. The booking stays pending with a fresh payment
-- window (pay_by) for the player to send a correct payment or screenshot; rejected_note tells them why.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_payment_status_check
  CHECK (payment_status IN ('unpaid', 'for_verification', 'paid', 'waived', 'refunded', 'rejected'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rejected_note TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rejected_by TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
-- Optional email for booking updates (payment confirmed / rejected, upcoming reminder).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_email TEXT NOT NULL DEFAULT '';
-- When the "your court time is coming up" reminder went out (at most once per booking).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS bookings_reminder_due_idx ON bookings (booking_date)
  WHERE reminder_sent_at IS NULL AND status <> 'cancelled';
-- Customers' devices that asked for push notifications about one booking (from its booking page).
CREATE TABLE IF NOT EXISTS customer_push_subscriptions (
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, endpoint)
);
