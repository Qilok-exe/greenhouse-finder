"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const fc = require("fast-check");

const GW = require("../grant_writer.js");
const {
  buildDraft,
  validateTemplate,
  QUOTE_REQUEST_TEMPLATE,
  QUOTE_MISSING_LABEL
} = GW;

// ---------------------------------------------------------------------
// Local Record arbitrary (frozen data/record-shape.md shape). Kept local so
// this file does not depend on the shared generators module.
// ---------------------------------------------------------------------

// Strings may contain digits but never braces, so fill does not see tokens.
const text = fc.string({ maxLength: 20 }).map((s) => s.replace(/[{}]/g, ""));
const money = fc.integer({ min: 0, max: 10000000 }).map((c) => c / 100);

// At least one fix with a string name and finite saves_usd / cost_usd, so
// {top_fix_name} in QUOTE_REQUEST_TEMPLATE always resolves.
const fix = fc.record({
  name: text,
  saves_usd: money,
  cost_usd: money,
  payback_years: fc.double({ min: 0, max: 100, noNaN: true })
});

const recordWithQuote = (quoteArb) =>
  fc.record({
    id: text,
    name: text,
    lat: fc.double({ min: -90, max: 90, noNaN: true }),
    lon: fc.double({ min: -180, max: 180, noNaN: true }),
    sqft: fc.integer({ min: 1, max: 1000000 }),
    bays: fc.integer({ min: 0, max: 50 }),
    covering: text,
    town: text,
    utility: text,
    hdd: fc.integer({ min: 0, max: 15000 }),
    price_per_gal: fc.oneof(money, fc.constant(0), fc.constant(null)),
    estimate: fc.record({
      low: money,
      high: money,
      point: money,
      confidence: text,
      method: text
    }),
    fixes: fc.array(fix, { minLength: 1, maxLength: 6 }),
    evidence: fc.record({
      bill_uploaded: fc.boolean(),
      quote_uploaded: quoteArb,
      answers: fc.dictionary(text, text, { maxKeys: 3 })
    })
  });

// Manifest whose templates reference only fields present for every Record
// above (record scalars and top_fix_*), plus an Unknown_Marker.
const manifest = {
  model_id: "test-model",
  rulebook_sha256: "test-hash",
  sections: [
    { name: "Project", criteria: [], template: "Project at {name} in {town} needs {top_fix_name}." },
    { name: "Budget", criteria: [], template: "We request {grant_request} dollars; match {farmer_match}. {UNKNOWN: timeline}" }
  ]
};

// ---------------------------------------------------------------------
// Property 13
// ---------------------------------------------------------------------

// Feature: grant-writer, Property 13: Quote_Missing_Label
// **Validates: Requirements 2.7, 2.8**
test("Property 13: quoteMissingLabel is the label iff quote_uploaded is false, else null", () => {
  fc.assert(
    fc.property(recordWithQuote(fc.boolean()), (record) => {
      const draft = buildDraft(record, manifest);
      if (record.evidence.quote_uploaded === false) {
        assert.equal(draft.quoteMissingLabel, "application draft: quote missing");
      } else {
        assert.equal(draft.quoteMissingLabel, null);
      }
    }),
    { numRuns: 100 }
  );
});

// ---------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------

test("QUOTE_MISSING_LABEL is the exact label text", () => {
  assert.equal(QUOTE_MISSING_LABEL, "application draft: quote missing");
});

// Requirement 2.5: the Quote_Request is a valid, digit-free Template.
test("QUOTE_REQUEST_TEMPLATE passes validateTemplate", () => {
  assert.deepEqual(validateTemplate(QUOTE_REQUEST_TEMPLATE), { ok: true, offending: [] });
  assert.match(QUOTE_REQUEST_TEMPLATE, /\{top_fix_name\}/);
  assert.doesNotMatch(QUOTE_REQUEST_TEMPLATE, /[$€£]/);
});

// Requirement 3.1: constants exist, with source comments.
test("Grant constants have their values and cite their sources", () => {
  assert.equal(GW.GRANT_SHARE, 0.8);
  assert.equal(GW.GRANT_CAP_USD, 50000);
  assert.equal(GW.CO2_KG_PER_GALLON, 5.72);

  const src = fs.readFileSync(path.join(__dirname, "..", "grant_writer.js"), "utf8");
  const lines = src.split(/\r?\n/);

  // The contiguous // comment block directly above a declaration line.
  function commentAbove(declRe) {
    const i = lines.findIndex((l) => declRe.test(l));
    assert.notEqual(i, -1, "declaration not found: " + declRe);
    const block = [];
    for (let j = i - 1; j >= 0 && /^\s*\/\//.test(lines[j]); j--) block.unshift(lines[j]);
    return block.map((l) => l.replace(/^\s*\/\/\s?/, "")).join(" ");
  }

  const csap = "CSAP FY26 RFR and Round II how-to page";
  assert.ok(commentAbove(/\bvar GRANT_SHARE = 0\.8;/).includes(csap));
  assert.ok(commentAbove(/\bvar GRANT_CAP_USD = 50000;/).includes(csap));
  assert.ok(commentAbove(/\bvar CO2_KG_PER_GALLON = 5\.72;/).includes("user-supplied propane factor"));
});

// Requirement 2.9: a non-boolean or absent quote_uploaded produces no draft.
test("buildDraft throws naming evidence.quote_uploaded when it is not a boolean", () => {
  const base = fc.sample(recordWithQuote(fc.constant(true)), { numRuns: 1, seed: 1 })[0];
  const bad = [undefined, null, "false", "true", 0, 1, {}, []];
  for (const v of bad) {
    const record = { ...base, evidence: { ...base.evidence, quote_uploaded: v } };
    if (v === undefined) delete record.evidence.quote_uploaded;
    assert.throws(() => buildDraft(record, manifest), /evidence\.quote_uploaded/,
      "value " + JSON.stringify(v));
  }
  const noEvidence = { ...base };
  delete noEvidence.evidence;
  assert.throws(() => buildDraft(noEvidence, manifest), /evidence\.quote_uploaded/);
});
