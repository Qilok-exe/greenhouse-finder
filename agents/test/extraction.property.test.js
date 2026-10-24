"use strict";
// Property tests for Rulebook extraction parsing and Template generation
// (agents/grant_writer.js parseSections, generateTemplates).

const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");

const {
  PLACEHOLDER_NAMES,
  parseSections,
  generateTemplates
} = require("../grant_writer.js");

const { templateArb } = require("./generators.js");

const RUNS = { numRuns: 100 };

// cachedCall stand-in: always a miss, validates like the real one, writes nothing.
async function passThroughCachedCall({ call, validate }) {
  const t = await call();
  validate(t);
  return t;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// Characters String.prototype.trim removes.
const WS_CHARS = [" ", "\t", "\n", "\r", "\u00a0", "\u2003", "\u2028", "\ufeff"];
const wsArb = fc.string({ unit: fc.constantFrom(...WS_CHARS), maxLength: 4 });

// Text with JSON-special, fence and brace characters, plus full Unicode.
const NAME_CHARS = [
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  " ", "-", ":", ",", ".", "\"", "\\", "/", "`", "{", "}", "[", "]", "\n", "\t", "é", "—"
];
const rawTextArb = fc.oneof(
  { weight: 4, arbitrary: fc.string({ unit: fc.constantFrom(...NAME_CHARS), maxLength: 30 }) },
  { weight: 2, arbitrary: fc.string({ unit: "grapheme", maxLength: 20 }) },
  { weight: 1, arbitrary: fc.string({ unit: "binary", maxLength: 20 }) },
  { weight: 1, arbitrary: fc.constantFrom("__proto__", "constructor", "toString", "```", "sections") }
);

// Already trimmed; a name is non-blank, a criterion may be empty.
const nameCoreArb = rawTextArb.map((s) => s.trim()).filter((s) => s !== "");
const criterionCoreArb = rawTextArb.map((s) => s.trim());

const sectionSpecArb = fc.record({
  name: nameCoreArb,
  namePadL: wsArb,
  namePadR: wsArb,
  criteria: fc.array(fc.record({ core: criterionCoreArb, padL: wsArb, padR: wsArb }), { maxLength: 4 }),
  omitEmptyCriteria: fc.boolean()
});

// Sections whose names are distinct after trimming.
const distinctSpecsArb = (minLength) =>
  fc.uniqueArray(sectionSpecArb, { selector: (s) => s.name, minLength, maxLength: 8 });

const formatArb = fc.record({
  wrap: fc.constantFrom("object", "array"),
  indent: fc.constantFrom(undefined, 2, "\t"),
  fence: fc.constantFrom(null, "```", "```json"),
  outerL: wsArb,
  outerR: wsArb
});

function toJsonSection(spec) {
  const out = { name: spec.namePadL + spec.name + spec.namePadR };
  if (!(spec.omitEmptyCriteria && spec.criteria.length === 0)) {
    out.criteria = spec.criteria.map((c) => c.padL + c.core + c.padR);
  }
  return out;
}

// Serialises raw JSON sections the way the model may answer.
function serialise(jsonSections, format) {
  const body = format.wrap === "array" ? jsonSections : { sections: jsonSections };
  let text = JSON.stringify(body, null, format.indent);
  if (format.fence !== null) text = format.fence + "\n" + text + "\n```";
  return format.outerL + text + format.outerR;
}

function expected(specs) {
  return specs.map((s) => ({ name: s.name, criteria: s.criteria.map((c) => c.core) }));
}

// ---------------------------------------------------------------------------
// Property 14
// ---------------------------------------------------------------------------

// Feature: grant-writer, Property 14: Section parsing
// **Validates: Requirements 1.5, 1.8**
test("Property 14: distinct non-blank Sections parse to trimmed names and criteria in order", () => {
  fc.assert(
    fc.property(distinctSpecsArb(1), formatArb, (specs, format) => {
      const text = serialise(specs.map(toJsonSection), format);
      assert.deepEqual(parseSections(text), expected(specs));
    }),
    RUNS
  );
});

// Feature: grant-writer, Property 14: Section parsing
// **Validates: Requirements 1.5, 1.8**
test("Property 14: a blank Section name throws naming the empty Section", () => {
  fc.assert(
    fc.property(distinctSpecsArb(0), wsArb, fc.nat(), formatArb, (specs, blank, pos, format) => {
      const sections = specs.map(toJsonSection);
      sections.splice(pos % (sections.length + 1), 0, { name: blank, criteria: [] });
      const text = serialise(sections, format);
      assert.throws(
        () => parseSections(text),
        (e) => e instanceof Error && /empty Section/.test(e.message)
      );
    }),
    RUNS
  );
});

// Feature: grant-writer, Property 14: Section parsing
// **Validates: Requirements 1.5, 1.8**
test("Property 14: a duplicated Section name throws naming the duplicated name", () => {
  fc.assert(
    fc.property(
      distinctSpecsArb(1), fc.nat(), fc.nat(), wsArb, wsArb, formatArb,
      (specs, iSeed, jSeed, padL, padR, format) => {
        const sections = specs.map(toJsonSection);
        const i = iSeed % specs.length;
        const dupName = specs[i].name;
        // Insert the copy after the original, so it is the first repeat.
        const j = i + 1 + (jSeed % (sections.length - i));
        sections.splice(j, 0, { name: padL + dupName + padR, criteria: [] });
        const text = serialise(sections, format);
        assert.throws(
          () => parseSections(text),
          (e) => e instanceof Error && e.message.includes(dupName)
        );
      }
    ),
    RUNS
  );
});

// Feature: grant-writer, Property 14: Section parsing
// **Validates: Requirements 1.8**
test("Property 14: unparseable JSON throws \"no sections extracted\"", () => {
  const notJsonArb = fc
    .oneof(rawTextArb, fc.string({ maxLength: 40 }))
    .filter((s) => {
      if (s.includes("`")) return false;
      try { JSON.parse(s); return false; } catch (_) { return true; }
    });
  fc.assert(
    fc.property(notJsonArb, (text) => {
      assert.throws(
        () => parseSections(text),
        (e) => e instanceof Error && e.message.includes("no sections extracted")
      );
    }),
    RUNS
  );
});

// Feature: grant-writer, Property 14: Section parsing (fixed examples)
// **Validates: Requirements 1.8**
test("Property 14: zero Sections or no sections array throws \"no sections extracted\"", () => {
  const cases = [
    "{\"sections\":[]}",
    "[]",
    "```json\n{\"sections\": []}\n```",
    "{}",
    "{\"sections\":null}",
    "{\"section\":[{\"name\":\"A\"}]}",
    "null",
    "42",
    "\"sections\"",
    "",
    "   "
  ];
  for (const text of cases) {
    assert.throws(
      () => parseSections(text),
      (e) => e instanceof Error && e.message.includes("no sections extracted"),
      "input: " + JSON.stringify(text)
    );
  }
});

// ---------------------------------------------------------------------------
// Property 15
// ---------------------------------------------------------------------------

const templateSectionArb = fc.record({
  name: rawTextArb,
  criteria: fc.array(rawTextArb, { maxLength: 4 })
});

// Feature: grant-writer, Property 15: One Template request per Section
// **Validates: Requirements 2.1**
test("Property 15: generateTemplates asks once per Section, in order, and keeps Section order", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.record({ section: templateSectionArb, tpl: templateArb() }), { maxLength: 6 }),
      async (items) => {
        const sections = items.map((it) => it.section);
        const prompts = [];
        const ask = async (prompt) => {
          const i = prompts.length;
          prompts.push(prompt);
          if (i >= items.length) throw new Error("ask called more often than there are Sections");
          return items[i].tpl.template;
        };

        const out = await generateTemplates(sections, { ask, cachedCall: passThroughCachedCall });

        assert.equal(prompts.length, sections.length);
        prompts.forEach((prompt, i) => {
          assert.ok(prompt.includes(sections[i].name), "prompt " + i + " lacks the Section name");
          for (const c of sections[i].criteria) {
            assert.ok(prompt.includes(c), "prompt " + i + " lacks criterion " + JSON.stringify(c));
          }
          for (const n of PLACEHOLDER_NAMES) {
            assert.ok(prompt.includes("{" + n + "}"), "prompt " + i + " lacks {" + n + "}");
          }
          const sectionText = [sections[i].name, ...sections[i].criteria].join("\n");
          if (!sectionText.includes("{bays}")) {
            assert.ok(!prompt.includes("{bays}"), "prompt " + i + " lists {bays}");
          }
        });
        assert.deepEqual(
          out,
          items.map((it) => ({ name: it.section.name, template: it.tpl.template.trim() }))
        );
      }
    ),
    RUNS
  );
});
