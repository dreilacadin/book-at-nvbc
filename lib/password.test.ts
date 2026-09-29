// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "./password.ts";

test("hashPassword / verifyPassword", () => {
  const h = hashPassword("correct horse battery");
  assert.match(h, /^scrypt\$[\w-]+\$[\w-]+$/);
  assert.ok(!h.includes("correct horse")); // never stored as text
  assert.ok(verifyPassword("correct horse battery", h));
  assert.ok(!verifyPassword("correct horse batterY", h));
  assert.notEqual(hashPassword("same"), hashPassword("same")); // salted
  assert.ok(!verifyPassword("x", "not-a-hash"));
});
