# Changelog

All notable changes to NVBC Courts are listed here, newest first. Changes that haven't been
released (committed and deployed) yet are under **Unreleased**; when they go out, that heading
can become the release date (for example `## 2026-09-30`).

This file is also shown to the public at **/changelog** ("Changelog" in the site header), so
write entries in plain language for players. Each change is grouped as **Added**, **Changed**,
**Fixed** or **Removed** (shown on the page as New, Improved, Fixed and Removed), and can start
with a tag:

- no tag — for everyone (players, members, coaches)
- `**Staff:**` — for NVBC staff; shown on the page in a collapsed "For NVBC staff" section
- `**Database:**` — a database change (applied automatically on the next deploy, or with
  `npm run db:setup` locally); not shown on the page
- `**Internal:**` — anything else only developers care about; not shown on the page

Earlier changes (before this file existed) are in the git history.

## [Unreleased]

### Added
- **Part-day closures.** When NVBC is closed for only part of a day, the booking page says so
  (e.g. "Christmas Eve — open 10:00 AM – 5:00 PM only") and just those times are unavailable.
- **Staff:** **Times for closed days.** Holidays and weekly rest days can now be closed **all
  day**, **from a time to a time** (e.g. closed 8:00 AM – 3:00 PM every Monday), or **open only
  from–to** (short hours). Bookings, rescheduling, the waitlist and Reports all follow the times;
  a partly closed holiday keeps holiday (weekend) prices for its open hours, while weekly rest days
  keep normal prices.
- **Database:** Closure times for holidays and weekly rest days.
- **Closed days show on the booking page.** Days NVBC is closed (weekly rest days and holidays)
  are marked "Closed" in the date strip.
- **Staff:** **Split payments.** On a booking's card, **Split payment…** records a payment in parts
  — e.g. ₱350 cash + ₱100 GCash, with a reference for non-cash parts. The parts must add up to
  what's due (a group's total for group bookings). The card, Bookings list and export show the
  split, and Reports count each part under its own payment method.
- **Staff:** **Weekly rest days** in Settings (e.g. closed every Monday): no online bookings on
  those days; you're warned if upcoming bookings already fall on them. To open on a rest day for a
  special occasion, add that date as an open holiday.
- **Staff:** Holidays can **repeat every year** (e.g. Christmas Day). A specific date always wins
  over a yearly holiday, which wins over a weekly rest day.
- **Database:** Split-payment parts on bookings, weekly closed days in settings, and yearly
  holidays.
- **Holiday notices.** The booking page shows when a day is a holiday (holiday prices — the
  weekend rates — apply) or when NVBC is closed.
- **Refund updates.** When NVBC sends your refund for a cancelled booking, you're told by
  notification or email (if you turned on updates), with the amount and reference.
- **Staff:** **Reports** tab (owner and managers): for any period — revenue collected, how full
  the courts were, bookings kept vs made, refunds, money still unpaid, and the share of bookings
  cancelled by customers or staff, released for non-payment, and no-shows. A weekday × hour chart
  of how busy the courts are (with a table view), the busiest and quietest times, usage by day of
  the week, and revenue by sport and by payment method — to help with pricing and staffing.
- **Staff:** **Refund tracking.** A paid booking cancelled by the customer at least 12 hours ahead,
  or cancelled by staff, is marked **Refund due**. On its card, record **Refunded** (with the
  reference — the customer is told) or **No refund** (with a note); you can also mark a refund due
  by hand. Group bookings are refunded together. Shown as "💸 Refund due" in the Bookings list and
  as a "refunds due" tile in the Overview; every step is in the booking's History.
- **Staff:** **No-shows.** Once a booking has started, **Mark no-show** on its card. When the same
  phone number or email books again, staff see "⚠ 2 no-shows and 1 unpaid booking in the last 90
  days" (with dates) on the card and in the list. Players don't see it.
- **Staff:** **Holidays and closures** in Settings: add dates ahead of time, each either open with
  weekend prices or closed (no online bookings; the booking page shows the day as closed).
  Closing a day that already has bookings warns you to contact those players.
- **Database:** Refund status, amount, reference and who recorded it; no-show marks; a normalised
  contact for matching a player's bookings; and the holidays table.
