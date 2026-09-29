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
- **Menu links stay tidy on phones.** The links at the top of the page no longer break onto two
  lines on small screens; if they don't all fit, you can swipe the row sideways.
- **Staff:** Older bookings that were confirmed before payment was required, but never paid, are
  no longer treated as paid when working out In progress / Completed.
- **Internal:** README: the booking-grid colours described there were out of date (confirmed
  bookings are grey, not blue).
