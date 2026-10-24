"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");

const {
  GRANT_SHARE,
  GRANT_CAP_USD,
  CO2_KG_PER_GALLON,
  PLACEHOLDER_NAMES,
  isUnknownMarkerInner,
  flatten,
  fill,
  validateTemplate
} = require("../grant_writer.js");

const {
  recordArb,
  placeholderFlatArb,
  templateArb,
  unknownPartArb,
  makeTemplate,
  insertParts,
  fillablePlaceholders,
  renderValue,
  expectedFill
} = require("./generators.js");

const RUNS = { numRuns: 100 };
const PLACEHOLDER_SET = new Set(PLACEHOLDER_NAMES);

// Reference model of the Derived_Fields, written from the derivation table in
// design.md (Data Models) and Requirement 3.2 to 3.5.
function referenceDerived(record) {
  const out = {};
  const est = record.estimate;
  if (est !== null && typeof est === "object" && !Array.isArray(est)) {
    for (const k of ["low", "high", "point"]) {
      if (est[k] !== undefined) out["estimate_" + k] = est[k];
    }
  }

  const fixes = record.fixes;
  const fixesValid = Array.isArray(fixes) && fixes.length > 0 && fixes.every(
    (f) => f !== null && typeof f === "object" && !Array.isArray(f) &&
      typeof f.saves_usd === "number" && Number.isFinite(f.saves_usd) &&
      typeof f.cost_usd === "number" && Number.isFinite(f.cost_usd)
  );
  if (!fixesValid) return out;

  const max = Math.max(...fixes.map((f) => f.saves_usd));
  const top = fixes[fixes.findIndex((f) => f.saves_usd === max)];
  if (top.name !== undefined) out.top_fix_name = top.name;
  out.top_fix_saves_usd = top.saves_usd;
  out.top_fix_cost_usd = top.cost_usd;
  if (top.payback_years !== undefined) out.top_fix_payback_years = top.payback_years;
  out.grant_request = Math.round(Math.min(GRANT_SHARE * top.cost_usd, GRANT_CAP_USD));
  out.farmer_match = Math.round(top.cost_usd) - out.grant_request;

  const p = record.price_per_gal;
  if (typeof p === "number" && Number.isFinite(p) && p > 0) {
    out.gallons_saved = Math.round(top.saves_usd / p);
    out.carbon_tons_saved = Math.round(out.gallons_saved * CO2_KG_PER_GALLON / 1000 * 10) / 10;
  }
  return out;
}

// Remove one occurrence of each expected offender from `offending`; fail if
// any is missing. Order is not asserted (offenders are grouped by kind).
function assertContainsAll(offending, expected, context) {
  const pool = offending.slice();
  for (const e of expected) {
    const i = pool.indexOf(e);
    assert.ok(i !== -1, `offender ${JSON.stringify(e)} missing from ${JSON.stringify(offending)} for ${context}`);
    pool.splice(i, 1);
  }
}

// A Flat_Record with a template that only references fillable Placeholders.
const fillCaseArb = fc
  .oneof(recordArb().map(flatten), placeholderFlatArb)
  .chain((flat) => templateArb(fillablePlaceholders(flat)).map((t) => ({ flat, ...t })));

// Feature: grant-writer, Property 1: Top_Fix and grant split
// **Validates: Requirements 3.3, 3.6**
test("Property 1: Top_Fix is the earliest max saves_usd and the grant split adds up", () => {
  fc.assert(
    fc.property(recordArb({ fixes: "validNonEmpty" }), (record) => {
      const flat = flatten(record);
      const max = Math.max(...record.fixes.map((f) => f.saves_usd));
      const earliest = record.fixes[record.fixes.findIndex((f) => f.saves_usd === max)];

      assert.ok(flat.top_fix_saves_usd === max, `top_fix_saves_usd ${flat.top_fix_saves_usd} != max ${max}`);
      assert.ok(flat.top_fix_cost_usd === earliest.cost_usd, "Top_Fix is not the earliest max");
      assert.equal(flat.top_fix_name, earliest.name);
      assert.ok(flat.top_fix_payback_years === earliest.payback_years);
      assert.ok(flat.grant_request <= GRANT_CAP_USD, `grant_request ${flat.grant_request} over cap`);
      assert.ok(
        flat.grant_request + flat.farmer_match === Math.round(flat.top_fix_cost_usd),
        `${flat.grant_request} + ${flat.farmer_match} != round(${flat.top_fix_cost_usd})`
      );
    }),
    RUNS
  );
});

