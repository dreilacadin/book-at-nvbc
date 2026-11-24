// Run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  colorStock,
  inStock,
  stockLines,
  stringColorName,
  DEFAULT_STRINGING_PRICES,
  checkTurnaround,
  earliestPickup,
  mergeSuggestions,
  mobileTail,
  normalizeMobile,
  priceLines,
  racketPrice,
  readPrestretch,
  readTag,
  shortName,
  readTension,
  readyMessage,
  receivedMessage,
  setupLabel,
  tensionLabel,
  thankYouMessage,
  trackingMessage,
  toStringingPrices,
} from "./stringing.ts";

const p = DEFAULT_STRINGING_PRICES;

test("prices: ₱200 labour, +₱150 rush, the string, ₱10 / ₱20 grommets", () => {
  assert.deepEqual(racketPrice({ rush: false, stringPrice: 0, grommetsSingle: 0, grommetsDouble: 0 }, p), { labor: 200, rush: 0, string: 0, grommets: 0, total: 200 });
  const r = racketPrice({ rush: true, stringPrice: 450, grommetsSingle: 3, grommetsDouble: 2 }, p);
  assert.deepEqual(r, { labor: 200, rush: 150, string: 450, grommets: 70, total: 870 });
});

test("prices: saved values, with defaults for missing or bad ones", () => {
  assert.deepEqual(toStringingPrices(null), p);
  const s = toStringingPrices({ labor: 250, rush: "", grommetSingle: -1, standardDays: [2, 4], rushDays: [3, 1] });
  assert.equal(s.labor, 250);
  assert.equal(s.rush, 150);
  assert.equal(s.grommetSingle, 10);
  assert.deepEqual(s.standardDays, [2, 4]);
  assert.deepEqual(s.rushDays, [1, 2]); // 3 to 1 isn't a range
});