- **Waitlist for taken times.** Tap a booked slot and choose **Notify me if it opens** (on your
  phone and/or by email). If any court for that sport frees up for the whole time — for example a
  booking that wasn't paid in time — everyone waiting hears at once, and the first to book gets it.
- **Change your booking's time yourself.** On My booking, **Change time** lets you move to another
  free court or time of the same sport, length and price, up to 12 hours before the start (once
  per booking — NVBC can change these limits).
- **Add to calendar.** From the booking confirmation and My booking (Google Calendar, or Apple /
  Outlook), and the payment-confirmed and reminder emails now include the booking for your
  calendar, with a reminder 1 hour before.
- **Book several courts at once.** For groups and events: in the booking form, tick more courts
  for the same time — one booking code, one QR and one payment for all of them.
- **More activities.** Courts can now be booked for other activities too, like Zumba, or
  pickleball on a badminton court, when NVBC sets them up — they appear as tabs on Book a court.
- **Staff:** **Activities and shared courts** in Settings: let a sport use other courts, and add
  activities (name, emoji, which courts) with their own prices. A court booked for one activity is
  taken for all others at that time. Bookings show their activity on the card and in the list.
- **Staff:** **Rescheduling rules** in Settings: how many times customers may move a booking
  (or not at all), and up to how many hours before the start. Customer moves show in the 🔔 bell
  ("Bookings rescheduled by customers", on for everyone) and in the booking's History.
- **Staff:** **Group bookings** show "👥 Group of N" on each court's row and a group note on the
  card. Confirming or rejecting the payment on any court applies to the whole group; the customer
  cancelling cancels every court. Staff can still cancel one court on its own.
- **Database:** Activities and shared courts, rescheduling settings and counts, group bookings,
  each booking's activity, and the waitlist.
- **Your payment screenshot fills in the details for you.** After you upload a screenshot of your
  receipt, your phone reads the reference number and amount and fills them in — just check
  they're right before sending. (The screenshot is read on your phone.)
- **Staff:** **Manager and Staff accounts.** Each staff login is now a **Manager** (full access,
  like the owner) or **Staff** (day-to-day work: bookings, payments, members, messages, reserved
  times). Only the owner and managers can change settings, prices and payment accounts, set up
  courts, manage staff accounts, delete bookings or members, import members, send bulk emails and
  see the activity log. Existing accounts start as Staff — use **Make manager** in the Staff tab.
- **Staff:** The payment checklist shows the amount the player says they paid, in red if it
  differs from the booking.
- **Database:** Staff account roles; a table of recent failed attempts (for the limits below);
  the amount players report paying.