// Feature: grant-writer, Property 2: flatten matches the derivation table
// **Validates: Requirements 3.2, 3.3, 3.4, 3.5**
test("Property 2: flatten equals the Record plus the reference Derived_Fields", () => {
  fc.assert(
    fc.property(recordArb(), (record) => {
      const expected = { ...record, ...referenceDerived(record) };
      assert.deepEqual(flatten(record), expected);
    }),
    { numRuns: 300 }
  );
});

// Feature: grant-writer, Property 4: fill completeness
// **Validates: Requirements 3.7, 3.11**
test("Property 4: fill leaves zero Placeholders and puts each formatted value in place", () => {
  fc.assert(
    fc.property(fillCaseArb, ({ flat, template, parts }) => {
      const out = fill(template, flat);

      // The only brace tokens left are Unknown_Markers.
      for (const m of out.matchAll(/\{([^{}]*)\}/g)) {
        assert.ok(!PLACEHOLDER_SET.has(m[1]), `Placeholder ${m[0]} left in output`);
        assert.ok(isUnknownMarkerInner(m[1]), `unexpected token ${m[0]} in output`);
      }
      // Each Placeholder position holds the formatted value of its key.
      assert.equal(out, expectedFill(parts, flat));
    }),
    RUNS
  );
});

// Feature: grant-writer, Property 5: Unknown_Markers and prose preserved
// **Validates: Requirements 3.9**
test("Property 5: fill keeps prose and Unknown_Markers exactly, in order", () => {
  fc.assert(
    fc.property(fillCaseArb, ({ flat, template, parts }) => {
      const out = fill(template, flat);

      // Walk the output: skip each filled value, and require every prose
      // segment and Unknown_Marker character for character at its position.
      let pos = 0;
      for (const p of parts) {
        const piece = p.kind === "placeholder" ? renderValue(flat[p.name]) : p.text;
        assert.ok(
          out.startsWith(piece, pos),
          `${p.kind} ${JSON.stringify(piece)} not found at ${pos} in ${JSON.stringify(out)}`
        );
        pos += piece.length;
      }
      assert.equal(pos, out.length, "output has extra text");

      // The Unknown_Markers in the output are the Template's, in order.
      const markersIn = parts.filter((p) => p.kind === "unknown").map((p) => p.text);
      const markersOut = [...out.matchAll(/\{[^{}]*\}/g)].map((m) => m[0]);
      assert.deepEqual(markersOut, markersIn);
    }),
    RUNS
  );
});

// Bad brace tokens for fill: not a Placeholder and not an Unknown_Marker.
const identArb = fc.stringMatching(/^[a-z_]{1,10}$/);
const badInnerArb = fc
  .oneof(
    fc.constantFrom(
      "bays", "fixes", "estimate", "evidence", "estimate.low", "estimate.point",
      "evidence.quote_uploaded", "fixes.name", "top_fix", "UNKNOWN:", "UNKNOWN: ",
      "UNKNOWN:\n", "", " sqft", "SQFT", "unknown: program", "fixes[0].name"
    ),
    fc.tuple(identArb, identArb).map(([a, b]) => a + "." + b),
    identArb
  )
  .filter((inner) => !PLACEHOLDER_SET.has(inner) && !isUnknownMarkerInner(inner));

// A Placeholder whose Flat_Record value is made invalid.
const BAD_VALUES = [null, undefined, {}, [], { low: 1 }, ["a"]];
const badValueArb = fc.record({
  name: fc.constantFrom(...PLACEHOLDER_NAMES),
  how: fc.oneof(fc.constant("delete"), fc.constantFrom(...BAD_VALUES.keys()))
});

const fillInjectionArb = fc.oneof(
  badInnerArb.map((inner) => ({ type: "token", text: "{" + inner + "}" })),
  badValueArb.map(({ name, how }) => ({ type: "value", name, how, text: "{" + name + "}" }))
);

// Feature: grant-writer, Property 6: fill rejects bad tokens
// **Validates: Requirements 3.5, 3.8**
test("Property 6: fill throws one error naming every bad token", () => {
  fc.assert(
    fc.property(
      fillCaseArb,
      fc.array(fc.tuple(fillInjectionArb, fc.nat()), { minLength: 1, maxLength: 5 }),
      ({ flat, parts }, injections) => {
        const badFlat = { ...flat };
        for (const [inj] of injections) {
          if (inj.type !== "value") continue;
          if (inj.how === "delete") delete badFlat[inj.name];
          else badFlat[inj.name] = BAD_VALUES[inj.how];
        }
        const inserts = injections.map(([inj, seed]) => [{ kind: "bad", text: inj.text }, seed]);
        const { template } = makeTemplate(insertParts(parts, inserts));

        let result;
        let error = null;
        try {
          result = fill(template, badFlat);
        } catch (e) {
          error = e;
        }
        assert.ok(error instanceof Error, `fill returned ${JSON.stringify(result)} for ${JSON.stringify(template)}`);
        for (const [inj] of injections) {
          assert.ok(
            error.message.includes(inj.text),
            `${JSON.stringify(inj.text)} not named in ${JSON.stringify(error.message)}`
          );
        }
      }
    ),
    RUNS
  );
});

