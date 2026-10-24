"use strict";
/*
 * Unit tests for the real-record behaviour of flatten, renderFixesTable and
 * buildDraft (the panel showed errors for real records whose shape differs
 * from the old fixtures). Covers:
 *  - name fallback (null, absent, blank, valid name kept)
 *  - estimate_* taken from .usd
 *  - Top_Fix from fixes[0] with null cost
 *  - PENDING_QUOTE in the four quote-dependent fields and the two table cells
 *  - gallons/carbon computed even when cost is null
 *  - buildDraft on the real first record of data/profiles.json succeeds and
 *    every Filled_Text passes checkNumbers.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const GW = require("../grant_writer.js");
const { checkNumbers } = require("../check_numbers.js");

const { flatten, renderFixesTable, fixesTableText, buildDraft, PENDING_QUOTE } = GW;

// A record in the real shape, with a null-cost / null-payback top fix.
function realRecord(overrides) {
  return Object.assign({
    id: "way/1",
    name: null,
    lat: 42.3,
    lon: -72.5,
    sqft: 2906,
    covering: "double_poly (assumed)",
    town: "Amherst",
    utility: null,
    hdd: 6000,
    price_per_gal: 3.66,
    estimate: {
      low: { gal: 805, usd: 2945 },
      high: { gal: 2724, usd: 9969 },
      point: { gal: 1444, usd: 5287, method: "calibrated rate" },
      confidence: "wide",
      method: "size only"
    },
    fixes: [
      { name: "Thermal curtain", saves_usd: 1322, cost_usd: null, payback_years: null, method: "25%" },
      { name: "Night setback", saves_usd: 634, cost_usd: null, payback_years: null, method: "12%" }
    ],
    evidence: { bill_uploaded: false, quote_uploaded: false, answers: {} }
  }, overrides || {});
}

// ---------------------------------------------------------------------
// name fallback
// ---------------------------------------------------------------------
test("name fallback: null name becomes the town fallback", () => {
  assert.equal(flatten(realRecord({ name: null })).name, "an unnamed greenhouse in Amherst");
});
test("name fallback: absent name becomes the town fallback", () => {
  const r = realRecord();
  delete r.name;
  assert.equal(flatten(r).name, "an unnamed greenhouse in Amherst");
});
test("name fallback: blank/whitespace name becomes the town fallback", () => {
  assert.equal(flatten(realRecord({ name: "   " })).name, "an unnamed greenhouse in Amherst");
  assert.equal(flatten(realRecord({ name: "" })).name, "an unnamed greenhouse in Amherst");
});
test("name fallback: a valid name is kept unchanged", () => {
  assert.equal(flatten(realRecord({ name: "Vervane Greenhouse" })).name, "Vervane Greenhouse");
});
test("name fallback: no town -> digit-free generic text", () => {
  assert.equal(flatten(realRecord({ name: null, town: "" })).name, "an unnamed greenhouse");
  const r = realRecord({ name: null });
  delete r.town;
  assert.equal(flatten(r).name, "an unnamed greenhouse");
});
test("name fallback text contains no digit", () => {
  for (const v of [null, "", "   "]) {
    assert.doesNotMatch(flatten(realRecord({ name: v })).name, /[0-9]/);
  }
  assert.doesNotMatch(flatten(realRecord({ name: null, town: "" })).name, /[0-9]/);
});

// ---------------------------------------------------------------------
// estimate_* from .usd
// ---------------------------------------------------------------------
test("estimate_* is the .usd of each band", () => {
  const f = flatten(realRecord());
  assert.equal(f.estimate_low, 2945);
  assert.equal(f.estimate_high, 9969);
  assert.equal(f.estimate_point, 5287);
});
test("estimate_* omitted when .usd is not finite, so fill throws on it", () => {
  const f = flatten(realRecord({ estimate: { low: { gal: 1, usd: NaN }, high: { gal: 2 }, point: 100 } }));
  assert.ok(!("estimate_low" in f));
  assert.ok(!("estimate_high" in f));
  assert.ok(!("estimate_point" in f));
});
test("estimate_* does not support the old plain-number shape", () => {
  const f = flatten(realRecord({ estimate: { low: 4500, high: 6100, point: 5287 } }));
  assert.ok(!("estimate_low" in f));
  assert.ok(!("estimate_high" in f));
  assert.ok(!("estimate_point" in f));
});

// ---------------------------------------------------------------------
// Top_Fix is fixes[0] with null cost
// ---------------------------------------------------------------------
test("Top_Fix is fixes[0], not the max saves_usd", () => {
  // A later fix has a larger saves_usd; Top_Fix is still the first element.
  const f = flatten(realRecord({
    fixes: [
      { name: "First", saves_usd: 100, cost_usd: null, payback_years: null },
      { name: "Bigger", saves_usd: 9999, cost_usd: null, payback_years: null }
    ]
  }));
  assert.equal(f.top_fix_name, "First");
  assert.equal(f.top_fix_saves_usd, 100);
});
test("null cost -> PENDING_QUOTE for cost, grant and match; payback too", () => {
  const f = flatten(realRecord());
  assert.equal(f.top_fix_name, "Thermal curtain");
  assert.equal(f.top_fix_saves_usd, 1322);
  assert.equal(f.top_fix_cost_usd, PENDING_QUOTE);
  assert.equal(f.grant_request, PENDING_QUOTE);
  assert.equal(f.farmer_match, PENDING_QUOTE);
  assert.equal(f.top_fix_payback_years, PENDING_QUOTE);
});
test("PENDING_QUOTE constant is the exact text and carries no digit", () => {
  assert.equal(PENDING_QUOTE, "[pending vendor quote]");
  assert.doesNotMatch(PENDING_QUOTE, /[0-9]/);
});
test("finite cost -> grant split; payback copied", () => {
  const f = flatten(realRecord({
    fixes: [{ name: "Curtain", saves_usd: 1500, cost_usd: 7800, payback_years: 5.2 }]
  }));
  assert.equal(f.top_fix_cost_usd, 7800);
  assert.equal(f.grant_request, 6240);
  assert.equal(f.farmer_match, 1560);
  assert.equal(f.top_fix_payback_years, 5.2);
});
test("cost finite but payback null -> payback is PENDING_QUOTE, grant still computed", () => {
  const f = flatten(realRecord({
    fixes: [{ name: "Curtain", saves_usd: 1500, cost_usd: 7800, payback_years: null }]
  }));
  assert.equal(f.grant_request, 6240);
  assert.equal(f.top_fix_payback_years, PENDING_QUOTE);
});
test("cost a non-number/non-null value -> cost/grant/match omitted so fill throws", () => {
  const f = flatten(realRecord({
    fixes: [{ name: "Curtain", saves_usd: 1500, cost_usd: "7800", payback_years: "x" }]
  }));
  assert.ok(!("top_fix_cost_usd" in f));
  assert.ok(!("grant_request" in f));
  assert.ok(!("farmer_match" in f));
  assert.ok(!("top_fix_payback_years" in f));
});

// ---------------------------------------------------------------------
// gallons/carbon are not quote-dependent
// ---------------------------------------------------------------------
test("gallons_saved/carbon_tons_saved computed with null cost", () => {
  const f = flatten(realRecord());
  assert.equal(f.gallons_saved, Math.round(1322 / 3.66)); // 361
  assert.equal(f.carbon_tons_saved, Math.round(f.gallons_saved * GW.CO2_KG_PER_GALLON / 1000 * 10) / 10);
});
test("gallons/carbon omitted when price_per_gal is 0 or non-positive", () => {
  assert.ok(!("gallons_saved" in flatten(realRecord({ price_per_gal: 0 }))));
  assert.ok(!("carbon_tons_saved" in flatten(realRecord({ price_per_gal: 0 }))));
  assert.ok(!("gallons_saved" in flatten(realRecord({ price_per_gal: -3.66 }))));
});
test("empty or absent fixes omit all top_fix_* / grant / gallons / carbon fields", () => {
  const omitted = ["top_fix_name", "top_fix_saves_usd", "top_fix_cost_usd",
    "top_fix_payback_years", "grant_request", "farmer_match", "gallons_saved", "carbon_tons_saved"];
  const empty = flatten(realRecord({ fixes: [] }));
  const noArr = flatten(realRecord({ fixes: undefined }));
  const notObj = flatten(realRecord({ fixes: ["not an object"] }));
  for (const k of omitted) {
    assert.ok(!(k in empty), "empty fixes should omit " + k);
    assert.ok(!(k in noArr), "absent fixes should omit " + k);
    assert.ok(!(k in notObj), "non-object fixes[0] should omit " + k);
  }
});

// ---------------------------------------------------------------------
// renderFixesTable: PENDING_QUOTE in the two quote cells
// ---------------------------------------------------------------------
test("renderFixesTable shows PENDING_QUOTE for null cost_usd and payback_years", () => {
  const rows = renderFixesTable(realRecord());
  // header + 2 fix rows. Columns: name, saves_usd, cost_usd, payback_years.
  assert.deepEqual(rows[0], [...GW.FIXES_TABLE_HEADER]);
  assert.equal(rows[1][2], PENDING_QUOTE); // cost_usd
  assert.equal(rows[1][3], PENDING_QUOTE); // payback_years
  assert.equal(rows[2][2], PENDING_QUOTE);
  assert.equal(rows[2][3], PENDING_QUOTE);
});
test("renderFixesTable keeps {UNKNOWN} for other non-number/non-string cells", () => {
  const rows = renderFixesTable(realRecord({
    fixes: [{ name: {}, saves_usd: null, cost_usd: {}, payback_years: true }]
  }));
  assert.equal(rows[1][0], "{UNKNOWN: name}");
  assert.equal(rows[1][1], "{UNKNOWN: saves_usd}");
  // cost_usd/payback_years here are a non-null object/boolean, not null/absent.
  assert.equal(rows[1][2], "{UNKNOWN: cost_usd}");
  assert.equal(rows[1][3], "{UNKNOWN: payback_years}");
});
test("renderFixesTable text passes checkNumbers for a null-cost record", () => {
  const r = realRecord();
  const text = fixesTableText(renderFixesTable(r));
  assert.deepEqual(checkNumbers(text, flatten(r)), { pass: true, rejected: [] });
});

// ---------------------------------------------------------------------
// buildDraft on the real first record of data/profiles.json (read-only)
// ---------------------------------------------------------------------
test("buildDraft on the real first record succeeds and every Filled_Text passes checkNumbers", () => {
  const profiles = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "data", "profiles.json"), "utf8")
  );
  const arr = Array.isArray(profiles)
    ? profiles
    : (Array.isArray(profiles.records) ? profiles.records : Object.values(profiles).find(Array.isArray));
  assert.ok(Array.isArray(arr) && arr.length > 0, "profiles.json has records");
  const record = arr[0];
  const before = JSON.stringify(record);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "cache", "manifest.json"), "utf8")
  );
  const draft = buildDraft(record, manifest);
  const flat = flatten(record);
  assert.equal(draft.sections.length, manifest.sections.length);
  for (const sec of draft.sections) {
    const res = checkNumbers(sec.text, flat);
    assert.deepEqual(res, { pass: true, rejected: [] },
      "section " + sec.name + " rejected " + JSON.stringify(res.rejected));
  }
  const tableRes = checkNumbers(fixesTableText(draft.fixesTable), flat);
  assert.deepEqual(tableRes, { pass: true, rejected: [] }, "Fixes_Table rejected " + JSON.stringify(tableRes.rejected));
  const quoteRes = checkNumbers(draft.quoteRequest, flat);
  assert.deepEqual(quoteRes, { pass: true, rejected: [] }, "Quote_Request rejected " + JSON.stringify(quoteRes.rejected));
  // buildDraft must not mutate the Record.
  assert.equal(JSON.stringify(record), before, "buildDraft mutated the real record");
});
