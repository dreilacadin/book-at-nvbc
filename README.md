# NVBC Courts — Badminton & Pickleball Reservations

A simple booking site for NV Badminton Center's badminton and pickleball courts.

- **Players** choose a sport (Badminton or Pickleball), pick a date, tap an open slot, enter their name and mobile number, and get a booking code (e.g. `NV-7K3Q9P`). No account needed.
- **Half-hour slots**: bookings start on the hour or half hour and can be 30 minutes, 1 hour, 1½ hours, … (priced as the hourly rate × hours). The schedule shows who booked each slot as first name and last initial ("Ana C."), blue when booked and amber while an online payment is pending.
- **Everyone** can see which slots are booked — but never *who* booked them. Names and numbers are only visible to staff.
- **Players** can view or cancel their own booking with the code on the **My booking** page (codes are also remembered on the device they booked from).
- **Staff** log in at `/admin` to see an overview of bookings by day, week or month, every booking with names/contacts, edit bookings (move court/date/time, fix names, change the rate or payment method), cancel bookings, add walk-in/phone bookings, block courts for tournaments or maintenance, and change opening hours, limits and the announcement banner.
- **Court counts on the fly**: in /admin → Courts, set how many badminton and pickleball courts are bookable with the − / + buttons. Lowering a number hides the last courts in the list; raising it brings hidden courts back first, then creates new ones. You can also switch a single court between badminton and pickleball (e.g. when a floor is re-lined), rename it, or reorder it. Bookings are never deleted — staff get a warning if a hidden or switched court still has upcoming bookings.
- **Reserved times**: in /admin → Courts → Reserved times, take courts out of online booking for Open Play, Queueing, training, etc. — on one date or every week (e.g. every Tue & Thu, 6–9 PM). Players see those slots marked with the name; staff can still book them.
- **Reports**: in /admin → Overview, download the day, week or month shown as an Excel workbook (a Summary sheet plus every booking) or a CSV. Both open in Excel, Numbers and Google Sheets.
- Cancelled bookings can be permanently deleted from /admin → Bookings.
- **Membership**: people apply at `/membership` (Student or Adult, with the yearly fees set in /admin → Settings), then land on their private status page to pay (cash at the desk, or GCash / QR Ph / BPI with a reference number or screenshot). In /admin → **Members**, staff mark the fee Paid and **Approve**; the member's page then welcomes them and shows their personal QR code, member code, member-since date and expiry date (365 days). Staff check a member by scanning the QR into the lookup box (USB/Bluetooth QR scanners work like a keyboard) or with the device camera, and can **Renew** for another 365 days.
- **Member rate needs a member code**: booking at the Member rate asks for the player's own code (`NVBC-XXXX-XXXX`, under their QR). It only goes through if that membership is approved and still valid on the booking date; it's filled in automatically on the phone that holds the membership. Staff see whose code was used in /admin → Bookings and in exports.
- **Import existing members**: in /admin → Members → **Import existing members**, choose the CSV of your Google Forms responses (in Sheets: File → Download → CSV) or paste the cells. Columns are matched from your headers (you can change them), dates are read as M/D/Y or D/M/Y, and a check shows who will be imported, and rows with problems. Rows sharing two or more of name, contact number and birthday with a member (or an earlier row) are shown as possible duplicates, and you choose **Skip** or **Import anyway** for each before importing — a shared email alone is fine. Imported people become approved members with new member codes, valid 365 days from their start date (e.g. the form's Timestamp) unless you match an expiry column. Afterwards, download the list of member codes and private links to send each member their QR card.
- **Expired memberships are kept** (imported or approved ones whose 365 days have passed) until the member decides. Members → the **Expired** tile lists them, not-yet-reminded first. When an expired member books a court (matched by mobile number), their booking in /admin → Bookings is flagged "membership expired — remind: renew or forfeit", and scanning their QR shows the same reminder. Sending a reminder email marks them reminded automatically; on the Expired list you can also tick members (quick picks: **Emailed, not marked yet** / **All not reminded**) and mark them all at once. Staff can **Mark reminded**, **Renew** (same code, 365 days from today) or **Forfeit** (their code stops working; the front desk can **Reactivate** it later).
- **Edit or delete members**: open a member in /admin → Members (or scan their QR) → **✎ Edit details** to fix their name, email, mobile, address, birthday, type, emergency contact, notes, or membership dates (the member code and their private link stay the same). **Delete member** removes them permanently after you type DELETE; their past bookings are kept. For someone who just isn't renewing, use **Forfeit** instead.
- **Reminder emails**: Members → **✉ Email expired members** sends each expired member their own email (editable message with their name, expiry date, fee and member-card link), with a preview and a **Send a test to me** button. Anyone emailed in the last 14 days, without an email, or with a likely-mistyped address ("gmail.con") starts unticked; each member then shows "Emailed Sep 28". Setup: in the Gmail account, turn on 2-Step Verification, create an **App password**, and set `GMAIL_USER` and `GMAIL_APP_PASSWORD` (in `.env.local`, and in Vercel → Environment Variables). Gmail allows about 500 emails a day.
- **Apply once**: a person can hold one membership. Opening /membership on a phone that already applied goes straight to their member page, and the server refuses a second application from anyone who was ever approved (matched by full name + birthdate — a shared family email is fine). Expired memberships are renewed at the front desk; declined applicants may apply again.
- **Pending until paid**: every booking starts **Pending** (yellow on the schedule) and becomes **Confirmed** only when staff mark the payment Paid — cash included. After booking, players get a **QR code** of their booking code (also on My booking); staff scan or type it in /admin → Bookings to see the booking and press **Payment received — confirm**.
- **Unpaid bookings are released** automatically 10 minutes before their start time so someone else can book the court. Bookings whose GCash / QR Ph / bank payment was already sent (waiting for staff to verify) are kept. Cash bookings can't be made for a slot starting in less than 10 minutes.
- **Refund policy** (shown when booking and when cancelling): payments by GCash, QR Ph or bank transfer are refundable if the booking is cancelled at least 12 hours before the start time; later cancellations are non-refundable.
- Direct links to a sport work: `/?sport=badminton` or `/?sport=pickleball`.
- **Prices**: each sport has its own **Regular** (non-member), **Member** and **Coach** price per court per hour, set in /admin → Settings — optionally with different weekend (Sat–Sun) prices. A sport can also turn member & coach prices off and use one standard rate for everyone. Players pick which one they're booking as and see the total (and how much they save vs. regular) before they confirm.
- **Payments**: players choose **Cash**, **GCash**, **QR Ph** or **BPI transfer**. Before booking they see the amount and how to pay (your GCash number, your QR Ph code, or your BPI account); the booking only goes through once they enter the payment reference number, upload a screenshot of the receipt, or both. Staff see it in /admin → Bookings marked **For verification** (with a 📷 Screenshot link), check it against the GCash/bank app, and switch it to **Paid**.

Built with Next.js (App Router) + PostgreSQL. No other services needed.

---

## 1. Create a free Postgres database (Neon)

1. Sign up at <https://neon.tech> (free plan).
2. Create a project. For the region, pick **AWS Asia Pacific (Singapore)** — closest to the Philippines.
3. On the project dashboard click **Connect**, turn on **Connection pooling**, and copy the connection string. It looks like:
   `postgresql://neondb_owner:xxxx@ep-something-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`

> Supabase (<https://supabase.com>) also works — use its "Transaction pooler" connection string.

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

1. Push this folder to a GitHub repository (`.env.local` is git-ignored, so your password stays private).
2. Go to <https://vercel.com>, **Add New → Project**, and import the repo.
3. Under **Environment Variables** add `DATABASE_URL`, `ADMIN_PASSWORD`, and `FACILITY_TIMEZONE=Asia/Manila`.
4. Click **Deploy**. Every time you push to GitHub, Vercel redeploys automatically.

**The database updates itself on every deploy.** Vercel runs the `vercel-build` script, which builds the app and then applies `db/schema.sql` to the database in `DATABASE_URL` (creating tables the first time, adding new columns after an update). If the database step fails, the deployment fails and the previous version stays live — check the build log. Make sure `DATABASE_URL` is available to the environment you deploy (Production, and Preview if you use it). On other hosts, use `npm run vercel-build` as the build command.

You can still run `npm run db:setup` by hand (from your computer, pointing at the same database). Running it again is safe — it never deletes data.

**Upgrading from an earlier version?** Deploy, or run `npm run db:setup` again. It adds the new columns and keeps all your existing courts and bookings. (From the pickleball-only version, existing courts become pickleball courts — set the badminton count in /admin → Courts. Existing bookings show ₱0 / Unpaid since they were made before prices existed.) Then set your prices and payment details in /admin → Settings.

---

## Troubleshooting the database on Vercel

Open **`https://<your-site>.vercel.app/status`**. It checks each step and tells you exactly what to fix:

| What /status says | Fix |
|---|---|
| No connection string found | Vercel → Project → **Settings → Environment Variables** → add `DATABASE_URL` with **Production** ticked. Then **Deployments → ⋯ → Redeploy** (new variables only apply to new deployments). |
| Not a valid postgresql:// URL | Paste only the string itself — no quotes, no `psql`, no `DATABASE_URL=` in front. |
| Points to localhost | That's your computer. Use the Neon/Supabase string. |
| Supabase direct address / host not found | Vercel can't reach `db.xxxx.supabase.co` (IPv6-only). In Supabase → **Connect**, copy the **Transaction pooler** string (`…pooler.supabase.com:6543`). |
| SSL certificate couldn't be verified | Supabase pooler: change `sslmode=require` to `sslmode=no-verify` at the end of the string. |
| Username or password rejected | Copy the string again from the provider (reset the password if needed). |
| Tables don't exist / older version | **Neon:** open the Neon console → **SQL Editor**, pick the branch your Vercel `DATABASE_URL` uses (usually `main`), paste all of `db/schema.sql`, click **Run**. Or run `npm run db:setup` with `.env.local` pointing at the **same** database as Vercel. |
| Timed out | Turn off IP restrictions in Neon (Settings → IP Allow) or Supabase (Network restrictions). |

The app also accepts `POSTGRES_URL` and prefixed names like `STORAGE_DATABASE_URL`, so connecting Neon through Vercel's **Storage** tab (Neon integration) works too. Note that the Neon integration gives **Preview** deployments their own database branch — set up the tables on the branch Production uses (`main`), and test bookings on the production URL. Full errors are in Vercel → your project → **Logs**.

## Setting up prices and payments (do this first)

Open /admin → **Settings**:

1. **Prices** — set the Non-member, Member and Coach price per court per hour for badminton and pickleball (they start as placeholders). Tick **Separate weekend prices** to charge different prices on Saturdays and Sundays, or untick **Member & coach prices** to use one standard rate for that sport.
2. **Member code / Coach code (optional)** — if you fill these in, players must type the code to get the member/coach price. Give the code only to your members/coaches and change it if it spreads. If you leave them blank, anyone can choose Member/Coach and staff check at the desk (the booking list shows who booked at which rate).
3. **Payment methods** — tick the ones you accept and fill in your GCash number, BPI account, and upload your QR Ph code (a screenshot from your bank/GCash merchant app is fine). A method stays hidden from players until its details are filled in.
4. **Payment note (optional)** — e.g. "Please pay within 2 hours of booking."

### How payment verification works

**Booking status:** Cash bookings are **Confirmed** immediately. Bookings paid by GCash, QR Ph or BPI transfer are **Pending** — the slot is held so nobody else can take it — until staff set the payment to **Paid** (or **No charge**), which makes the booking **Confirmed**. Setting the payment back to Unpaid/For verification returns it to Pending. Staff can cancel pending bookings that never get paid.

| Status | Meaning |
|---|---|
| **Unpaid** | Booked, no payment yet (cash players pay at the desk) |
| **For verification** | Player entered a GCash / QR Ph / BPI reference number — check it in your app |
| **Paid** | Staff confirmed it |
| **No charge** | Tournament blocks, maintenance, staff use |
| **Refunded** | Paid booking that was cancelled and refunded |

Staff change the status from the dropdown in each booking row. The top of the Bookings tab shows billed / collected / unpaid totals for the day and how many payments are waiting to be verified. If the same reference number is entered on two bookings it is flagged with ⚠.

Payments are verified by hand — the site does not connect to GCash or BPI. If you later want automatic confirmation, a gateway like PayMongo or Xendit (which support GCash and QR Ph) can be added.

Prices are saved on each booking when it's made, so changing your rates never changes what existing bookings owe.

## Default rules (change them in /admin → Settings)

| Setting | Default |
|---|---|
| Opening hours | 6:00 AM – 10:00 PM, 1-hour slots |
| Max length of one booking | 2 hours |
| Max hours per player per day | 3, across both sports (matched by mobile number) |
| How far ahead players can book | 14 days |

Staff bookings made from /admin ignore these limits (useful for tournaments). All times use Philippine time regardless of where the server runs.

## How privacy works

- The public endpoint `/api/availability` only returns *which court and hour* is taken — no names, numbers, notes or codes.
- A booking's details can only be seen with its code (the person who booked) or by logged-in staff.
- Double-booking is prevented by the database itself (a unique key on court + date + hour), so two people pressing "Book" at the same moment can't both get the slot.
- Spam protection: a hidden "honeypot" field and the per-player daily limit. If you get abuse, consider adding Cloudflare Turnstile to the booking form.

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
- **Add another sport (e.g. tennis)**: add it to `lib/sports.ts` and to the `courts_sport_check` constraint in `db/schema.sql`.
- **Show prices or rules**: /admin → Settings → Announcement.
- **Change colors**: edit the variables at the top of `app/globals.css`.
- **Change the staff password**: update `ADMIN_PASSWORD` (in `.env.local` and in Vercel) — this also logs out all staff.
- **Look at the raw data**: Neon's dashboard has a SQL editor, e.g.
  `SELECT * FROM bookings WHERE booking_date = CURRENT_DATE;`
