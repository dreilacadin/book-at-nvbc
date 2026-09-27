# NVBC Courts — Badminton & Pickleball Reservations

A simple booking site for NV Badminton Center's badminton and pickleball courts.

- **Players** choose a sport (Badminton or Pickleball), pick a date, tap an open
  slot, enter their name and mobile number, and get a booking code (e.g.
  `NV-7K3Q9P`). No account needed.
- **Everyone** can see which slots are booked — but never _who_ booked them.
  Names and numbers are only visible to staff.
- **Players** can view or cancel their own booking with the code on the **My
  booking** page (codes are also remembered on the device they booked from).
- **Staff** log in at `/admin` to see every booking with names/contacts, cancel
  bookings, add walk-in/phone bookings, block courts for tournaments or
  maintenance, and change opening hours, limits and the announcement banner.
- **Court counts on the fly**: in /admin → Courts, set how many badminton and
  pickleball courts are bookable with the − / + buttons. Lowering a number hides
  the last courts in the list; raising it brings hidden courts back first, then
  creates new ones. You can also switch a single court between badminton and
  pickleball (e.g. when a floor is re-lined), rename it, or reorder it. Bookings
  are never deleted — staff get a warning if a hidden or switched court still
  has upcoming bookings.
- Direct links to a sport work: `/?sport=badminton` or `/?sport=pickleball`.
- **Prices & discounts**: each sport has its own hourly rate. Players book as
  **Regular**, **Member** or **Coach**; members and coaches get the discount %
  you set in /admin → Settings. The price (with discount) is shown before they
  confirm.
- **Payments**: players choose **Cash**, **GCash**, **QR Ph** or **BPI
  transfer**. After booking they see the amount and how to pay (your GCash
  number, your QR Ph code, or your BPI account), then enter their payment
  reference number. Staff see it in /admin → Bookings marked **For
  verification**, check it against the GCash/bank app, and switch it to
  **Paid**.

Built with Next.js (App Router) + PostgreSQL. No other services needed.

---

## 1. Create a free Postgres database (Neon)

1. Sign up at <https://neon.tech> (free plan).
2. Create a project. For the region, pick **AWS Asia Pacific (Singapore)** —
   closest to the Philippines.
3. On the project dashboard click **Connect**, turn on **Connection pooling**,
   and copy the connection string. It looks like:
   `postgresql://neondb_owner:xxxx@ep-something-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`

