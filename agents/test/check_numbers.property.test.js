"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const fc = require("fast-check");

const { checkNumbers } = require("../check_numbers.js");
const { flatten, fill, renderFixesTable, fixesTableText, FIXES_TABLE_HEADER, PENDING_QUOTE } = require("../grant_writer.js");
const { formatNumber, NUMBER_RE } = require("../format.js");
const { recordArb, recordWithTemplateArb, proseArb } = require("./generators.js");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// Parse a NUMBER_RE token: drop currency, grouping commas and percent sign.
function parseToken(token) {
  return Number(token.replace(/[$€£,%]/g, ""));
}

function tokensOf(s) {
  return s.match(new RegExp(NUMBER_RE.source, "g")) || [];
}

// Reference oracle for the Flat_Record values (Requirement 4.2): every finite
// number at any depth and every number token inside any string at any depth,
// as absolute values.
function referenceValues(flat) {
  const out = new Set();
  (function walk(v) {
    if (typeof v === "number") {
      if (Number.isFinite(v)) out.add(Math.abs(v));
    } else if (typeof v === "string") {
      for (const t of tokensOf(v)) out.add(Math.abs(parseToken(t)));
    } else if (v !== null && typeof v === "object") {
      for (const k of Object.keys(v)) walk(v[k]);
    }
  })(flat);
  return out;
}

// A bare four-digit year from 1900 to 2099 (Allowed_Number, Requirement 4.3).
function isAllowedYear(token) {
  return /^\d{4}$/.test(token) && Number(token) >= 1900 && Number(token) <= 2099;
}

// Digit-free prose that never contains the case-sensitive text "Section",
// so no inserted number is accidentally a section number.
const plainProseArb = proseArb.map((s) => s.replace(/Section/g, "section"));

// Join prose segments with tokens, each token surrounded by spaces so it
// stays one NUMBER_RE token on its own.
function interleave(proses, tokens) {
  let text = proses[0];
  for (let i = 0; i < tokens.length; i++) text += " " + tokens[i] + " " + proses[i + 1];
  return text;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Quote-dependent fields: a null/absent value shows PENDING_QUOTE, not UNKNOWN.
const QUOTE_FIELDS = new Set(["cost_usd", "payback_years"]);
// The cell renderFixesTable must produce for one field of one fixes element.
function expectedCell(fix, field) {
  const v = isPlainObject(fix) ? fix[field] : undefined;
  if (typeof v === "number" && Number.isFinite(v)) return formatNumber(v);
  if (typeof v === "string") return v;
  if (QUOTE_FIELDS.has(field) && (v === null || v === undefined)) return PENDING_QUOTE;
  return "{UNKNOWN: " + field + "}";
}

const FIX_FIELDS = ["name", "saves_usd", "cost_usd", "payback_years"];

// Fixture Records (Person A fixtures), flattened, used as fixed Flat_Records.
const FIXTURE_FLATS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "records.json"), "utf8")
).map(flatten);

// ---------------------------------------------------------------------------
// Property 9
// ---------------------------------------------------------------------------

// Feature: grant-writer, Property 9: Fill then check round trip
// **Validates: Requirements 4.2, 4.7**
test("Property 9: checkNumbers passes on fill(t, flatten(r)) for any accepted Template and covering Record", () => {
  fc.assert(
    fc.property(recordWithTemplateArb(), ({ record, template }) => {
      const flat = flatten(record);
      const text = fill(template, flat);
      const result = checkNumbers(text, flat);
      assert.deepEqual(result, { pass: true, rejected: [] },
        `filled text ${JSON.stringify(text)} rejected ${JSON.stringify(result.rejected)}`);
    }),
    { numRuns: 200 }
  );
});

// ---------------------------------------------------------------------------
// Property 10
// ---------------------------------------------------------------------------

// Feature: grant-writer, Property 10: Fixes_Table is copied and checks clean
// **Validates: Requirements 2.6, 4.8**
test("Property 10: renderFixesTable copies every fixes element in order and checks clean", () => {
  fc.assert(
    fc.property(recordArb(), (record) => {
      const rows = renderFixesTable(record);
      const fixes = Array.isArray(record.fixes) ? record.fixes : [];

      assert.equal(rows.length, 1 + fixes.length);
      assert.deepEqual(rows[0], [...FIXES_TABLE_HEADER]);
      fixes.forEach((fix, i) => {
        assert.deepEqual(rows[i + 1], FIX_FIELDS.map((f) => expectedCell(fix, f)), `row ${i + 1}`);
      });

      const text = fixesTableText(rows);
      const result = checkNumbers(text, flatten(record));
      assert.deepEqual(result, { pass: true, rejected: [] },
        `table ${JSON.stringify(text)} rejected ${JSON.stringify(result.rejected)}`);
    }),
    { numRuns: 200 }
  );
});

// ---------------------------------------------------------------------------
// Property 11
// ---------------------------------------------------------------------------

const intArb = fc.oneof(fc.nat({ max: 9999 }), fc.integer({ min: 0, max: 1000000000 }));