// Feature: grant-writer, Property 7: flatten and fill are pure
// **Validates: Requirements 3.12**
test("Property 7: flatten and fill are deterministic and modify nothing", () => {
  const anyTemplateArb = fc.oneof(
    templateArb(),
    fc
      .tuple(templateArb(), fc.array(fc.tuple(badInnerArb, fc.nat()), { maxLength: 3 }))
      .map(([t, bad]) =>
        makeTemplate(insertParts(t.parts, bad.map(([inner, seed]) => [{ kind: "bad", text: "{" + inner + "}" }, seed])))
      )
  );

  function runFill(template, flat) {
    try {
      return { ok: true, value: fill(template, flat) };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  fc.assert(
    fc.property(recordArb(), anyTemplateArb, (record, { template }) => {
      const recordBefore = structuredClone(record);
      const templateBefore = template;

      const flat1 = flatten(record);
      const flat2 = flatten(record);
      assert.deepEqual(flat1, flat2);
      assert.deepEqual(record, recordBefore);

      const flatBefore = structuredClone(flat1);
      const r1 = runFill(template, flat1);
      const r2 = runFill(template, flat1);
      assert.deepEqual(r1, r2);
      assert.deepEqual(flat1, flatBefore);
      assert.deepEqual(record, recordBefore);
      assert.equal(template, templateBefore);
    }),
    RUNS
  );
});

// Injections for validateTemplate, each with the offenders it must produce.
const ADJACENT_SEPARATORS = ["", ",", ".", ",,", ".,", ",."];
const validateInjectionArb = fc.oneof(
  // Digits: one offender per digit character.
  fc.stringMatching(/^[0-9]{1,4}$/).map((d) => ({ text: d, expected: [...d] })),
  // Non-Placeholder token ({bays}, dotted paths, empty Unknown_Marker, ...).
  badInnerArb
    .filter((inner) => !/[0-9]/.test(inner))
    .map((inner) => ({ text: "{" + inner + "}", expected: ["{" + inner + "}"] })),
  // Stray "{" directly before a valid Unknown_Marker.
  unknownPartArb.map((u) => ({ text: "{" + u.text, expected: ["{"] })),
  // Stray "}" directly after a valid Unknown_Marker.
  unknownPartArb.map((u) => ({ text: u.text + "}", expected: ["}"] })),
  // Two Placeholders joined by nothing or only "," / ".".
  fc
    .tuple(fc.constantFrom(...PLACEHOLDER_NAMES), fc.constantFrom(...ADJACENT_SEPARATORS), fc.constantFrom(...PLACEHOLDER_NAMES))
    .map(([a, sep, b]) => {
      const text = "{" + a + "}" + sep + "{" + b + "}";
      return { text, expected: [text] };
    })
);

const validateCaseArb = fc.oneof(
  { weight: 1, arbitrary: templateArb().map((t) => ({ template: t.template, expected: [] })) },
  {
    weight: 4,
    arbitrary: fc
      .tuple(templateArb(), fc.array(fc.tuple(validateInjectionArb, fc.nat()), { minLength: 1, maxLength: 5 }))
      .map(([t, injections]) => ({
        template: makeTemplate(insertParts(t.parts, injections.map(([inj, seed]) => [{ kind: "bad", text: inj.text }, seed]))).template,
        expected: injections.flatMap(([inj]) => inj.expected)
      }))
  },
  {
    weight: 1,
    arbitrary: fc
      .string({ unit: fc.constantFrom(" ", "\n", "\t", "\r"), maxLength: 6 })
      .map((ws) => ({ template: ws, expected: ["empty template"] }))
  }
);

// Feature: grant-writer, Property 8: Template validation
// **Validates: Requirements 2.2, 2.3**
test("Property 8: validateTemplate accepts clean Templates and lists every injected offender", () => {
  fc.assert(
    fc.property(validateCaseArb, ({ template, expected }) => {
      const res = validateTemplate(template);
      const context = JSON.stringify(template);
      if (expected.length === 0) {
        assert.equal(res.ok, true, `rejected clean template ${context}: ${JSON.stringify(res.offending)}`);
        assert.deepEqual(res.offending, []);
      } else {
        assert.equal(res.ok, false, `accepted ${context}`);
        assertContainsAll(res.offending, expected, context);
      }
    }),
    { numRuns: 300 }
  );
});
