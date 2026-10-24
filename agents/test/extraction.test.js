"use strict";
// Unit tests for Rulebook extraction and Template generation
// (agents/grant_writer.js extractSections, generateTemplates, buildTemplatePrompt).
// Requirements 1.4, 1.6, 1.7, 1.8, 2.3, 2.4, 5.4.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  RULEBOOK_PATH,
  EXTRACTION_PROMPT,
  PLACEHOLDER_NAMES,
  validateTemplate,
  extractSections,
  generateTemplates,
  buildTemplatePrompt
} = require("../grant_writer.js");
const { cachedCall, cacheKey, entryPath, DEFAULT_MODEL_ID } = require("../cache_store.js");

const REAL_RULEBOOK = path.join(__dirname, "..", "rulebook.pdf");

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gw-extraction-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// The real cachedCall, writing into cacheDir.
function realCachedCall(cacheDir) {
  return (opts) => cachedCall({ ...opts, cacheDir });
}

async function cacheFiles(dir) {
  return (await fs.readdir(dir)).sort();
}

const SECTIONS_JSON = JSON.stringify({
  sections: [
    { name: "Project Narrative", criteria: ["Describes the problem"] },
    { name: "Budget", criteria: [] }
  ]
});

const VALID_TEMPLATE = "We will install {top_fix_name} in {town} at a cost of {top_fix_cost_usd}.";

// ---------------------------------------------------------------------------
// extractSections
// ---------------------------------------------------------------------------

test("extractSections sends the full rulebook bytes, unmodified, in one askWithPdf call", async () => {
  const bytes = await fs.readFile(REAL_RULEBOOK);
  assert.ok(bytes.length > 0, "agents/rulebook.pdf should be non-empty for this test");
  const copy = Uint8Array.from(bytes);

  await withTempDir(async (cacheDir) => {
    const calls = [];
    const sections = await extractSections({
      readRulebook: () => fs.readFile(REAL_RULEBOOK),
      askWithPdf: async (prompt, pdfBytes) => {
        calls.push({ prompt, pdfBytes: Uint8Array.from(pdfBytes) });
        return SECTIONS_JSON;
      },
      cachedCall: realCachedCall(cacheDir)
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].prompt, EXTRACTION_PROMPT);
    assert.equal(calls[0].pdfBytes.length, copy.length);
    assert.deepEqual(calls[0].pdfBytes, copy);
    assert.deepEqual(sections, [
      { name: "Project Narrative", criteria: ["Describes the problem"] },
      { name: "Budget", criteria: [] }
    ]);
    // The cache entry is keyed by the full bytes.
    const file = entryPath(cacheKey(DEFAULT_MODEL_ID, EXTRACTION_PROMPT, copy), cacheDir);
    assert.deepEqual(await cacheFiles(cacheDir), [path.basename(file)]);
  });
});

test("extractSections passes arbitrary bytes (including zero bytes inside) through unchanged", async () => {
  const bytes = new Uint8Array(70000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) % 256;
  const copy = Uint8Array.from(bytes);
  let seen = null;
  await extractSections({
    readRulebook: async () => bytes,
    askWithPdf: async (_prompt, pdfBytes) => { seen = Uint8Array.from(pdfBytes); return SECTIONS_JSON; },
    cachedCall: async ({ call, validate }) => { const t = await call(); validate(t); return t; }
  });
  assert.deepEqual(seen, copy);
});

function noCallDeps(readRulebook) {
  const counts = { askWithPdf: 0, cachedCall: 0 };
  return {
    counts,
    deps: {
      readRulebook,
      askWithPdf: async () => { counts.askWithPdf += 1; return SECTIONS_JSON; },
      cachedCall: async (opts) => { counts.cachedCall += 1; return opts.call(); }
    }
  };
}

test("a missing rulebook (ENOENT) throws naming agents/rulebook.pdf and \"missing\" before any call", async () => {
  await withTempDir(async (dir) => {
    const absent = path.join(dir, "rulebook.pdf");
    const { counts, deps } = noCallDeps(() => fs.readFile(absent));
    await assert.rejects(extractSections(deps), (e) =>
      e.message.includes(RULEBOOK_PATH) && e.message.includes("missing"));
    assert.equal(RULEBOOK_PATH, "agents/rulebook.pdf");
    assert.deepEqual(counts, { askWithPdf: 0, cachedCall: 0 });
  });
});

test("an empty rulebook (zero bytes) throws naming agents/rulebook.pdf and \"empty\" before any call", async () => {
  await withTempDir(async (dir) => {
    const empty = path.join(dir, "rulebook.pdf");
    await fs.writeFile(empty, "");
    const { counts, deps } = noCallDeps(() => fs.readFile(empty));
    await assert.rejects(extractSections(deps), (e) =>
      e.message.includes("agents/rulebook.pdf") && e.message.includes("empty"));
    assert.deepEqual(counts, { askWithPdf: 0, cachedCall: 0 });
  });
});

test("a Nova error during extraction carries the Nova message and writes no cache entry", async () => {
  await withTempDir(async (cacheDir) => {
    const novaMsg = "ValidationException: The model returned an error";
    await assert.rejects(
      extractSections({
        readRulebook: async () => new Uint8Array([37, 80, 68, 70]),
        askWithPdf: async () => { throw new Error(novaMsg); },
        cachedCall: realCachedCall(cacheDir)
      }),
      (e) => e.message.includes(novaMsg)
    );
    assert.deepEqual(await cacheFiles(cacheDir), []);
  });
});

