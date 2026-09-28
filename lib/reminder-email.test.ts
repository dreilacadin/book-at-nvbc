// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_REMINDER_BODY, fillTemplate, textToHtml } from "./reminder-email.ts";

const vars = {
  first_name: "Ana",
  name: "Ana Cruz",
  expired_on: "August 20, 2026",
  fee: "₱600",
  member_code: "NVBC-7K3Q-9PXM",
  member_page: "https://nvbc.example/membership/abc",
};

test("fillTemplate fills known placeholders and leaves typos visible", () => {
  assert.equal(fillTemplate("Hi {first_name}, renew for {fee}. {oops}", vars), "Hi Ana, renew for ₱600. {oops}");
  const body = fillTemplate(DEFAULT_REMINDER_BODY, vars);
  assert.ok(body.includes("expired on August 20, 2026"));
  assert.ok(body.includes("https://nvbc.example/membership/abc"));
  assert.ok(!/\{\w+\}/.test(body));
});

test("textToHtml escapes, keeps paragraphs and links URLs", () => {
  const html = textToHtml("Hi <Ana> & co,\nline two\n\nCard: https://x.example/m/abc");
  assert.ok(html.includes("Hi &lt;Ana&gt; &amp; co,<br>line two"));
  assert.ok(html.includes('<a href="https://x.example/m/abc"'));
  assert.equal((html.match(/<p /g) ?? []).length, 2);
});
