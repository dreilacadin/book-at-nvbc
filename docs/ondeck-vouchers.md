# NVBC On Deck ↔ NVBC Courts: voucher API

NVBC Courts (courts.nvbc.app) is the single source of truth for every NVBC voucher. Staff create
**Free On Deck session** vouchers there. Each one is for a free **Pickleball Open Play** or
**Badminton Queueing** session and is worth one or more sessions. NVBC On Deck (ondeck.nvbc.app)
doesn't store vouchers. It asks NVBC Courts whether a voucher can be used, then tells NVBC Courts
when it uses one.

## Connection

- **Endpoint:** `POST https://courts.nvbc.app/api/ondeck/vouchers`
- **Headers:** `Authorization: Bearer <ONDECK_API_KEY>` and `Content-Type: application/json`
- **The key:** both apps share one long random secret, at least 24 characters
  (`openssl rand -base64 32`).
  - NVBC Courts reads it from `ONDECK_API_KEY`.
  - On Deck keeps the same value in its own server-side environment variable
    (e.g. `COURTS_API_KEY`), next to `COURTS_API_URL=https://courts.nvbc.app`.
- **Server only:** call this only from On Deck's server (route handlers or server actions). The key
  must never reach a browser.
- **Errors:** every error answer is `{ "error": "<message>" }`. The message is in plain language and
  can be shown to staff as-is.

| HTTP | Meaning |
| ---- | ------- |
| 200 | OK |
| 400 | Bad input (a malformed code or ref, or a bad date or sport) |
| 401 | Wrong or missing key |
| 404 | No voucher with that code (or, for undo, no redemption with that ref) |
| 409 | The voucher can't be used: void, redeemed, expired, used up, paused, a court voucher, or for the other sport |
| 429 | Too many wrong keys from this server; wait 15 minutes |
| 503 | `ONDECK_API_KEY` isn't set on NVBC Courts |
| 500 | Unexpected error; safe to retry |

## Voucher codes

Codes look like `VCH-7K3Q-9PXM` and have no 0/O or 1/I/L. The API accepts:
- the code with or without dashes or spaces, in any case;
- the full link from the voucher's QR code (`https://courts.nvbc.app/voucher#VCH-7K3Q-9PXM`).

So On Deck can pass the scanned QR text straight through.

## The voucher object

Every answer includes the voucher as NVBC Courts sees it:

```json
{
  "code": "VCH-7K3Q-9PXM",
  "kind": "ondeck_session",
  "sport": "pickleball",
  "session": "Pickleball Open Play Session",
  "sessions": 2,
  "sessionsLeft": 1,
  "state": "ready",
  "usable": true,
  "problem": null,
  "title": "Opening promo",
  "issuedTo": "Juan Dela Cruz",
  "validFrom": null,
  "expiresOn": "2026-12-31",
  "terms": ["Good for 2 free Pickleball Open Play sessions at NVBC On Deck (ondeck.nvbc.app).", "…"]
}
```

| Field | Meaning |
| ----- | ------- |
| `kind` | Only `"ondeck_session"` can be used at On Deck. Other kinds are court vouchers, which come back with `usable: false` and a `problem` saying so. |
| `sport` | `"badminton"` (Badminton Queueing) or `"pickleball"` (Pickleball Open Play). `null` for court vouchers. |
| `state` | One of `ready`, `not_yet`, `paused`, `used_up`, `expired`, `redeemed` or `void`. |
| `usable` / `problem` | Whether it can be redeemed for the session you asked about, and if not, why, as a sentence ready to show. |
| `issuedTo` | Who it was given to (optional). Anyone with the code may use it, so this is only a hint for staff. |
| `terms` | The voucher's terms and conditions, one line each. |

## Actions

### 1. Check: changes nothing

```json
{ "action": "check", "code": "VCH-7K3Q-9PXM", "date": "2026-11-12", "sport": "pickleball" }
```

