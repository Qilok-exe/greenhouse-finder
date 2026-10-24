"use strict";

/*
 * agents/test/generators.js
 *
 * Shared fast-check arbitraries for the Grant Writer property tests.
 *
 * Records (data/record-shape.md, frozen field names):
 *   recordArb(options)            Record arbitrary. Strings may contain digits
 *                                 but never braces. Options:
 *                                   fixes:   "any" (default) | "valid" | "validNonEmpty"
 *                                   price:   "any" (default) | "valid"
 *                                   estimate:"any" (default) | "valid"
 *                                   quoteUploaded: arbitrary for
 *                                            evidence.quote_uploaded (default fc.boolean())
 *                                 "any" mixes valid and invalid inputs (absent,
 *                                 null, NaN, zero, negative, wrong type).
 *   validFixArb, anyFixArb        one element of `fixes`
 *   placeholderFlatArb            a Flat_Record built directly: each Placeholder
 *                                 name absent or holding a finite number, a
 *                                 brace-free string or a boolean
 *
 * Templates (digit-free, accepted by validateTemplate):
 *   templateArb(names)            { template, parts, placeholders }.
 *                                 parts: [{ kind: "prose"|"placeholder"|"unknown",
 *                                 text, name? }] in order; placeholders: the
 *                                 Placeholder names referenced, in order, with
 *                                 repeats. Never two Placeholders joined only by
 *                                 "," or "." (or nothing). At least one token.
 *                                 `names` defaults to PLACEHOLDER_NAMES; with an
 *                                 empty list only Unknown_Markers are used.
 *   recordWithTemplateArb(opts)   { record, flat, template, parts, placeholders }
 *                                 where flat = flatten(record) covers every
 *                                 referenced Placeholder.
 *
 * Helpers:
 *   fillablePlaceholders(flat)    Placeholder names whose flat value fill accepts
 *   renderValue(v)                the text fill inserts for a fillable value
 *   expectedFill(parts, flat)     the Filled_Text a correct fill returns
 *   makeTemplate(parts)           { template, parts, placeholders } from parts
 *   insertParts(parts, inserts)   insert extra parts at part boundaries
 *   ABSENT, dropAbsent            sentinel for "key not present"
 *   toPlain                       deep copy with ordinary prototypes
 *   safeStringArb, proseArb, unknownPartArb, finiteNumberArb, moneyArb
 */

const fc = require("fast-check");
const { PLACEHOLDER_NAMES, isUnknownMarkerInner, flatten } = require("../grant_writer.js");
const { formatNumber } = require("../format.js");

// ---------------------------------------------------------------------------
// Absent-key sentinel
// ---------------------------------------------------------------------------

const ABSENT = Symbol("absent");

function dropAbsent(obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    if (obj[k] !== ABSENT) out[k] = obj[k];
  }
  return out;
}

// Deep copy with ordinary Object/Array prototypes. fast-check may build
// null-prototype objects; Records parsed from JSON never are.
function toPlain(v) {
  if (Array.isArray(v)) return v.map(toPlain);
  if (v !== null && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v)) out[k] = toPlain(v[k]);
    return out;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

const SAFE_CHARS = [
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ..."0123456789",
  ..." ,.;:-_/()'\"$%&!?#@*+=<>|~^",
  "\n", "\t", "\r", "é", "ñ", "ü", "€", "£", "—"
];
const PROSE_CHARS = SAFE_CHARS.filter((c) => !/[0-9]/.test(c));
const LETTERS = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"];

// Record string values: may contain digits, never braces.
const safeStringArb = fc.oneof(
  { weight: 3, arbitrary: fc.string({ unit: fc.constantFrom(...SAFE_CHARS), maxLength: 30 }) },
  { weight: 1, arbitrary: fc.string({ unit: "grapheme", maxLength: 20 }).map((s) => s.replace(/[{}]/g, "")) }
);

// Template prose: no ASCII digits, no braces. Includes whitespace and line breaks.
const proseArb = fc.oneof(
  { weight: 3, arbitrary: fc.string({ unit: fc.constantFrom(...PROSE_CHARS), maxLength: 30 }) },
  { weight: 1, arbitrary: fc.string({ unit: "grapheme", maxLength: 20 }).map((s) => s.replace(/[0-9{}]/g, "")) }
);

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const finiteNumberArb = fc.oneof(
  fc.integer({ min: -1000000, max: 10000000 }),
  fc.integer({ min: -1000000000, max: 1000000000 }).map((c) => c / 100),
  fc.double({ min: -1e9, max: 1e9, noNaN: true, noDefaultInfinity: true })
);

