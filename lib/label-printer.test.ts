// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { labelBitmap, labelSize, printJob, readReply, toLabelSettings } from "./label-printer.ts";

/** A w × h RGBA image, white, with the given pixels black. */
function image(w: number, h: number, black: [number, number][]) {
  const d = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const [x, y] of black) d.set([0, 0, 0, 255], (y * w + x) * 4);
  return d;
}
const bit = (b: { bytesPerRow: number; data: Uint8Array }, x: number, y: number) => (b.data[y * b.bytesPerRow + (x >> 3)] >> (7 - (x & 7))) & 1;

test("label bitmap: turned a quarter clockwise, 1 = black, rows padded to bytes", () => {
  // 3 wide × 10 tall: rotated it's 10 wide (2 bytes a row) × 3 rows.
  const b = labelBitmap(image(3, 10, [[0, 0], [2, 9]]), 3, 10);
  assert.deepEqual([b.width, b.height, b.bytesPerRow, b.data.length], [10, 3, 2, 6]);
  // Top-left (0,0) lands at the right end of the first row; bottom-right (2,9) at the start of the last.
  assert.equal(bit(b, 9, 0), 1);
  assert.equal(bit(b, 0, 2), 1);
  assert.equal([...b.data].reduce((n, x) => n + x.toString(2).split("1").length - 1, 0), 2);
});

test("label bitmap: grey and transparent", () => {
  const d = new Uint8ClampedArray([100, 100, 100, 255, 200, 200, 200, 255, 0, 0, 0, 0, 0, 0, 0, 128]);
  const b = labelBitmap(d, 4, 1); // rotated: 1 wide × 4 rows
  // Dark grey and half-clear black (mid grey on white) print; light grey and clear don't.
  assert.deepEqual([0, 1, 2, 3].map((y) => bit(b, 0, y)), [1, 0, 0, 1]);
});

test("print job: darkness, wake, start; then image, feed to the gap, stop", () => {
  const b = labelBitmap(image(2, 16, [[0, 0]]), 2, 16); // 16 wide (2 bytes) × 2 rows
  const j = printJob(b, { density: 3, paper: "gap" });
  assert.deepEqual([...j.setup.slice(0, 4)], [0x1f, 0x70, 0x02, 3]);
  assert.equal(j.setup.length, 4 + 15 + 4);
  assert.deepEqual([...j.setup.slice(-4)], [0x10, 0xff, 0xf1, 0x02]);
  assert.deepEqual([...j.body.slice(0, 8)], [0x1d, 0x76, 0x30, 0, 2, 0, 2, 0]);
  assert.equal(j.body.length, 8 + 4 + 2 + 4);
  assert.deepEqual([...j.body.slice(-6)], [0x1d, 0x0c, 0x10, 0xff, 0xf1, 0x45]);
  assert.deepEqual([...printJob(b, { density: 2, paper: "continuous" }).body.slice(-7)], [0x1b, 0x4a, 100, 0x10, 0xff, 0xf1, 0x45]);
});

test("printer replies", () => {
  assert.deepEqual(readReply([0xaa]), { type: "printed" });
  assert.deepEqual(readReply([0x4f, 0x4b]), { type: "printed" });
  assert.deepEqual(readReply([0x01, 5]), { type: "credit", n: 5 });
  assert.deepEqual(readReply([0x02, 0xf7, 0x00]), { type: "mtu", n: 247 });
  assert.deepEqual(readReply([0xff, 0x01]), { type: "problem", problem: "out_of_paper" });
  assert.deepEqual(readReply([0xff, 0x09]), { type: "problem", problem: "unknown" });
  assert.equal(readReply([0xff, 0x05]), null);
  assert.equal(readReply([]), null);
  assert.equal(readReply([0x33, 1]), null);
});

test("settings: defaults, and only P12 sizes", () => {
  assert.deepEqual(toLabelSettings(null), { on: false, paper: "gap", size: "30x12", density: 2, shiftX: 0, shiftY: 0 });
  assert.deepEqual(toLabelSettings({ on: true, paper: "continuous", size: "50x15", density: 3, shiftX: -1.5, shiftY: 0.5 }),
    { on: true, paper: "continuous", size: "50x15", density: 3, shiftX: -1.5, shiftY: 0.5 });
  assert.equal(toLabelSettings({ paper: "continuous", size: "40x14" }).size, "30x12"); // not a continuous size
  // The print moves at most 3 mm, in half millimetres.
  assert.deepEqual([3, -3, 3.5, 0.3, "1", -0].map((v) => toLabelSettings({ shiftX: v }).shiftX), [3, -3, 0, 0, 0, 0]);
  assert.equal(toLabelSettings({ size: "99x99", density: 7 }).density, 2);
  assert.deepEqual(labelSize(toLabelSettings({ size: "30x12" })), { w: 30, h: 12 });
});
