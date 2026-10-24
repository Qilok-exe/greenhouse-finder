"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");

const { formatNumber, NUMBER_RE } = require("../format.js");

// Parse a NUMBER_RE token back to a number: drop currency, grouping commas
// and percent sign, then Number().
function parseToken(token) {
  return Number(token.replace(/[$€£,%]/g, ""));
}

// Finite numbers across the whole double range, plus the values the app
// actually formats (integers, money with cents, coordinates) and -0.
const finiteNumber = fc.oneof(
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
  fc.integer({ min: -100000000, max: 100000000 }).map((c) => c / 100),
  fc.double({ min: -180, max: 180, noNaN: true }),
  fc.constantFrom(0, -0, 1e-7, 1.5e21, Number.MAX_VALUE, Number.MIN_VALUE, -Number.MAX_VALUE)
);

// Feature: grant-writer, Property 3: Number formatting round trip
// **Validates: Requirements 3.10, 4.1**
test("Property 3: formatNumber output is one NUMBER_RE token that parses back to |n|", () => {
  fc.assert(
    fc.property(finiteNumber, (n) => {
      const out = formatNumber(n);

      // "-" prefix exactly for negatives (-0 formats as "0").
      assert.equal(out.startsWith("-"), n < 0, `sign of ${JSON.stringify(out)} for ${n}`);
      const body = out.startsWith("-") ? out.slice(1) : out;

      const tokens = body.match(NUMBER_RE) || [];
      assert.deepEqual(tokens, [body], `${JSON.stringify(body)} is not exactly one token`);

      assert.ok(
        Object.is(parseToken(tokens[0]), Math.abs(n)),
        `${JSON.stringify(tokens[0])} parses to ${parseToken(tokens[0])}, expected ${Math.abs(n)}`
      );
    }),
    { numRuns: 200 }
  );
});
