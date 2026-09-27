// Run with: npm test
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { test } from "node:test";
import { toCsv, toXlsx } from "./spreadsheet.ts";

test("toCsv: quotes, BOM, and formula-injection guard", () => {
  const csv = toCsv([
    ["Name", "Amount"],
    ['Ana "Coach" Cruz, Jr.', 472.5],
    ["=HYPERLINK(\"http://x\")", null],
    ["-5 players", 0],
    ["Total", { money: 800 }],
  ]);
  assert.ok(csv.startsWith("﻿Name,Amount\r\n"));
  assert.ok(csv.includes('"Ana ""Coach"" Cruz, Jr.",472.5\r\n'));
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")",\r\n`));
  assert.ok(csv.includes("'-5 players,0\r\n"));
  assert.ok(csv.endsWith("Total,800\r\n"));
});

/** Reads the entries of a zip made by toXlsx (local headers only; enough for a test). */
function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const name = buf.toString("utf8", p + 30, p + 30 + nameLen);
    const data = buf.subarray(p + 30 + nameLen, p + 30 + nameLen + size);
    out.set(name, inflateRawSync(data).toString("utf8"));
    p += 30 + nameLen + size;
  }
  return out;
}

test("toXlsx: a valid zip with a workbook, styles and one sheet per tab", () => {
  const buf = toXlsx([
    { name: "Bookings", rows: [["Name", "Amount"], ["Ana & <Ben>", 1500]], moneyCols: [1] },
    { name: "Summary: Sept?", rows: [["Total"], [{ money: 99.5 }]] },
  ]);
  const files = unzip(buf);
  assert.ok(files.has("[Content_Types].xml"));
  assert.ok(files.has("xl/styles.xml"));
  assert.match(files.get("xl/workbook.xml")!, /name="Bookings".*name="Summary  Sept "/);
  const sheet = files.get("xl/worksheets/sheet1.xml")!;
  assert.ok(sheet.includes("Ana &amp; &lt;Ben&gt;"));
  assert.ok(sheet.includes('<c r="B2" s="2"><v>1500</v></c>')); // ₱ format
  assert.ok(sheet.includes('<c r="A1" t="inlineStr" s="1">')); // bold header
  assert.ok(files.get("xl/worksheets/sheet2.xml")!.includes('<c r="A2" s="2"><v>99.5</v></c>'));
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50); // end-of-zip record
});