test("turnaround: a change from the desk", () => {
  assert.deepEqual(checkTurnaround({ standardDays: ["5", "7"], rushDays: [2, 3] }), { standardDays: [5, 7], rushDays: [2, 3] });
  assert.deepEqual(checkTurnaround({ standardDays: [0, 0], rushDays: [0, 0] }), { standardDays: [0, 0], rushDays: [0, 0] });
  assert.match(checkTurnaround({ standardDays: [5, 3], rushDays: [1, 2] }) as string, /first not more/);
  assert.match(checkTurnaround({ standardDays: ["", 3], rushDays: [1, 2] }) as string, /whole numbers/);
  assert.match(checkTurnaround({ standardDays: [1.5, 3], rushDays: [1, 2] }) as string, /whole numbers/);
  assert.match(checkTurnaround({ standardDays: [3, 61], rushDays: [1, 2] }) as string, /whole numbers/);
  assert.match(checkTurnaround({ standardDays: [3, 5], rushDays: [4, 4] }) as string, /Rush can't take longer/);
  assert.match(checkTurnaround({}) as string, /whole numbers/);
  // Who changed it is kept with the saved settings.
  assert.deepEqual(toStringingPrices({ turnaroundChanged: { by: "Jenn", at: "2026-11-21T06:00:00Z" } }).turnaroundChanged, { by: "Jenn", at: "2026-11-21T06:00:00Z" });
  assert.equal(toStringingPrices({ turnaroundChanged: { by: 3 } }).turnaroundChanged, null);
});

test("turnaround: the earliest collection date", () => {
  assert.equal(earliestPickup("2026-11-19", false, p), "2026-11-22");
  assert.equal(earliestPickup("2026-11-19", true, p), "2026-11-20");
});

test("tension: presets, half pounds, custom mains × crosses", () => {
  assert.equal(readTension("26"), 26);
  assert.equal(readTension("26 lbs"), 26);
  assert.equal(readTension(25.5), 25.5);
  assert.equal(readTension("25.3"), null);
  assert.equal(readTension("50"), null);
  assert.equal(readTension(""), null);
  assert.equal(tensionLabel(26, 26), "26 lbs");
  assert.equal(tensionLabel(24, 26), "24 × 26 lbs");
});

test("mobile numbers and tags", () => {
  assert.equal(normalizeMobile("0917 123 4567"), "09171234567");
  assert.equal(normalizeMobile("+63 917-123-4567"), "09171234567");
  assert.equal(normalizeMobile("9171234567"), "09171234567");
  assert.equal(normalizeMobile("12345"), null);
  assert.equal(mobileTail("09171234567"), "•••• 4567");
  assert.equal(readTag("#127"), 127);
  assert.equal(readTag("127"), 127);
  assert.equal(readTag("tag 127"), 127);
  assert.equal(readTag("https://courts.nvbc.app/admin?tag=127"), 127);
  assert.equal(readTag("https://courts.nvbc.app/t/127"), 127); // label-printer tags
  assert.equal(readTag("https://courts.nvbc.app/t/abc"), null);
  assert.equal(readTag("VCH-ABCD-2345"), null);
});

test("short names for tags", () => {
  assert.equal(shortName("Ana Santos Reyes"), "Ana R.");
  assert.equal(shortName("  Ana  "), "Ana");
  assert.equal(shortName(""), "");
});

test("suggestions: no duplicates (ignoring case and spacing), sorted", () => {
  assert.deepEqual(mergeSuggestions(["Yonex BG66 Ultimax", "Yonex BG80"], ["yonex  bg66 ultimax", "Li-Ning No.1", " "]),
    ["Li-Ning No.1", "Yonex BG66 Ultimax", "Yonex BG80"]);
});

test("messages: ready (one or several, balance), received, thank you", () => {
  const one = readyMessage({ name: "Juan Dela Cruz", rackets: [{ tag: 127, racket: "Astrox 88D" }], waiting: 0, balance: 0, link: "https://x/string/t" });
  assert.equal(one.title, "Your racket is ready 🏸");
  assert.match(one.sms, /^Hi Juan! Your racket #127 Astrox 88D is ready for pickup at NVBC\./);
  assert.ok(!one.sms.includes("balance"));
  const two = readyMessage({ name: "Ana", rackets: [{ tag: 1, racket: "A" }, { tag: 2, racket: "B" }], waiting: 1, balance: 420, link: "L" });
  assert.match(two.email, /Your rackets #1 A, #2 B are restrung/);
  assert.match(two.email, /1 more still being strung/);
  assert.match(two.sms, /balance of ₱420/);
  assert.match(receivedMessage({ name: "Ana", rackets: [{ tag: 1, racket: "A" }], dueOn: "2026-11-22", link: "L" }).body, /ready by Sunday, November 22, 2026/);
  assert.match(thankYouMessage({ name: "Ana", link: "https://x/string/t#feedback" }).sms, /https:\/\/x\/string\/t#feedback/);
});

test("messages: the link text staff send", () => {
  assert.equal(trackingMessage({ name: "Juan Dela Cruz", rackets: [{ tag: 127, racket: "Astrox 88D" }], dueOn: "2026-11-26", link: "https://x/string/t" }),
    "Hi Juan! Follow your racket #127 Astrox 88D at NVBC here: https://x/string/t It'll be ready by Thursday, November 26, 2026, and we'll tell you when it's done.");
  const done = trackingMessage({ name: "Ana", rackets: [{ tag: 1, racket: "A" }, { tag: 2, racket: "B" }], dueOn: null, link: "L" });
  assert.equal(done, "Hi Ana! Follow your rackets #1 A, #2 B at NVBC here: L");
});

test("pre-stretch: none, 5–20%, and the label", () => {
  for (const v of [undefined, null, "", 0, "0"]) assert.equal(readPrestretch(v), null);
  assert.equal(readPrestretch(10), 10);
  assert.equal(readPrestretch("15"), 15);
  for (const v of [7, 25, "abc", -5]) assert.equal(readPrestretch(v), undefined);
  assert.equal(setupLabel(26, 26, 10), "26 lbs · pre-stretch 10%");
  assert.equal(setupLabel(24, 26, null), "24 × 26 lbs");
});

test("receipt lines: only what applies, grommets counted", () => {
  const price = racketPrice({ rush: false, stringPrice: 730, grommetsSingle: 2, grommetsDouble: 0 }, p);
  assert.deepEqual(priceLines(price, 2), [
    { label: "Stringing", amount: 200 }, { label: "String", amount: 730 }, { label: "Grommets (2)", amount: 20 },
  ]);
  assert.equal(price.total, 950);
  assert.deepEqual(priceLines(racketPrice({ rush: true, stringPrice: 0, grommetsSingle: 0, grommetsDouble: 0 }, p)).map((l) => l.label), ["Stringing", "Rush"]);
});

test("tags: QR codes off unless switched on", () => {
  assert.equal(DEFAULT_STRINGING_PRICES.tagQr, false);
  assert.equal(toStringingPrices({}).tagQr, false);
  assert.equal(toStringingPrices({ tagQr: true }).tagQr, true);
  assert.equal(toStringingPrices({ tagQr: "yes" }).tagQr, false);
});

test("stock is counted per colour", () => {
  const s = { brand: "Yonex", model: "BG 80", colors: ["Black", "White"], stockBy: { Black: 0, White: 3, Pink: 2, Old: 0 } };
  assert.equal(colorStock(s, "White"), 3);
  assert.equal(colorStock(s, "Yellow"), 0);
  assert.equal(inStock(s), true);
  assert.equal(inStock({ ...s, stockBy: { Black: 0, Pink: 5 } }), false); // only colours on offer count
  // The colours on offer, then other colours that still have stock (not ones at zero).
  assert.deepEqual(stockLines(s), [
    { color: "Black", stock: 0, listed: true },
    { color: "White", stock: 3, listed: true },
    { color: "Pink", stock: 2, listed: false },
  ]);
  // A string without colours has one line, "".
  assert.deepEqual(stockLines({ colors: [], stockBy: { "": 4 } }), [{ color: "", stock: 4, listed: true }]);
  assert.equal(inStock({ colors: [], stockBy: {} }), false);
  assert.equal(stringColorName(s, "White"), "Yonex BG 80 (White)");
  assert.equal(stringColorName(s, ""), "Yonex BG 80");
});
