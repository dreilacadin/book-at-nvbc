// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { eventLink, pushSummary, timeAgo } from "./notify-kinds.ts";

test("eventLink opens the booking, or the members list", () => {
  assert.equal(eventLink({ kind: "payment_sent", booking_code: "NV-ABC123", membership_id: null }), "/admin?booking=NV-ABC123");
  assert.equal(eventLink({ kind: "member_applied", booking_code: null, membership_id: "x" }), "/admin?tab=members");
});

test("pushSummary: one event as is; several as one summary", () => {
  const e = (t: string) => ({ push_title: t, body: "Court 1", kind: "booking_new", booking_code: "NV-" + t, membership_id: null });
  assert.equal(pushSummary([]), null);
  assert.deepEqual(pushSummary([e("A")]), { title: "A", body: "Court 1", url: "/admin?booking=NV-A", tag: "NV-A" });
  const many = pushSummary([e("A"), e("B"), e("C"), e("D")])!;
  assert.equal(many.title, "4 new notifications");
  assert.equal(many.body, "A · B · C · …");
  assert.equal(many.url, "/admin");
});

test("timeAgo", () => {
  const now = Date.parse("2026-10-01T10:00:00Z");
  assert.equal(timeAgo("2026-10-01T09:59:30Z", now), "just now");
  assert.equal(timeAgo("2026-10-01T09:55:00Z", now), "5 min ago");
  assert.equal(timeAgo("2026-10-01T07:00:00Z", now), "3 h ago");
  assert.equal(timeAgo("2026-09-28T10:00:00Z", now), "3 d ago");
});