// Money amounts, bounded so integer arithmetic on rounded values stays exact.
// Includes values around the grant cap (0.8 * 62,500 = 50,000).
const moneyArb = fc.oneof(
  fc.integer({ min: 0, max: 2000000 }),
  fc.integer({ min: -100000000, max: 100000000 }).map((c) => c / 100),
  fc.double({ min: -1e7, max: 1e7, noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom(0, 50000, 62499.99, 62500, 62500.01, 62500.625, 9200, 85000)
);

// saves_usd: money, plus a small pool so ties for the max are common.
const savesArb = fc.oneof(moneyArb, fc.constantFrom(100, 420, 7600));

// ---------------------------------------------------------------------------
// Fixes
// ---------------------------------------------------------------------------

const validFixArb = fc.record({
  name: safeStringArb,
  saves_usd: savesArb,
  cost_usd: moneyArb,
  payback_years: finiteNumberArb
});

// A value that makes saves_usd or cost_usd invalid.
const badNumberArb = fc.constantFrom(NaN, Infinity, -Infinity, null, "100", true, ABSENT);

const maybeBadFixArb = fc
  .record({
    name: fc.oneof(safeStringArb, fc.constantFrom(null, ABSENT)),
    saves_usd: fc.oneof(savesArb, badNumberArb),
    cost_usd: fc.oneof(moneyArb, badNumberArb),
    payback_years: fc.oneof(finiteNumberArb, fc.constantFrom(null, ABSENT))
  })
  .map(dropAbsent);

const anyFixArb = fc.oneof(
  { weight: 6, arbitrary: validFixArb },
  { weight: 3, arbitrary: maybeBadFixArb },
  { weight: 1, arbitrary: fc.constantFrom(null, "fix") }
);

function fixesArbFor(mode) {
  if (mode === "valid") return fc.array(validFixArb, { maxLength: 6 });
  if (mode === "validNonEmpty") return fc.array(validFixArb, { minLength: 1, maxLength: 6 });
  return fc.oneof(
    { weight: 4, arbitrary: fc.array(validFixArb, { maxLength: 6 }) },
    { weight: 3, arbitrary: fc.array(anyFixArb, { maxLength: 6 }) },
    { weight: 1, arbitrary: fc.constant(ABSENT) }
  );
}

// ---------------------------------------------------------------------------
// price_per_gal and estimate
// ---------------------------------------------------------------------------

const validPriceArb = fc.oneof(
  fc.double({ min: 0.01, max: 20, noNaN: true }),
  fc.constantFrom(3.66, 3.58)
);
const invalidPriceArb = fc.constantFrom(0, -0, -3.66, NaN, null, "3.66", ABSENT);

const validEstimateArb = fc
  .record({
    low: fc.oneof({ weight: 5, arbitrary: finiteNumberArb }, { weight: 1, arbitrary: fc.constant(ABSENT) }),
    high: fc.oneof({ weight: 5, arbitrary: finiteNumberArb }, { weight: 1, arbitrary: fc.constant(ABSENT) }),
    point: fc.oneof({ weight: 5, arbitrary: finiteNumberArb }, { weight: 1, arbitrary: fc.constant(ABSENT) }),
    confidence: fc.oneof(fc.constantFrom("low", "medium", "high"), safeStringArb),
    method: fc.oneof(fc.constant("degree_day"), safeStringArb)
  })
  .map(dropAbsent);
const invalidEstimateArb = fc.constantFrom(ABSENT, null);

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

function recordArb(options = {}) {
  const priceArb = options.price === "valid"
    ? validPriceArb
    : fc.oneof({ weight: 3, arbitrary: validPriceArb }, { weight: 1, arbitrary: invalidPriceArb });
  const estimateArb = options.estimate === "valid"
    ? validEstimateArb
    : fc.oneof({ weight: 3, arbitrary: validEstimateArb }, { weight: 1, arbitrary: invalidEstimateArb });

  return fc
    .record({
      id: fc.oneof(fc.integer({ min: 1, max: 999999999 }).map((n) => "way/" + n), safeStringArb),
      name: safeStringArb,
      lat: fc.double({ min: -90, max: 90, noNaN: true }),
      lon: fc.double({ min: -180, max: 180, noNaN: true }),
      sqft: fc.oneof(fc.integer({ min: 0, max: 200000 }), finiteNumberArb),
      bays: fc.integer({ min: 0, max: 50 }),
      covering: fc.oneof(fc.constant("double_poly (assumed)"), safeStringArb),
      town: safeStringArb,
      utility: safeStringArb,
      hdd: fc.integer({ min: 0, max: 12000 }),
      price_per_gal: priceArb,
      estimate: estimateArb,
      fixes: fixesArbFor(options.fixes || "any"),
      evidence: fc.record({
        bill_uploaded: fc.boolean(),
        quote_uploaded: options.quoteUploaded || fc.boolean(),
        answers: fc.record({ heating_fuel: safeStringArb, owner_operated: fc.boolean() })
      })
    })
    .map((r) => toPlain(dropAbsent(r)));
}

// A Flat_Record built directly from Placeholder names (covers booleans,
// which Records do not hold at Placeholder fields).
const placeholderFlatArb = fc
  .record(
    Object.fromEntries(
      PLACEHOLDER_NAMES.map((n) => [
        n,
        fc.oneof(
          { weight: 3, arbitrary: finiteNumberArb },
          { weight: 3, arbitrary: safeStringArb },
          { weight: 1, arbitrary: fc.boolean() },
          { weight: 1, arbitrary: fc.constant(ABSENT) }
        )
      ])
    )
  )
  .map((f) => toPlain(dropAbsent(f)));

// ---------------------------------------------------------------------------
// Fill helpers
// ---------------------------------------------------------------------------

function isFillableValue(v) {
  return (typeof v === "number" && Number.isFinite(v)) ||
    typeof v === "string" || typeof v === "boolean";
}

function fillablePlaceholders(flat) {
  return PLACEHOLDER_NAMES.filter(
    (n) => Object.prototype.hasOwnProperty.call(flat, n) && isFillableValue(flat[n])
  );
}

function renderValue(v) {
  if (typeof v === "number") return formatNumber(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return v;
}

function expectedFill(parts, flat) {
  return parts.map((p) => (p.kind === "placeholder" ? renderValue(flat[p.name]) : p.text)).join("");
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function placeholderPart(name) {
  return { kind: "placeholder", name, text: "{" + name + "}" };
}

// {UNKNOWN: <description>} with a digit-free description holding at least
// one non-space character.
const unknownPartArb = fc
  .tuple(fc.constantFrom("", " "), proseArb, fc.constantFrom(...LETTERS), proseArb)
  .map(([sp, a, letter, b]) => {
    const inner = "UNKNOWN:" + sp + a + letter + b;
    if (!isUnknownMarkerInner(inner)) throw new Error("generator bug: " + inner);
    return { kind: "unknown", text: "{" + inner + "}" };
  });

function makeTemplate(parts) {
  return {
    template: parts.map((p) => p.text).join(""),
    parts,
    placeholders: parts.filter((p) => p.kind === "placeholder").map((p) => p.name)
  };
}

const MAX_TOKENS = 8;

function templateArb(names = PLACEHOLDER_NAMES) {
  const tokenArb = names.length > 0
    ? fc.oneof(
      { weight: 3, arbitrary: fc.constantFrom(...names).map(placeholderPart) },
      { weight: 1, arbitrary: unknownPartArb }
    )
    : unknownPartArb;

  return fc
    .tuple(
      fc.array(tokenArb, { minLength: 1, maxLength: MAX_TOKENS }),
      fc.array(proseArb, { minLength: MAX_TOKENS + 1, maxLength: MAX_TOKENS + 1 })
    )
    .map(([tokens, proses]) => {
      const parts = [];
      for (let i = 0; i < tokens.length; i++) {
        let prose = proses[i];
        // Two Placeholders must not be joined by nothing or only "," / ".".
        if (i > 0 && tokens[i - 1].kind === "placeholder" && tokens[i].kind === "placeholder" &&
            /^[,.]*$/.test(prose)) {
          prose = " " + prose;
        }
        if (prose !== "") parts.push({ kind: "prose", text: prose });
        parts.push(tokens[i]);
      }
      const tail = proses[tokens.length];
      if (tail !== "") parts.push({ kind: "prose", text: tail });
      return makeTemplate(parts);
    });
}

function recordWithTemplateArb(options = {}) {
  return recordArb(options).chain((record) => {
    const flat = flatten(record);
    return templateArb(fillablePlaceholders(flat)).map((t) => ({ record, flat, ...t }));
  });
}

// Insert extra parts at part boundaries. inserts: [[part, seed], ...]; each
// part goes at index seed % (current length + 1). Returns a new array.
function insertParts(parts, inserts) {
  const out = parts.slice();
  for (const [part, seed] of inserts) {
    out.splice(seed % (out.length + 1), 0, part);
  }
  return out;
}

module.exports = {
  ABSENT,
  dropAbsent,
  toPlain,
  safeStringArb,
  proseArb,
  finiteNumberArb,
  moneyArb,
  savesArb,
  validFixArb,
  anyFixArb,
  validPriceArb,
  invalidPriceArb,
  validEstimateArb,
  recordArb,
  placeholderFlatArb,
  unknownPartArb,
  templateArb,
  recordWithTemplateArb,
  makeTemplate,
  insertParts,
  fillablePlaceholders,
  renderValue,
  expectedFill
};
