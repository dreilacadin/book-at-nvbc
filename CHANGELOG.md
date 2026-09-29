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
- **Staff:** On phones, the notifications panel (and its ⚙ Settings) was cut off at the left edge
  of the screen. It now opens as a full-width panel with a ✕ to close it.
- **Menu links stay tidy on phones.** The links at the top of the page no longer break onto two
  lines on small screens; if they don't all fit, you can swipe the row sideways.
- **Staff:** Older bookings that were confirmed before payment was required, but never paid, are
  no longer treated as paid when working out In progress / Completed.
- **Internal:** README: the booking-grid colours described there were out of date (confirmed
  bookings are grey, not blue).
