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

-- v21: booking history (who did what, and when) ----------------------------------------------
-- One row per change to a booking: by a staff member (their name at the time), the customer, or
-- the system (automatic release). Kept when a booking is deleted (booking_id becomes NULL; the
-- code stays). action is a short label ("Payment status", "Cancelled", "Edited", ...), details
-- says what changed.
CREATE TABLE IF NOT EXISTS booking_history (
  id            BIGSERIAL PRIMARY KEY,
  booking_id    UUID REFERENCES bookings(id) ON DELETE SET NULL,
  booking_code  TEXT NOT NULL,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor         TEXT NOT NULL,
  actor_kind    TEXT NOT NULL CHECK (actor_kind IN ('staff', 'customer', 'system')),
  action        TEXT NOT NULL,
  details       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS booking_history_booking_idx ON booking_history (booking_id, at);
CREATE INDEX IF NOT EXISTS booking_history_at_idx ON booking_history (at DESC);
-- Bookings made before the log existed: what the booking itself recorded (once; later bookings
-- always have history, so this finds nothing on the next run).
WITH missing AS (
  SELECT b.* FROM bookings b WHERE NOT EXISTS (SELECT 1 FROM booking_history h WHERE h.booking_id = b.id)
)
INSERT INTO booking_history (booking_id, booking_code, at, actor, actor_kind, action, details)
SELECT id, cancel_code, created_at,
       CASE WHEN contact = '(admin)' THEN 'Unknown staff' ELSE 'Customer' END,
       CASE WHEN contact = '(admin)' THEN 'staff' ELSE 'customer' END,
       'Booked', 'From earlier records'
  FROM missing
UNION ALL
SELECT id, cancel_code, paid_at, 'Unknown staff', 'staff', 'Payment status', 'Marked Paid (from earlier records)'
  FROM missing WHERE paid_at IS NOT NULL
UNION ALL
SELECT id, cancel_code, rejected_at, COALESCE(rejected_by, 'Unknown staff'), 'staff', 'Payment rejected', rejected_note
  FROM missing WHERE rejected_at IS NOT NULL
UNION ALL
SELECT id, cancel_code, cancelled_at,
       CASE cancelled_by WHEN 'system' THEN 'System' WHEN 'player' THEN 'Customer' ELSE cancelled_by END,
       CASE cancelled_by WHEN 'system' THEN 'system' WHEN 'player' THEN 'customer' ELSE 'staff' END,
       CASE WHEN cancelled_by = 'system' THEN 'Released' ELSE 'Cancelled' END,
       CASE WHEN cancelled_by = 'system' THEN 'Not paid in time' ELSE '' END
  FROM missing WHERE status = 'cancelled' AND cancelled_at IS NOT NULL
UNION ALL
SELECT id, cancel_code, restored_at, restored_by, 'staff', 'Restored', 'After an automatic release'
  FROM missing WHERE restored_at IS NOT NULL AND restored_by IS NOT NULL;

-- v22: messages between a customer and staff about one booking -------------------------------
-- read_at: when the other side read it (customer messages: by staff; staff messages: by the customer).
CREATE TABLE IF NOT EXISTS booking_messages (
  id           BIGSERIAL PRIMARY KEY,
  booking_id   UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  sender_kind  TEXT NOT NULL CHECK (sender_kind IN ('customer', 'staff')),
  sender_name  TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS booking_messages_booking_idx ON booking_messages (booking_id, id);
CREATE INDEX IF NOT EXISTS booking_messages_unread_idx ON booking_messages (booking_id, sender_kind) WHERE read_at IS NULL;
-- New staff notification kind "message": switched on once for everyone (kinds_version 2), so
-- staff who later switch it off keep it off.
ALTER TABLE admin_notify_state ADD COLUMN IF NOT EXISTS kinds_version INT NOT NULL DEFAULT 1;
UPDATE admin_notify_state SET kinds = array_append(kinds, 'message')
 WHERE kinds_version < 2 AND NOT ('message' = ANY(kinds));
UPDATE admin_notify_state SET kinds_version = 2 WHERE kinds_version < 2;
ALTER TABLE admin_notify_state ALTER COLUMN kinds_version SET DEFAULT 2;
ALTER TABLE admin_notify_state ALTER COLUMN kinds
  SET DEFAULT ARRAY['booking_new', 'payment_sent', 'booking_gone', 'member_applied', 'message'];

-- v23: login throttling, booking-code rate limits, staff roles, screenshots kept only until checked
-- Recent failed attempts (wrong passwords, unknown booking codes), counted per bucket and key to
-- slow down guessing. Rows older than a day are pruned automatically.
CREATE TABLE IF NOT EXISTS throttle_hits (
  bucket  TEXT NOT NULL,
  key     TEXT NOT NULL,
  at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS throttle_hits_idx ON throttle_hits (bucket, key, at);
-- Staff account roles: 'manager' = full access (like the owner login); 'staff' = day-to-day work
-- (no settings, court setup, staff accounts, deleting bookings/members, imports or bulk emails).
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'staff';
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check CHECK (role IN ('manager', 'staff'));
-- Payment screenshots are kept only until staff confirm or reject the payment (or the booking is
-- cancelled). The fingerprint stays, so reuse of the same screenshot is still spotted: it becomes
-- a plain column, set when a screenshot is sent.
ALTER TABLE bookings ALTER COLUMN payment_proof_hash DROP EXPRESSION IF EXISTS;
ALTER TABLE bookings ALTER COLUMN payment_proof_hash SET DEFAULT '';
UPDATE bookings SET payment_proof_hash = '' WHERE payment_proof_hash IS NULL;
-- The amount the player says they paid (read from their screenshot on their phone, then checked by them).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_amount_reported NUMERIC(10,2);
UPDATE bookings SET payment_proof = ''
 WHERE payment_proof <> '' AND (payment_status IN ('paid', 'waived', 'refunded', 'rejected') OR status = 'cancelled');
UPDATE memberships SET payment_proof = ''
 WHERE payment_proof <> '' AND (payment_status IN ('paid', 'waived', 'refunded') OR status <> 'pending');

-- v24: activities, group bookings, rescheduling, waitlist ------------------------------------
-- Extra activities besides the built-in sports (e.g. Zumba): [{"id": "zumba", "label": "Zumba", "emoji": "💃"}].
-- Their prices live in rate_plans like the sports'. activity_courts lists, per activity (built-in
-- sports too), the other courts it can also be booked on: {"pickleball": [1, 2], "zumba": [1, 2, 3, 4]}.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS activities JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS activity_courts JSONB NOT NULL DEFAULT '{}'::jsonb;
-- What a booking is for (a sport or an activity); before v24 it was always the court's sport.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS activity TEXT;
UPDATE bookings b SET activity = c.sport FROM courts c WHERE c.id = b.court_id AND b.activity IS NULL;
-- Group bookings: several courts under one code. The first booking holds the code customers use;
-- the others point to it with group_id and are paid, released and cancelled together.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES bookings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS bookings_group_idx ON bookings (group_id) WHERE group_id IS NOT NULL;
-- Customers can move their own booking (same sport, length and price) up to reschedule_hours
-- before it starts, at most reschedule_max times (0 = not allowed).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reschedule_count INT NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS reschedule_hours INT NOT NULL DEFAULT 12;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS reschedule_max INT NOT NULL DEFAULT 1;
-- Waitlist: "tell me if this time opens up" for a sport/activity on a date (any court that can
-- be booked for it). Everyone waiting is notified when it opens; whoever books first gets it.
CREATE TABLE IF NOT EXISTS waitlist (
  id           BIGSERIAL PRIMARY KEY,
  activity     TEXT NOT NULL,
  slot_date    DATE NOT NULL,
  start_hour   NUMERIC(4,1) NOT NULL,
  end_hour     NUMERIC(4,1) NOT NULL,
  email        TEXT NOT NULL DEFAULT '',
  endpoint     TEXT,
  p256dh       TEXT,
  auth         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS waitlist_open_idx ON waitlist (slot_date) WHERE notified_at IS NULL;
-- New staff notification kind "booking_moved" (a customer rescheduled): on for everyone once.
UPDATE admin_notify_state SET kinds = array_append(kinds, 'booking_moved')
 WHERE kinds_version < 3 AND NOT ('booking_moved' = ANY(kinds));
UPDATE admin_notify_state SET kinds_version = 3 WHERE kinds_version < 3;
ALTER TABLE admin_notify_state ALTER COLUMN kinds_version SET DEFAULT 3;
ALTER TABLE admin_notify_state ALTER COLUMN kinds
  SET DEFAULT ARRAY['booking_new', 'payment_sent', 'booking_gone', 'member_applied', 'message', 'booking_moved'];

-- v25: refunds, no-shows, holidays ------------------------------------------------------------
-- Refunds: 'due' when a paid booking is cancelled and a refund is owed (by the refund rules, or
-- when staff cancel), then 'refunded' (with the reference and who did it) or 'none' (staff
-- decided no refund, with a note).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_status TEXT;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_refund_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_refund_status_check CHECK (refund_status IS NULL OR refund_status IN ('due', 'refunded', 'none'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_note TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_by TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS bookings_refund_due_idx ON bookings (refund_status) WHERE refund_status = 'due';
-- No-shows: staff mark a booking whose player didn't turn up. With bookings released for not
-- being paid, they're shown to staff when the same contact books again.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS no_show BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS no_show_by TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS no_show_at TIMESTAMPTZ;
-- The contact, normalised (last 10 digits of a phone number, or a lowercased email), to match a player's bookings.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS contact_key TEXT GENERATED ALWAYS AS (
  CASE WHEN contact ~ '@' THEN lower(btrim(contact))
       WHEN length(regexp_replace(contact, '\D', '', 'g')) >= 10 THEN right(regexp_replace(contact, '\D', '', 'g'), 10)
       ELSE '' END) STORED;
CREATE INDEX IF NOT EXISTS bookings_contact_key_idx ON bookings (contact_key, booking_date) WHERE contact_key <> '';
-- Holidays: priced like weekends (each sport's weekend prices), or closed for booking.
CREATE TABLE IF NOT EXISTS holidays (
  holiday_date DATE PRIMARY KEY,
  name         TEXT NOT NULL,
  closed       BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- v26: split payments, recurring closures ----------------------------------------------------
-- A payment staff recorded in parts (e.g. ₱350 cash + ₱100 GCash): [{"method": "cash", "amount": 350,
-- "reference": ""}, ...], on the booking with the code (for a group, covering all its courts).
-- payment_method then holds the biggest part's method.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_splits JSONB;
-- Weekdays closed every week (0 = Sunday … 6 = Saturday), e.g. a weekly rest day.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS closed_weekdays INT[] NOT NULL DEFAULT '{}';
-- Holidays that come back on the same date every year (e.g. Christmas Day).
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS yearly BOOLEAN NOT NULL DEFAULT FALSE;

-- v27: closures for part of a day ------------------------------------------------------------
-- hours_mode: 'all' (closed all day), 'closed' (closed from_hour–to_hour) or 'open' (open only
-- from_hour–to_hour). Only used when the holiday is closed.
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS hours_mode TEXT NOT NULL DEFAULT 'all';
ALTER TABLE holidays DROP CONSTRAINT IF EXISTS holidays_hours_mode_check;
ALTER TABLE holidays ADD CONSTRAINT holidays_hours_mode_check CHECK (hours_mode IN ('all', 'closed', 'open'));
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS from_hour NUMERIC(4,1);
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS to_hour NUMERIC(4,1);
-- The same for weekly rest days, by weekday: {"1": {"mode": "closed", "from": 8, "to": 15}}.
-- A closed weekday without an entry is closed all day.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS weekly_closure_hours JSONB NOT NULL DEFAULT '{}'::jsonb;

-- v28: coaches ---------------------------------------------------------------------------------
-- Coaches apply with the shared sign-up link (settings.coach_signup_key), wait for an owner or
-- manager to approve them, then log in to the Coaches Dashboard. Each has their own coach code:
-- booking with it gives the coach rate, fills in the coach's details and allows cash at the desk
-- (only while the coach is active).
CREATE TABLE IF NOT EXISTS coaches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name        TEXT NOT NULL,
  email            TEXT NOT NULL,
  mobile           TEXT NOT NULL,
  phpa_id          TEXT NOT NULL DEFAULT '',     -- Philippine Pickleball / Badminton association ID
  phpa_photo       TEXT NOT NULL DEFAULT '',     -- photo of the ID card (image data: URL), optional
  photo            TEXT NOT NULL DEFAULT '',     -- profile photo (image data: URL)
  sports           TEXT[] NOT NULL DEFAULT '{}', -- what they coach
  rates            TEXT NOT NULL DEFAULT '',     -- their coaching rates, in their own words
  availability     JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{"day": 1, "from": 8, "to": 12}, ...] (0 = Sunday)
  password_hash    TEXT NOT NULL,
  token_version    INT NOT NULL DEFAULT 0,       -- changes when the password changes: logs out old sessions
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive', 'rejected')),
  coach_code       TEXT UNIQUE,                  -- set when approved, e.g. COACH-7K3Q-9PXM
  remind_bookings  BOOLEAN NOT NULL DEFAULT TRUE, -- remind the coach 1 hour before each of their bookings
  staff_notes      TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at      TIMESTAMPTZ,
  approved_by      TEXT,
  status_by        TEXT,
  last_login_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS coaches_email_idx ON coaches (lower(email));
-- One-time links: password reset (made by staff).
CREATE TABLE IF NOT EXISTS coach_tokens (
  token       TEXT PRIMARY KEY,
  coach_id    UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('reset')),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
-- Coaches' devices with push notifications on.
CREATE TABLE IF NOT EXISTS coach_push_subscriptions (
  coach_id    UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (coach_id, endpoint)
);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS coach_signup_key TEXT NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex');
ALTER TABLE settings ADD COLUMN IF NOT EXISTS shared_coach_code_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- How coaches (coach rate with a coach code) may pay, out of the payment methods switched on.
-- Everyone else pays online. The default (all methods) keeps cash for coaches, as before.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS coach_payment_methods TEXT[] NOT NULL DEFAULT '{cash,gcash,qrph,bpi}';
-- Bookings: made with a coach's own code (coach_id), or a customer asking for a coaching session.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS coach_id UUID REFERENCES coaches(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS coaching_coach_id UUID REFERENCES coaches(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS coaching_status TEXT;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_coaching_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_coaching_status_check
  CHECK (coaching_status IS NULL OR coaching_status IN ('requested', 'accepted', 'declined', 'cancelled'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS coaching_note TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS coaching_responded_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS coach_reminded_at TIMESTAMPTZ; -- the coach's "coming up" reminder
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS coach_remind BOOLEAN;           -- per booking (NULL = the coach's default)
-- Staff found a coach's code used by someone else.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS coach_code_misuse BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS coach_code_shared BOOLEAN NOT NULL DEFAULT FALSE; -- booked with the old shared code
CREATE INDEX IF NOT EXISTS bookings_coach_idx ON bookings (coach_id) WHERE coach_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bookings_coaching_idx ON bookings (coaching_coach_id) WHERE coaching_coach_id IS NOT NULL;
-- New staff notification kind "coach_applied": on for everyone once.
UPDATE admin_notify_state SET kinds = array_append(kinds, 'coach_applied')
 WHERE kinds_version < 4 AND NOT ('coach_applied' = ANY(kinds));
UPDATE admin_notify_state SET kinds_version = 4 WHERE kinds_version < 4;
ALTER TABLE admin_notify_state ALTER COLUMN kinds_version SET DEFAULT 4;
ALTER TABLE admin_notify_state ALTER COLUMN kinds
  SET DEFAULT ARRAY['booking_new', 'payment_sent', 'booking_gone', 'member_applied', 'message', 'booking_moved', 'coach_applied'];

-- v29: more about coaches --------------------------------------------------------------------
-- full_name is the coach's full legal name (for NVBC's records); nickname is what customers and
-- bookings show (e.g. "Coach Marvin"). gender: man | woman | non_binary | self_describe |
-- prefer_not_to_say (gender_self holds the self-description). The profile photo is optional.
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS nickname TEXT NOT NULL DEFAULT '';
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT '';
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS gender_self TEXT NOT NULL DEFAULT '';
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS birthday DATE;
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS credentials TEXT NOT NULL DEFAULT ''; -- credentials and tournament achievements
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '';

-- v30: reserved times coaches can book ------------------------------------------------------
-- A reserved time (Open Play, Training, …) that coaches may still book, at the Coach rate with
-- their own coach code and an online payment (no cash).
ALTER TABLE court_blocks ADD COLUMN IF NOT EXISTS coach_bookable BOOLEAN NOT NULL DEFAULT FALSE;

-- v31: coaches pay after their session --------------------------------------------------------
-- Coaches usually pay at the end of their session. A coach's own-code booking made while the
-- coach may pay later (pay_later on, fewer than 3 no-shows in 60 days since pay_later_since) is
-- never released for non-payment (bookings.pay_after). The coach is reminded to pay when it ends,
-- and staff are told if it's still unpaid 10 minutes later.
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS pay_later BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS pay_later_since TIMESTAMPTZ NOT NULL DEFAULT now(); -- no-shows count from here
-- Added once, together with a one-time backfill: coaches' own-code bookings already made (unpaid,
-- from today on, not on a reserved time coaches can book — those are paid first) get the new rule
-- too, and lose their online payment window.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = current_schema() AND table_name = 'bookings' AND column_name = 'pay_after') THEN
    ALTER TABLE bookings ADD COLUMN pay_after BOOLEAN NOT NULL DEFAULT FALSE;
    UPDATE bookings b SET pay_after = TRUE, pay_by = NULL
      FROM coaches co
     WHERE co.id = b.coach_id AND co.pay_later AND NOT b.coach_code_shared
       AND b.status IN ('pending', 'reserved') AND b.payment_status IN ('unpaid', 'rejected') AND b.amount > 0
       AND b.booking_date >= (now() AT TIME ZONE 'Asia/Manila')::date
       AND NOT EXISTS (
         SELECT 1 FROM court_blocks cb
          WHERE cb.coach_bookable AND b.court_id = ANY(cb.court_ids)
            AND b.booking_date >= cb.start_date AND (cb.end_date IS NULL OR b.booking_date <= cb.end_date)
            AND (cardinality(cb.weekdays) = 0 OR EXTRACT(DOW FROM b.booking_date)::int = ANY(cb.weekdays))
            AND cb.start_hour < b.end_hour AND b.start_hour < cb.end_hour);
  END IF;
END $$;
-- Coaches' own bookings: who the session is with (optional; their Clients tab groups by it).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS client_name TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS coach_confirmed_at TIMESTAMPTZ; -- "Yes, keep it" (the 1-hour reminder)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS coach_arrived_at TIMESTAMPTZ;   -- "I'm here"
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pay_reminded_at TIMESTAMPTZ;    -- "please pay" at the end of the session
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pay_overdue_at TIMESTAMPTZ;     -- staff told it's still unpaid
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS coach_paid_desk_at TIMESTAMPTZ; -- the coach says they paid cash at the desk (staff confirm)
-- New staff notification kind "coach_session": on for everyone once.
UPDATE admin_notify_state SET kinds = array_append(kinds, 'coach_session')
 WHERE kinds_version < 5 AND NOT ('coach_session' = ANY(kinds));
UPDATE admin_notify_state SET kinds_version = 5 WHERE kinds_version < 5;
ALTER TABLE admin_notify_state ALTER COLUMN kinds_version SET DEFAULT 5;
ALTER TABLE admin_notify_state ALTER COLUMN kinds
  SET DEFAULT ARRAY['booking_new', 'payment_sent', 'booking_gone', 'member_applied', 'message', 'booking_moved', 'coach_applied', 'coach_session'];

-- v32: prices per shared court ---------------------------------------------------------------
-- A court shared with a sport or activity (Settings → Activities and shared courts) can have its
-- own prices for it: {"pickleball": {"7": {"weekendRates": true, "weekday": {...}, "weekend": {...}}}}.
-- Courts not listed use the activity's prices in rate_plans; its Member/Coach switches apply to both.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS court_rates JSONB NOT NULL DEFAULT '{}'::jsonb;

-- v33: staff payment reminders -----------------------------------------------------------------
-- Staff can push a "please pay" reminder for an unpaid booking (also coaches' own bookings): when
-- the last one was sent and by whom (on the group's first booking).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pay_nudged_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pay_nudged_by TEXT;

-- v34: more time to pay ------------------------------------------------------------------------
-- "Need more time?": a player paying online can add 15 minutes to their payment window (pay_by),
-- once per booking. When they did (on every court of a group).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pay_extended_at TIMESTAMPTZ;

-- v35: vouchers ----------------------------------------------------------------------------------
-- Vouchers staff create and print (Admin → Vouchers): free court hours, a fixed or percentage
-- discount on court fees, or a cash voucher. Anyone with the code (VCH-XXXX-XXXX) can use it, online
-- or at the desk. Free hours and cash keep a balance; fixed and percentage discounts count uses.
CREATE TABLE IF NOT EXISTS vouchers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL CHECK (kind IN ('free_hours', 'fixed', 'percent', 'cash')),
  value         NUMERIC(10,2) NOT NULL CHECK (value > 0),  -- hours, pesos or percent
  max_discount  NUMERIC(10,2) CHECK (max_discount > 0),     -- percent: at most this many pesos off per use
  balance       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (balance >= 0), -- free_hours: hours left; cash: pesos left
  max_uses      INT NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  uses          INT NOT NULL DEFAULT 0 CHECK (uses >= 0),   -- bookings it's on now
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'void')),
  valid_from    DATE,                                       -- bookings from this day
  expires_on    DATE,                                       -- bookings up to this day (NULL: no expiry)
  sports        TEXT[] NOT NULL DEFAULT '{}',               -- empty: any sport or activity
  title         TEXT NOT NULL DEFAULT '',
  issued_to     TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',                   -- staff only
  terms         TEXT NOT NULL DEFAULT '',                   -- with {placeholders}, see lib/voucher.ts
  batch         TEXT NOT NULL DEFAULT '',                   -- vouchers created together share this
  created_by    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vouchers_created_idx ON vouchers (created_at DESC);

-- What a voucher took off each court of a booking. Courts booked together share an `application`.
-- restored_at: the value went back on the voucher (the booking was cancelled, or staff removed it:
-- removed). dropped: a restored booking couldn't take the voucher again, so that court pays full price.
CREATE TABLE IF NOT EXISTS voucher_uses (
  id            BIGSERIAL PRIMARY KEY,
  voucher_id    UUID NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  application   UUID NOT NULL,
  booking_id    UUID REFERENCES bookings(id) ON DELETE SET NULL,
  booking_code  TEXT NOT NULL DEFAULT '',
  amount        NUMERIC(10,2) NOT NULL DEFAULT 0,  -- pesos off this court
  hours         NUMERIC(6,2) NOT NULL DEFAULT 0,   -- free hours used on it
  used_by       TEXT NOT NULL DEFAULT '',
  used_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  restored_at   TIMESTAMPTZ,
  removed       BOOLEAN NOT NULL DEFAULT FALSE,
  dropped       BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS voucher_uses_voucher_idx ON voucher_uses (voucher_id, used_at);
CREATE INDEX IF NOT EXISTS voucher_uses_booking_idx ON voucher_uses (booking_id);

-- Who changed what on a voucher (created, status, expiry, balance, terms, …).
CREATE TABLE IF NOT EXISTS voucher_events (
  id            BIGSERIAL PRIMARY KEY,
  voucher_id    UUID NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor         TEXT NOT NULL,
  action        TEXT NOT NULL,
  details       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS voucher_events_voucher_idx ON voucher_events (voucher_id, at);

-- A booking's voucher, and what it took off this court (amount is the price after it).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS voucher_id UUID REFERENCES vouchers(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS voucher_discount NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Every way a booking is cancelled (customer, staff, a coach's "Can't make it", released for not
-- paying) gives the voucher its value back, unless the voucher is void or expired. A use is given
-- back once no court booked with it is still on. When staff restore a cancelled booking, it takes
-- the voucher again if the voucher can still cover it; otherwise that court pays the full price.
CREATE OR REPLACE FUNCTION bookings_voucher_on_status() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  u voucher_uses%ROWTYPE;
  v vouchers%ROWTYPE;
  today DATE := (now() AT TIME ZONE 'Asia/Manila')::date;
  others BOOLEAN;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    FOR u IN SELECT * FROM voucher_uses WHERE booking_id = NEW.id AND restored_at IS NULL AND NOT dropped LOOP
      SELECT * INTO v FROM vouchers WHERE id = u.voucher_id FOR UPDATE;
      CONTINUE WHEN v.status = 'void' OR (v.expires_on IS NOT NULL AND v.expires_on < today);
      SELECT EXISTS (SELECT 1 FROM voucher_uses o JOIN bookings ob ON ob.id = o.booking_id
                      WHERE o.application = u.application AND o.id <> u.id AND o.restored_at IS NULL AND NOT o.dropped
                        AND ob.status <> 'cancelled') INTO others;
      UPDATE vouchers
         SET balance = balance + CASE kind WHEN 'free_hours' THEN u.hours WHEN 'cash' THEN u.amount ELSE 0 END,
             uses = GREATEST(0, uses - CASE WHEN others THEN 0 ELSE 1 END), updated_at = now()
       WHERE id = v.id;
      UPDATE voucher_uses SET restored_at = now() WHERE id = u.id;
    END LOOP;
  ELSIF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    FOR u IN SELECT * FROM voucher_uses WHERE booking_id = NEW.id AND restored_at IS NOT NULL AND NOT removed AND NOT dropped LOOP
      SELECT * INTO v FROM vouchers WHERE id = u.voucher_id FOR UPDATE;
      SELECT EXISTS (SELECT 1 FROM voucher_uses o JOIN bookings ob ON ob.id = o.booking_id
                      WHERE o.application = u.application AND o.id <> u.id AND o.restored_at IS NULL AND NOT o.dropped
                        AND ob.status <> 'cancelled') INTO others;
      IF v.status = 'active' AND (v.expires_on IS NULL OR v.expires_on >= today)
         AND (CASE v.kind WHEN 'free_hours' THEN v.balance >= u.hours WHEN 'cash' THEN v.balance >= u.amount ELSE TRUE END)
         AND (v.kind IN ('free_hours', 'cash') OR others OR v.uses < v.max_uses) THEN
        UPDATE vouchers
           SET balance = balance - CASE kind WHEN 'free_hours' THEN u.hours WHEN 'cash' THEN u.amount ELSE 0 END,
               uses = uses + CASE WHEN others THEN 0 ELSE 1 END, updated_at = now()
         WHERE id = v.id;
        UPDATE voucher_uses SET restored_at = NULL WHERE id = u.id;
      ELSE
        NEW.amount := NEW.amount + u.amount;
        NEW.voucher_discount := GREATEST(0, NEW.voucher_discount - u.amount);
        UPDATE voucher_uses SET dropped = TRUE WHERE id = u.id;
      END IF;
    END LOOP;
    IF NEW.voucher_discount <= 0 THEN NEW.voucher_id := NULL; END IF;
    -- Charged more now: not confirmed until it's paid.
    IF NEW.amount > OLD.amount AND NEW.status = 'confirmed' AND NEW.payment_status NOT IN ('paid', 'waived') THEN
      NEW.status := CASE WHEN NEW.payment_method = 'cash' THEN 'reserved' ELSE 'pending' END;
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS bookings_voucher_on_status ON bookings;
CREATE TRIGGER bookings_voucher_on_status BEFORE UPDATE OF status ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings_voucher_on_status();

-- v36: payment checks staff ticked ---------------------------------------------------------------
-- The checks staff ticked on a payment waiting to be verified (on a group's first booking), so the
-- day list can show "✓ ready to confirm" and other staff see them. `pay_checks_sig` is the payment
-- they were ticked for (amount, method, reference, screenshot, when it was sent): when it changes
-- (the customer sends it again, or the amount changes), the ticks no longer count.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pay_checks TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pay_checks_sig TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pay_checks_by TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pay_checks_at TIMESTAMPTZ;

-- v37: NVBC Scholar applications --------------------------------------------------------------------
-- Applications to be an NVBC Scholar (often from minors): readable by the owner and managers only.
-- `token` is the secret part of the guardian's consent link. Under-18s need a guardian's consent:
-- consent_at stays NULL until it's signed. Delete applications once they're no longer needed.
CREATE TABLE IF NOT EXISTS scholar_applications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token                 TEXT NOT NULL UNIQUE,
  status                TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'selected', 'not_selected')),
  full_name             TEXT NOT NULL,
  birthdate             DATE NOT NULL,
  mobile                TEXT NOT NULL,
  facebook_name         TEXT NOT NULL,
  address               TEXT NOT NULL,
  school                TEXT NOT NULL,
  year_level            TEXT NOT NULL,
  sport                 TEXT NOT NULL CHECK (sport IN ('badminton', 'pickleball')),
  batch                 TEXT NOT NULL,
  years_playing         TEXT NOT NULL,
  experience            TEXT NOT NULL DEFAULT '',
  availability          TEXT[] NOT NULL DEFAULT '{}',
  why_fit               TEXT NOT NULL,
  initiative            TEXT NOT NULL,
  emergency_name        TEXT NOT NULL,
  emergency_mobile      TEXT NOT NULL,
  medical               TEXT NOT NULL,
  consent_required      BOOLEAN NOT NULL,
  photo_consent         TEXT NOT NULL DEFAULT '' CHECK (photo_consent IN ('', 'yes', 'no')),
  guardian_name         TEXT NOT NULL DEFAULT '',
  guardian_relationship TEXT NOT NULL DEFAULT '',
  guardian_mobile       TEXT NOT NULL DEFAULT '',
  guardian_notes        TEXT NOT NULL DEFAULT '',
  consent_signature     TEXT NOT NULL DEFAULT '', -- the guardian's typed name
  consent_at            TIMESTAMPTZ,
  staff_notes           TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS scholar_applications_person_idx
  ON scholar_applications (regexp_replace(lower(trim(full_name)), '\s+', ' ', 'g'), birthdate);