- **Internal:** New dependency `tesseract.js` (reads payment screenshots in the browser).
- **Light or dark — your choice.** A new theme button at the top right of every page lets you
  pick **Light**, **Dark** or **Auto** (follow your phone or computer's setting). Your choice is
  remembered on this device.
- **Message NVBC staff about your booking.** On My booking there's now a chat with NVBC staff for
  questions about your booking, payment or anything else. Replies appear there (with a "new
  message" note at the top of your booking), and by notification or email if you turned on
  updates.
- **Staff:** **Chat with customers per booking.** Each booking card has a **Messages** section to
  read and reply (or start a conversation). New customer messages show in the 🔔 bell and as push
  notifications (a new "Messages from customers" type, on for everyone — switch it off in ⚙
  Settings), and as "💬 New message" on the booking's row. Customers get a notification for each
  reply and an email for the first of several quick replies. Messages show "Seen" once read.
- **Database:** New table for booking messages; staff notification settings gain the new
  "Messages from customers" type.
- **Staff:** **Booking history — who did what, and when.** Every booking card has a **History**
  section listing each change with the time and who made it: booked, payment sent, payment
  confirmed or changed (e.g. "For verification → Paid"), rejected (with the note), edited (exactly
  what changed — court, time, name, rate, amount, reference…), progress marked, cancelled, released
  by the system, restored and deleted. Customers' own actions show as "Customer".
- **Staff:** **Activity log.** In the Staff tab, a list of what staff did to bookings, newest first,
  with a filter by staff member. Click a booking code to open it. Deleted bookings stay in the log.
  Bookings made before this show what was already recorded (who cancelled, restored or rejected
  them); earlier payment confirmations show as "Unknown staff".
- **Database:** New booking history table, filled in from existing bookings on the first run.
- **Get updates about your booking.** Turn on notifications (on your phone or computer) or add
  your email — on the booking confirmation or on My booking — and we'll let you know when your
  payment is confirmed, if there's a problem with it, and remind you 1 hour before your time.
  The booking form also has an optional email field. On iPhone/iPad, add NVBC to your Home Screen
  first to get notifications.
- **A second chance if your payment can't be verified.** If staff can't verify the payment you
  sent, your booking stays held: you'll see why, and get 15 more minutes to send a correct payment
  or screenshot.
- **Staff:** **Reject a payment, with a note.** "✕ Reject payment…" on a booking waiting for
  verification, with one-tap reasons (amount doesn't match, not received, and so on) or your own
  note. The customer sees the note on their booking page and gets a notification or email. The
  booking shows "Payment rejected — waiting for the customer", and "Rejected earlier" with the note
  once they send a new payment. The card also shows whether the customer turned on updates.
- **Database:** Payment status "rejected" with its note, who rejected it and when; bookings'
  optional customer email and reminder time; a table of customers' devices with notifications on.
- **Internal:** New optional settings `SITE_URL` (links in customer emails) and `CRON_SECRET`
  (for `/api/cron/reminders`, to send reminders on time when the site is quiet).
- **More GCash numbers to pay to.** When paying by GCash you may now see more than one NVBC GCash
  number — send your payment to any one of them.
- **Staff:** **Extra GCash accounts.** In Settings → Payment methods, "+ Add another GCash number"
  adds up to 4 more GCash numbers and account names (handy when one account reaches its GCash
  limit). Players see them all, and the payment checklist on a booking accepts any of them.
- **Membership covers badminton — pickleball is coming soon.** The membership page and your member
  card page now say that membership (and member rates) currently applies to badminton, and that
  pickleball membership and perks are on the way.
- **Staff:** **Notifications for staff.** A 🔔 bell in the admin panel shows new bookings, payment
  proof sent (needs verifying), bookings cancelled by the player or released, and new membership
  applications — with a pop-up, an optional chime, and the unread count in the browser tab title.
  Click one to open that booking straight away. Each staff member chooses which kinds they get.
- **Staff:** **Push notifications on phones and computers.** Turn them on per device from the
  bell (⚙ Settings → Turn on notifications) to be notified even when the admin panel is closed;
  tapping a notification opens the booking. On iPhone/iPad, add the site to the Home Screen first
  (iOS 16.4 or later). Push notifications show only the booker's first name and last initial,
  since they can appear on a locked screen.
- **Add NVBC to your Home Screen.** On phones, "Add to Home Screen" now gives NVBC Courts its own
  icon and opens it like an app.
- **Database:** New tables for staff notifications, each staff member's notification settings,
  and the devices that turned on push notifications.
- **Database:** Settings can hold extra GCash accounts.
- **Database:** Bookings record when the payment proof was sent, plus a normalised reference number
  and a fingerprint of the screenshot, for spotting reuse.
- **Internal:** New settings `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` for push
  notifications (see .env.example); new dependency `web-push`.
- **A "What's new" page.** See what's new and improved at NVBC Courts — it's the new
  **Changelog** link at the top of every page.
- **See when your booking is under way.** On **My booking**, a paid booking now shows
  **In progress** during your court time and **Completed** afterwards.
- **Staff:** **In progress / Completed for bookings.** Paid bookings show In progress during their
  time and Completed after, automatically. Staff can also mark a booking In progress or Completed
  by hand (for example an unpaid walk-in who's already playing, or a group that finished early)
  and switch it back to Automatic. Exports have a new Progress column.
- **Staff:** **Undo a release.** A booking released for not being paid in time can be restored
  from its card — as upcoming, In progress or Completed. It takes its time slot back (refused,
  naming the other booker, if someone has booked the time since), keeps its payment status,
  records who restored it, and won't be released again.
- **Staff:** **Bookings tab: group by sport and filter.** A Together / By sport switch (remembered
  on each device), and a filter for bookings that need payment, have a payment to verify, or are
  upcoming, in progress or completed.
- **Staff:** New warnings on bookings: "Started — payment not verified" and "Ended — not paid".
- **Database:** New booking columns for the progress mark, for keeping restored bookings from
  being released again, and for who restored a booking and when.

### Changed
- **Payment screenshots aren't kept after they're checked.** Once staff confirm or reject your
  payment (or the booking is cancelled), the screenshot is deleted; the reference number stays.
- **Staff:** Wrong staff passwords are limited: after 5 wrong tries for a username from one place
  (or 20 from one network, or 50 for a username overall), login pauses for 15–60 minutes. Too many
  unknown booking codes from one visitor (30 in 15 minutes) also pause booking lookups, to stop
  code guessing.
- **Staff:** Screenshots already stored for checked or cancelled payments were deleted to save
  space. Reuse of a deleted screenshot is still spotted (its fingerprint is kept).
- **Your booking is easier to read on phones.** The booking confirmation and My booking now show
  the essentials at a glance — status, day and time, court and amount, plus one line on what to do
  next. The QR code, messages with staff, updates and "Good to know" are tidy rows you tap to open
  (messages open by themselves when staff reply). You can now also message NVBC staff right from
  the booking confirmation.
- When you still need to send your payment, **Cancel** now sits right beside the main payment
  button (which is the bigger of the two), instead of on its own further down.
- **Staff:** **Checking online payments is quicker and safer.** A booking waiting for payment
  verification now shows the player's screenshot right on its card, next to a checklist of what it
  should say: the amount, the GCash/BPI account it should have gone to, the date and time, and the
  reference number. Staff tick each one; confirming with boxes unticked asks first.
- **Staff:** **Reused payment proof is spotted automatically.** If the same reference number (even
  typed with different spaces or dashes) or the exact same screenshot was sent for another booking,
  the card lists those bookings with a ⚠ warning, and the Bookings list flags "Screenshot used
  before" or "Reference used before". When it's the same person, it shows the total the one payment
  should cover.
- **Staff:** In the Overview, the **Payments to verify** and **Cancelled & released** tiles are now
  buttons (marked "View →"). Clicking one lists just those bookings for the day, week or month on
  screen, in time order; ‹ › and Today keep the filter, clicking a booking opens it in the Bookings
  tab, and clicking the tile again (or ✕ Show calendar) brings the calendar back.
- **Staff:** In the Overview, clicking a booking in the **Week** view (or in the Day view's schedule)
  now opens that booking straight away in the Bookings tab, scrolled into view — instead of just
  showing the day. Clicking a day's heading in the Week view still opens that day's schedule.
- **Staff:** **Bookings tab redesigned for phones.** The wide table is replaced by compact rows
  (time, name, court, amount, a status pill and any warnings) in time order — no sideways
  scrolling. Tap a row to manage the booking. Cancelled and released bookings are collapsed at
  the bottom, the QR scanner opens from a Scan button, ‹ › buttons move between days, and the
  list refreshes itself every minute.
- **Staff:** **One booking card everywhere.** Scanning a booking QR, tapping a booking in the
  Bookings tab, and clicking a booking on the grid in staff mode all open the same card: confirm
  payment, payment status, progress, edit, cancel, restore and delete.
- **Staff:** Bookings marked In progress or Completed by hand are never released for non-payment.
- **Staff:** Moving a booking to another date or time clears its manual In progress / Completed
  mark.
- **Staff:** Cancelling a booking that's in progress or completed now warns that it has already
  been played.

### Fixed
- **Staff:** Weekly rest days no longer count as holidays for pricing (they'd have used weekend
  prices for any open hours).
- **Staff:** On Android (especially in the installed app), tapping a payment screenshot showed
  "Please log in again" instead of the picture. Screenshots now open full screen right on the page
  (tap or ✕ to close), and links into the admin panel from outside the site keep you logged in.
- **Staff:** On phones, the notifications panel (and its ⚙ Settings) was cut off at the left edge
  of the screen. It now opens as a full-width panel with a ✕ to close it.
- **Menu links stay tidy on phones.** The links at the top of the page no longer break onto two
  lines on small screens; if they don't all fit, you can swipe the row sideways.
- **Staff:** Older bookings that were confirmed before payment was required, but never paid, are
  no longer treated as paid when working out In progress / Completed.
- **Internal:** README: the booking-grid colours described there were out of date (confirmed
  bookings are grey, not blue).
