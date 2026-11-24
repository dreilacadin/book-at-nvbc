// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { shareTokenIn } from "./share-link.ts";

test("share links: the token from a scanned or pasted link", () => {
  const t = "AbCdEfGhIjKlMnOpQr_-12";
  assert.equal(shareTokenIn(`https://courts.nvbc.app/b/${t}`), t);
  assert.equal(shareTokenIn(` https://courts.nvbc.app/b/${t}?x=1 `), t);
  assert.equal(shareTokenIn(`/b/${t}`), t);
  assert.equal(shareTokenIn(`https://courts.nvbc.app/b/${t}x`), null); // too long
  assert.equal(shareTokenIn("https://courts.nvbc.app/b/short"), null);
  assert.equal(shareTokenIn("NV-ABC123"), null); // a booking code is read as one
  assert.equal(shareTokenIn(`https://courts.nvbc.app/club/${t}`), null);
  assert.equal(shareTokenIn(42), null);
});