- `date` (optional): the session's day in Manila time, `YYYY-MM-DD`. Default: today.
- `sport` (optional): the session's sport, `"badminton"` or `"pickleball"`.
- **Answer:** `200 { "voucher": { … } }`

Use it when staff scan or type a code, before confirming. Show the session name, the sessions left and
who it was issued to. If `usable` is false, show `problem`.

### 2. Redeem: uses one session

```json
{
  "action": "redeem",
  "code": "VCH-7K3Q-9PXM",
  "ref": "checkin_8f3a2c",
  "date": "2026-11-12",
  "sport": "pickleball",
  "player": "Juan Dela Cruz",
  "by": "Ana (front desk)"
}
```

- `ref` (required): On Deck's own unique id for this redemption, such as the check-in or queue-entry
  id. It can use letters, digits and `. _ : -`, up to 100 characters.
  - The **same ref never uses a second session.** Sending it again answers with the first redemption
    and `"alreadyRedeemed": true`, so a timed-out request can safely be retried.
  - Use a new ref for each visit.
- `date` and `sport`: as for check. Send `sport`, so a badminton voucher can't be used at pickleball
  open play.
- `player` (optional, up to 80 characters) and `by` (the On Deck staff member, up to 50): shown in
  the voucher's history on NVBC Courts.
- **Answer:**
  ```json
  { "redemption": { "id": "25", "ref": "checkin_8f3a2c", "redeemedAt": "2026-11-12T10:03:00.000Z", "alreadyRedeemed": false },
    "voucher": { "…": "…", "sessionsLeft": 0 } }
  ```
- If the voucher can't be used: `409 { "error": "This voucher has been fully used." }` (or another reason).

Store the `ref` (and the voucher code) on the check-in, so the redemption can be undone.

### 3. Undo: gives the session back

```json
{ "action": "undo", "code": "VCH-7K3Q-9PXM", "ref": "checkin_8f3a2c", "by": "Ana (front desk)", "reason": "Scanned by mistake" }
```

- Use it when a redeemed check-in is cancelled or was a mistake. The session goes back on the voucher,
  even if the voucher has expired since.
- **Answer:** `200 { "undone": true, "voucher": { … } }`
- Undoing twice is safe: the second time answers `"undone": false`.
- An unknown ref gets a 404.
- Redeeming the same ref again after an undo uses the session again.

## What to build on On Deck

1. **Settings:** add `COURTS_API_URL` (default `https://courts.nvbc.app`) and `COURTS_API_KEY`,
   server-side only.
2. **A small server-side client:** `checkVoucher(code, {date, sport})`,
   `redeemVoucher({code, ref, date, sport, player, by})` and `undoVoucher({code, ref, by, reason})`.
   - Send a POST with the Bearer key, a 10-second timeout, and one retry on network errors or 5xx
     (safe, because of `ref`).
   - Turn `{ error }` answers into messages staff can see.
3. **"Use a voucher" at check-in or sign-up for a queueing or open-play session:**
   - a field for the code, plus a camera QR scan that pastes the scanned text;
   - **Check** shows the voucher's session name, sessions left, expiry, issued-to, and any problem;
   - **Confirm** redeems it, with the check-in id as `ref`, the session's sport and date, the player's
     name and the staff member's name;
   - mark the player's fee as covered by the voucher, and save the voucher code and `ref` on the
     check-in.
4. **Undo:** when a check-in paid with a voucher is cancelled or removed, call undo with its `ref`.
5. **Show** "Paid with voucher VCH-…" on the check-in, in On Deck's own reports and in the day's list.

## On NVBC Courts

- Staff create these under **Vouchers → Create vouchers → Free On Deck session** and print them like
  any voucher. The QR code opens the voucher's page on NVBC Courts, which shows the sessions left and
  links to On Deck.
- Each On Deck use shows on the voucher's page under **Used on** (by `player` and `by`), and in its
  **History**.
- These vouchers can't be used on court bookings. Court vouchers can't be used at On Deck.