> Supabase (<https://supabase.com>) also works — use its "Transaction pooler"
> connection string.

## 2. Run it on your computer

Requires Node.js 20.9 or newer.

```bash
cp .env.example .env.local      # then edit .env.local:
                                #   DATABASE_URL  = the Neon string from step 1
                                #   ADMIN_PASSWORD = a long password for staff
npm install
npm run db:setup                # creates the tables + 4 badminton and 2 pickleball courts
npm run dev
```

Open <http://localhost:3000>. Staff page: <http://localhost:3000/admin>.

## 3. Put it online for free (Vercel)

1. Push this folder to a GitHub repository (`.env.local` is git-ignored, so your
   password stays private).
2. Go to <https://vercel.com>, **Add New → Project**, and import the repo.
3. Under **Environment Variables** add `DATABASE_URL`, `ADMIN_PASSWORD`, and
   `FACILITY_TIMEZONE=Asia/Manila`.
4. Click **Deploy**. Every time you push to GitHub, Vercel redeploys
   automatically.

You only need to run `npm run db:setup` once (from your computer, pointing at
the same database). Running it again is safe — it never deletes data.

**Upgrading from an earlier version?** Just run `npm run db:setup` again. It
adds the new columns and keeps all your existing courts and bookings. (From the
pickleball-only version, existing courts become pickleball courts — set the
badminton count in /admin → Courts. Existing bookings show ₱0 / Unpaid since
they were made before prices existed.) Then set your prices and payment details
in /admin → Settings.

---

## Troubleshooting the database on Vercel

Open **`https://<your-site>.vercel.app/status`**. It checks each step and tells
you exactly what to fix:

| What /status says                        | Fix                                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No connection string found               | Vercel → Project → **Settings → Environment Variables** → add `DATABASE_URL` with **Production** ticked. Then **Deployments → ⋯ → Redeploy** (new variables only apply to new deployments). |
| Not a valid postgresql:// URL            | Paste only the string itself — no quotes, no `psql`, no `DATABASE_URL=` in front.                                                                                                           |
| Points to localhost                      | That's your computer. Use the Neon/Supabase string.                                                                                                                                         |
| Supabase direct address / host not found | Vercel can't reach `db.xxxx.supabase.co` (IPv6-only). In Supabase → **Connect**, copy the **Transaction pooler** string (`…pooler.supabase.com:6543`).                                      |
| SSL certificate couldn't be verified     | Supabase pooler: change `sslmode=require` to `sslmode=no-verify` at the end of the string.                                                                                                  |
| Username or password rejected            | Copy the string again from the provider (reset the password if needed).                                                                                                                     |
| Tables don't exist / older version       | Run `npm run db:setup` on your computer with `.env.local` pointing at the **same** database as Vercel.                                                                                      |
| Timed out                                | Turn off IP restrictions in Neon (Settings → IP Allow) or Supabase (Network restrictions).                                                                                                  |

The app also accepts `POSTGRES_URL` (what Vercel's Supabase integration
creates), so connecting a database through Vercel's **Storage** tab works too.
Full errors are in Vercel → your project → **Logs**.

## Setting up prices and payments (do this first)

Open /admin → **Settings**:

1. **Prices & discounts** — set the hourly rate per court for badminton and
   pickleball (they start at ₱200 as placeholders), and the member and coach
   discount %.
2. **Member code / Coach code (optional)** — if you fill these in, players must
   type the code to get the member/coach rate. Give the code only to your
   members/coaches and change it if it spreads. If you leave them blank, anyone
   can choose Member/Coach and staff check at the desk (the booking list shows
   who booked at which rate).
3. **Payment methods** — tick the ones you accept and fill in your GCash number,
   BPI account, and upload your QR Ph code (a screenshot from your bank/GCash
   merchant app is fine). A method stays hidden from players until its details
   are filled in.
4. **Payment note (optional)** — e.g. "Please pay within 2 hours of booking."

### How payment verification works

| Status               | Meaning                                                                      |
| -------------------- | ---------------------------------------------------------------------------- |
| **Unpaid**           | Booked, no payment yet (cash players pay at the desk)                        |
| **For verification** | Player entered a GCash / QR Ph / BPI reference number — check it in your app |
| **Paid**             | Staff confirmed it                                                           |
| **No charge**        | Tournament blocks, maintenance, staff use                                    |
| **Refunded**         | Paid booking that was cancelled and refunded                                 |

Staff change the status from the dropdown in each booking row. The top of the
Bookings tab shows billed / collected / unpaid totals for the day and how many
payments are waiting to be verified. If the same reference number is entered on
two bookings it is flagged with ⚠.

Payments are verified by hand — the site does not connect to GCash or BPI. If
you later want automatic confirmation, a gateway like PayMongo or Xendit (which
support GCash and QR Ph) can be added.

Prices are saved on each booking when it's made, so changing your rates never
changes what existing bookings owe.

## Default rules (change them in /admin → Settings)

| Setting                        | Default                                          |
| ------------------------------ | ------------------------------------------------ |
| Opening hours                  | 6:00 AM – 10:00 PM, 1-hour slots                 |
| Max length of one booking      | 2 hours                                          |
| Max hours per player per day   | 3, across both sports (matched by mobile number) |
| How far ahead players can book | 14 days                                          |

Staff bookings made from /admin ignore these limits (useful for tournaments).
All times use Philippine time regardless of where the server runs.

## How privacy works

- The public endpoint `/api/availability` only returns _which court and hour_ is
  taken — no names, numbers, notes or codes.
- A booking's details can only be seen with its code (the person who booked) or
  by logged-in staff.
- Double-booking is prevented by the database itself (a unique key on court +
  date + hour), so two people pressing "Book" at the same moment can't both get
  the slot.
- Spam protection: a hidden "honeypot" field and the per-player daily limit. If
  you get abuse, consider adding Cloudflare Turnstile to the booking form.

## Project layout

```
app/
  page.tsx                 Public booking page
  my-booking/page.tsx      View/cancel by booking code
  admin/page.tsx           Staff dashboard (bookings, courts, settings)
  api/availability         GET  public availability (anonymous)
  api/bookings             POST create booking
  api/bookings/lookup      POST view booking by code
  api/bookings/cancel      POST cancel booking by code
  api/bookings/payment     POST submit a payment reference number
  api/payment-info         GET  public payment instructions (GCash, QR Ph, BPI)
  api/health, status/      Setup diagnostics (database connection, tables, env vars)
  api/admin/*              Staff-only endpoints (cookie login)
components/BookingBoard.tsx  Sport tabs, date strip, court grid and booking dialog
components/PaymentPanel.tsx  "How to pay" box + reference number form
lib/pricing.ts             Rate types, payment methods/statuses, price calculation
lib/bookings.ts            All booking rules and database logic
lib/sports.ts              The list of sports (badminton, pickleball)
lib/db.ts                  Postgres connection + settings
lib/admin-auth.ts          Staff password + signed login cookie
db/schema.sql              Tables (courts with sport, settings, bookings, booking_slots)
```

## Common changes

- **Change how many courts each sport has**: /admin → Courts → − / +.
- **Rename courts / add a named court**: /admin → Courts.
- **Add another sport (e.g. tennis)**: add it to `lib/sports.ts` and to the
  `courts_sport_check` constraint in `db/schema.sql`.
- **Show prices or rules**: /admin → Settings → Announcement.
- **Change colors**: edit the variables at the top of `app/globals.css`.
- **Change the staff password**: update `ADMIN_PASSWORD` (in `.env.local` and in
  Vercel) — this also logs out all staff.
- **Look at the raw data**: Neon's dashboard has a SQL editor, e.g.
  `SELECT * FROM bookings WHERE booking_date = CURRENT_DATE;`