test("an unparseable extraction response throws \"no sections extracted\" and writes no cache entry", async () => {
  await withTempDir(async (cacheDir) => {
    for (const response of ["Here are the sections: Narrative, Budget", "{\"sections\":[]}"]) {
      await assert.rejects(
        extractSections({
          readRulebook: async () => new Uint8Array([37, 80, 68, 70]),
          askWithPdf: async () => response,
          cachedCall: realCachedCall(cacheDir)
        }),
        (e) => e.message.includes("no sections extracted")
      );
    }
    assert.deepEqual(await cacheFiles(cacheDir), []);
  });
});

// ---------------------------------------------------------------------------
// Template prompt (Requirement 2.4)
// ---------------------------------------------------------------------------

test("the Template prompt contains the 2.4 instructions and every Placeholder", () => {
  const prompt = buildTemplatePrompt({ name: "Project Narrative", criteria: ["Describes the problem"] });

  assert.ok(prompt.includes("Project Narrative"));
  assert.ok(prompt.includes("Describes the problem"));
  // No digits.
  assert.match(prompt, /never write a number/i);
  assert.match(prompt, /no digit/i);
  // Fixes only through top_fix_*.
  assert.match(prompt, /fixes only through the top_fix/i);
  for (const n of PLACEHOLDER_NAMES.filter((x) => x.startsWith("top_fix_"))) {
    assert.ok(prompt.includes("{" + n + "}"), "missing {" + n + "}");
  }
  // Unknown_Marker for program name, cost-share percentage, deadline, fuel price.
  assert.ok(prompt.includes("{UNKNOWN:"));
  for (const item of ["program name", "cost-share percentage", "deadline", "fuel price"]) {
    assert.ok(prompt.includes(item), "missing \"" + item + "\"");
  }
  for (const n of PLACEHOLDER_NAMES) {
    assert.ok(prompt.includes("{" + n + "}"), "missing {" + n + "}");
  }
  assert.ok(!prompt.includes("{bays}"));
});

test("generateTemplates sends exactly buildTemplatePrompt(section) to ask", async () => {
  const sections = [{ name: "Budget", criteria: ["Is reasonable"] }];
  const prompts = [];
  await generateTemplates(sections, {
    ask: async (p) => { prompts.push(p); return VALID_TEMPLATE; },
    cachedCall: async ({ call, validate }) => { const t = await call(); validate(t); return t; }
  });
  assert.deepEqual(prompts, [buildTemplatePrompt(sections[0])]);
});

// ---------------------------------------------------------------------------
// generateTemplates errors (Requirements 1.7, 2.3, 5.4)
// ---------------------------------------------------------------------------

test("a Nova error from ask carries the Nova message and the Section name", async () => {
  await withTempDir(async (cacheDir) => {
    const novaMsg = "ThrottlingException: Rate exceeded";
    const sections = [
      { name: "Project Narrative", criteria: [] },
      { name: "Budget Justification", criteria: ["Costs are itemised"] },
      { name: "Never Reached", criteria: [] }
    ];
    const asked = [];
    await assert.rejects(
      generateTemplates(sections, {
        ask: async (p) => {
          asked.push(p);
          if (asked.length === 2) throw new Error(novaMsg);
          return VALID_TEMPLATE;
        },
        cachedCall: realCachedCall(cacheDir)
      }),
      (e) => e.message.includes(novaMsg) && e.message.includes("Budget Justification")
    );
    assert.equal(asked.length, 2, "the run stops at the first error");
    // Only the first Section's accepted Template was cached.
    const first = entryPath(cacheKey(DEFAULT_MODEL_ID, buildTemplatePrompt(sections[0]), null), cacheDir);
    assert.deepEqual(await cacheFiles(cacheDir), [path.basename(first)]);
  });
});

test("a rejected Template throws with the Section name and every offender and writes no cache entry", async () => {
  await withTempDir(async (cacheDir) => {
    const bad = "Heating {bays} bays saves {top_fix_saves_usd} per year, about 30% of {fixes} and {estimate.low}.";
    const offending = validateTemplate(bad).offending;
    assert.deepEqual(offending, ["3", "0", "{bays}", "{fixes}", "{estimate.low}"]);

    const sections = [
      { name: "Project Narrative", criteria: [] },
      { name: "Energy Savings", criteria: ["Quantifies savings"] }
    ];
    const responses = [VALID_TEMPLATE, bad];
    let i = 0;
    await assert.rejects(
      generateTemplates(sections, {
        ask: async () => responses[i++],
        cachedCall: realCachedCall(cacheDir)
      }),
      (e) => e.message.includes("Energy Savings") && offending.every((o) => e.message.includes(o))
    );

    const goodFile = entryPath(cacheKey(DEFAULT_MODEL_ID, buildTemplatePrompt(sections[0]), null), cacheDir);
    const badFile = entryPath(cacheKey(DEFAULT_MODEL_ID, buildTemplatePrompt(sections[1]), null), cacheDir);
    const files = await cacheFiles(cacheDir);
    assert.deepEqual(files, [path.basename(goodFile)]);
    assert.ok(!files.includes(path.basename(badFile)));
  });
});