// One NUMBER_RE token: optional currency symbol, digits (bare or grouped),
// optional decimal part, optional percent sign.
const numberTokenArb = fc
  .tuple(
    fc.constantFrom("", "", "$", "€", "£"),
    fc.oneof(
      intArb.map(String),
      intArb.map(formatNumber),
      fc.tuple(intArb, fc.stringMatching(/^[0-9]{1,4}$/)).map(([i, f]) => formatNumber(i) + "." + f)
    ),
    fc.constantFrom("", "", "%")
  )
  .map(([cur, body, pct]) => cur + body + pct);

const flatForP11Arb = fc.oneof(
  fc.constant({}),
  fc.constantFrom(...FIXTURE_FLATS),
  recordArb().map(flatten)
);

// Feature: grant-writer, Property 11: Foreign numbers are rejected in order
// **Validates: Requirements 4.1, 4.4, 4.5**
test("Property 11: foreign numbers in digit-free prose are rejected as written, once per occurrence, in order", () => {
  const caseArb = flatForP11Arb.chain((flat) => {
    const values = referenceValues(flat);
    const foreignArb = numberTokenArb.filter(
      (t) => !values.has(Math.abs(parseToken(t))) && !isAllowedYear(t)
    );
    return fc.array(foreignArb, { maxLength: 6 }).chain((tokens) =>
      fc.record({
        flat: fc.constant(flat),
        tokens: fc.constant(tokens),
        proses: fc.array(plainProseArb, { minLength: tokens.length + 1, maxLength: tokens.length + 1 })
      })
    );
  });

  fc.assert(
    fc.property(caseArb, ({ flat, tokens, proses }) => {
      for (const t of tokens) {
        assert.deepEqual(tokensOf(t), [t], `generator bug: ${JSON.stringify(t)} is not one token`);
      }
      const text = interleave(proses, tokens);
      const result = checkNumbers(text, flat);
      assert.deepEqual(result, { pass: tokens.length === 0, rejected: tokens },
        `text ${JSON.stringify(text)}`);
    }),
    { numRuns: 200 }
  );
});

// ---------------------------------------------------------------------------
// Property 12
// ---------------------------------------------------------------------------

// Bare integers of any length (as decimal digits).
const bareIntegerArb = fc.oneof(
  fc.nat().map(String),
  fc.bigInt({ min: 0n, max: 10n ** 30n }).map(String)
);

// A four-digit bare value outside 1900..2099.
const outOfRangeFourDigitArb = fc
  .oneof(fc.integer({ min: 1000, max: 1899 }), fc.integer({ min: 2100, max: 9999 }))
  .map(String);

// A year-range value (or any integer) written with a separator, decimal
// point, currency symbol or percent sign.
const decoratedArb = fc
  .tuple(
    fc.oneof(fc.integer({ min: 1900, max: 2099 }), fc.integer({ min: 0, max: 1000000 })),
    fc.constantFrom("separator", "decimal", "currency", "percent"),
    fc.constantFrom("$", "€", "£"),
    fc.stringMatching(/^[0-9]{1,3}$/)
  )
  .filter(([n, kind]) => kind !== "separator" || n >= 1000)
  .map(([n, kind, cur, frac]) => {
    if (kind === "separator") return formatNumber(n);
    if (kind === "decimal") return String(n) + "." + frac;
    if (kind === "currency") return cur + String(n);
    return String(n) + "%";
  });

// Feature: grant-writer, Property 12: Allowed_Numbers
// **Validates: Requirements 4.3**
test("Property 12: bare years 1900-2099 and integers after 'Section ' are accepted against an empty Flat_Record", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1900, max: 2099 }),
      plainProseArb,
      plainProseArb,
      (year, a, b) => {
        const text = interleave([a, b], [String(year)]);
        assert.deepEqual(checkNumbers(text, {}), { pass: true, rejected: [] }, JSON.stringify(text));
      }
    ),
    { numRuns: 200 }
  );

  fc.assert(
    fc.property(bareIntegerArb, plainProseArb, plainProseArb, (n, a, b) => {
      const text = a + " Section " + n + " " + b;
      assert.deepEqual(checkNumbers(text, {}), { pass: true, rejected: [] }, JSON.stringify(text));
    }),
    { numRuns: 200 }
  );
});

// Feature: grant-writer, Property 12: Allowed_Numbers
// **Validates: Requirements 4.3**
test("Property 12: out-of-range four-digit values and decorated numbers are rejected against an empty Flat_Record", () => {
  fc.assert(
    fc.property(outOfRangeFourDigitArb, plainProseArb, plainProseArb, (token, a, b) => {
      const text = interleave([a, b], [token]);
      assert.deepEqual(checkNumbers(text, {}), { pass: false, rejected: [token] }, JSON.stringify(text));
    }),
    { numRuns: 200 }
  );

  fc.assert(
    fc.property(
      decoratedArb,
      fc.boolean(),
      plainProseArb,
      plainProseArb,
      (token, afterSection, a, b) => {
        assert.deepEqual(tokensOf(token), [token], `generator bug: ${JSON.stringify(token)}`);
        const text = afterSection
          ? a + " Section " + token + " " + b
          : interleave([a, b], [token]);
        assert.deepEqual(checkNumbers(text, {}), { pass: false, rejected: [token] }, JSON.stringify(text));
      }
    ),
    { numRuns: 200 }
  );
});
