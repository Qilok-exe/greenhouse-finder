"use strict";
// Unit tests for agents/precompute.js (Requirements 5.3, 5.5).
// Every run writes into fs.mkdtemp directories; the real agents/cache/ is only read.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const precompute = require("../precompute.js");
const novaApi = require("../nova_api.js");

const AGENTS_DIR = path.join(__dirname, "..");
const REAL_RULEBOOK = path.join(AGENTS_DIR, "rulebook.pdf");
const COMMITTED_JSON = path.join(AGENTS_DIR, "cache", precompute.MANIFEST_JSON);
const COMMITTED_JS = path.join(AGENTS_DIR, "cache", precompute.MANIFEST_JS);

const FAKE_MODEL_ID = "test-model";
const FAKE_PDF = Buffer.from("%PDF-1.4 fake rulebook for precompute tests\n");

const SECTIONS_JSON = JSON.stringify({
  sections: [
    { name: "Project Narrative", criteria: ["Describes the problem", "States the goal"] },
    { name: "Budget", criteria: [] }
  ]
});
const TEMPLATES = {
  "Project Narrative": "{name} in {town} will install {top_fix_name}.",
  Budget: "The project costs {top_fix_cost_usd}; we request {grant_request} and pay {farmer_match}."
};

// Temp root with a fake rulebook, a cache dir and a separate manifest dir.
async function withTempRoot(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gw-precompute-"));
  try {
    const rulebookPath = path.join(root, "rulebook.pdf");
    await fs.writeFile(rulebookPath, FAKE_PDF);
    return await fn({
      root,
      rulebookPath,
      cacheDir: path.join(root, "cache"),
      manifestDir: path.join(root, "manifest")
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// Fake Nova: extraction returns SECTIONS_JSON, each Template comes from TEMPLATES
// by Section name unless overridden.
function fakeNova(overrides = {}) {
  const calls = { ask: 0, askWithPdf: 0 };
  return {
    calls,
    askWithPdf: overrides.askWithPdf || (async () => { calls.askWithPdf += 1; return SECTIONS_JSON; }),
    ask: overrides.ask || (async (prompt) => {
      calls.ask += 1;
      const name = Object.keys(TEMPLATES).find((n) => prompt.includes(n));
      return TEMPLATES[name];
    })
  };
}

async function listDir(dir) {
  try {
    return (await fs.readdir(dir)).sort();
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function tmpFiles(...dirs) {
  const out = [];
  for (const dir of dirs) {
    for (const f of await listDir(dir)) if (f.endsWith(".tmp")) out.push(path.join(dir, f));
  }
  return out;
}

const OLD_JSON = Buffer.from("{\"old\": \"manifest\"}\n");
const OLD_JS = Buffer.from("window.AGENT_CACHE = {\"old\": \"manifest\"};\n");

async function writeOldManifests(manifestDir) {
  await fs.mkdir(manifestDir, { recursive: true });
  await fs.writeFile(path.join(manifestDir, precompute.MANIFEST_JSON), OLD_JSON);
  await fs.writeFile(path.join(manifestDir, precompute.MANIFEST_JS), OLD_JS);
}

async function assertOldManifestsIntact(manifestDir) {
  const json = await fs.readFile(path.join(manifestDir, precompute.MANIFEST_JSON));
  const js = await fs.readFile(path.join(manifestDir, precompute.MANIFEST_JS));
  assert.ok(json.equals(OLD_JSON), "manifest.json changed");
  assert.ok(js.equals(OLD_JS), "manifest.js changed");
  assert.deepEqual(await listDir(manifestDir), [precompute.MANIFEST_JS, precompute.MANIFEST_JSON].sort());
}

// Saves and clears the Nova environment so nova_api runs in Mock_Mode against
// agents/cache/mock; restores everything afterwards.
function enterMockMode(t) {
  const saved = {
    token: process.env.AWS_BEARER_TOKEN_BEDROCK,
    mockDir: process.env.NOVA_MOCK_DIR
  };
  delete process.env.AWS_BEARER_TOKEN_BEDROCK;
  delete process.env.NOVA_MOCK_DIR;
  novaApi.setMockDir(null);
  t.mock.method(console, "log", () => {});
  t.after(() => {
    novaApi.setMockDir(null);
    if (saved.token === undefined) delete process.env.AWS_BEARER_TOKEN_BEDROCK;
    else process.env.AWS_BEARER_TOKEN_BEDROCK = saved.token;
    if (saved.mockDir === undefined) delete process.env.NOVA_MOCK_DIR;
    else process.env.NOVA_MOCK_DIR = saved.mockDir;
  });
}

// ---------------------------------------------------------------------------
// Successful run
// ---------------------------------------------------------------------------

test("a successful run writes manifest.json and manifest.js with the documented shape", async () => {
  await withTempRoot(async ({ rulebookPath, cacheDir, manifestDir }) => {
    const nova = fakeNova();
    const manifest = await precompute.run({
      rulebookPath, cacheDir, manifestDir,
      ask: nova.ask, askWithPdf: nova.askWithPdf,
      modelId: FAKE_MODEL_ID, log: () => {}
    });

    const jsonText = await fs.readFile(path.join(manifestDir, precompute.MANIFEST_JSON), "utf8");
    const jsText = await fs.readFile(path.join(manifestDir, precompute.MANIFEST_JS), "utf8");

    const expected = {
      model_id: FAKE_MODEL_ID,
      rulebook_sha256: crypto.createHash("sha256").update(FAKE_PDF).digest("hex"),
      sections: [
        { name: "Project Narrative", criteria: ["Describes the problem", "States the goal"], template: TEMPLATES["Project Narrative"] },
        { name: "Budget", criteria: [], template: TEMPLATES.Budget }
      ]
    };
    assert.deepEqual(JSON.parse(jsonText), expected);
    assert.deepEqual(Object.keys(JSON.parse(jsonText)), ["model_id", "rulebook_sha256", "sections"]);
    assert.deepEqual(manifest, expected);

    assert.ok(jsonText.endsWith("}\n"));
    assert.equal(jsText, "window.AGENT_CACHE = " + jsonText.slice(0, -1) + ";\n");
    assert.deepEqual(nova.calls, { askWithPdf: 1, ask: 2 });
    assert.deepEqual(await tmpFiles(cacheDir, manifestDir), []);
  });
});

test("a successful run replaces a pre-existing manifest", async () => {
  await withTempRoot(async ({ rulebookPath, cacheDir, manifestDir }) => {
    await writeOldManifests(manifestDir);
    const nova = fakeNova();
    const manifest = await precompute.run({
      rulebookPath, cacheDir, manifestDir,
      ask: nova.ask, askWithPdf: nova.askWithPdf,
      modelId: FAKE_MODEL_ID, log: () => {}
    });
    const jsonText = await fs.readFile(path.join(manifestDir, precompute.MANIFEST_JSON), "utf8");
    assert.equal(jsonText, precompute.manifestJsonText(manifest));
    assert.equal(
      await fs.readFile(path.join(manifestDir, precompute.MANIFEST_JS), "utf8"),
      precompute.manifestJsText(manifest)
    );
  });
});

// ---------------------------------------------------------------------------
// Failing runs write no manifest (5.3)
// ---------------------------------------------------------------------------

const FAILURES = [
  {
    name: "missing rulebook",
    message: /rulebook\.pdf.*missing|missing.*rulebook\.pdf/,
    setup: async ({ rulebookPath }) => { await fs.unlink(rulebookPath); },
    options: () => {
      const nova = fakeNova();
      return { nova, ask: nova.ask, askWithPdf: nova.askWithPdf };
    },
    expectCalls: { askWithPdf: 0, ask: 0 }
  },
  {
    name: "ask throws",
    message: /ThrottlingException/,
    options: () => {
      const nova = fakeNova({ ask: async () => { throw new Error("ThrottlingException: Rate exceeded"); } });
      return { nova, ask: nova.ask, askWithPdf: nova.askWithPdf };
    }
  },
  {
    name: "rejected Template",
    message: /Budget/,
    options: () => {
      const nova = fakeNova({
        ask: async (prompt) => (prompt.includes("Budget") ? "It costs 5000 dollars." : TEMPLATES["Project Narrative"])
      });
      return { nova, ask: nova.ask, askWithPdf: nova.askWithPdf };
    }
  }
];

for (const failure of FAILURES) {
  test(`a failing run (${failure.name}) writes no manifest and leaves the old one byte-identical`, async () => {
    await withTempRoot(async (dirs) => {
      const { rulebookPath, cacheDir, manifestDir } = dirs;
      if (failure.setup) await failure.setup(dirs);
      await writeOldManifests(manifestDir);
      const { nova, ask, askWithPdf } = failure.options();

      await assert.rejects(
        precompute.run({ rulebookPath, cacheDir, manifestDir, ask, askWithPdf, modelId: FAKE_MODEL_ID, log: () => {} }),
        (e) => failure.message.test(e.message)
      );
      await assertOldManifestsIntact(manifestDir);
      assert.deepEqual(await tmpFiles(cacheDir, manifestDir), []);
      if (failure.expectCalls) assert.deepEqual(nova.calls, failure.expectCalls);
    });
  });

  test(`a failing run (${failure.name}) with no prior manifest writes neither file`, async () => {
    await withTempRoot(async (dirs) => {
      const { rulebookPath, cacheDir, manifestDir } = dirs;
      if (failure.setup) await failure.setup(dirs);
      const { ask, askWithPdf } = failure.options();
      await assert.rejects(
        precompute.run({ rulebookPath, cacheDir, manifestDir, ask, askWithPdf, modelId: FAKE_MODEL_ID, log: () => {} })
      );
      assert.deepEqual(await listDir(manifestDir), []);
      assert.deepEqual(await tmpFiles(cacheDir), []);
    });
  });
}

test("a failing run (missing mock file) names the mock path and writes no manifest", async (t) => {
  enterMockMode(t);
  await withTempRoot(async ({ root, rulebookPath, cacheDir, manifestDir }) => {
    const emptyMockDir = path.join(root, "mock");
    await fs.mkdir(emptyMockDir);
    novaApi.setMockDir(emptyMockDir);
    await writeOldManifests(manifestDir);

    await assert.rejects(
      precompute.run({ rulebookPath, cacheDir, manifestDir, log: () => {} }),
      (e) => e.message.includes("Mock response missing: " + emptyMockDir)
    );
    await assertOldManifestsIntact(manifestDir);
    assert.deepEqual(await listDir(cacheDir), []);
  });
});

test("a failure while writing the second tmp file leaves the old manifest intact and no tmp files", async () => {
  await withTempRoot(async ({ rulebookPath, cacheDir, manifestDir }) => {
    await writeOldManifests(manifestDir);
    const failingFs = {
      ...fs,
      writeFile: async (file, ...rest) => {
        if (String(file) === path.join(manifestDir, precompute.MANIFEST_JS + ".tmp")) {
          throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
        }
        return fs.writeFile(file, ...rest);
      }
    };
    const nova = fakeNova();
    await assert.rejects(
      precompute.run({
        rulebookPath, cacheDir, manifestDir,
        ask: nova.ask, askWithPdf: nova.askWithPdf,
        modelId: FAKE_MODEL_ID, log: () => {}, fs: failingFs
      }),
      (e) => e.message.includes("Manifest write failed") && e.message.includes("ENOSPC")
    );
    await assertOldManifestsIntact(manifestDir);
    assert.deepEqual(await tmpFiles(cacheDir, manifestDir), []);
  });
});

// ---------------------------------------------------------------------------
// Mock run: committed output, then zero Nova calls on a second run (5.5)
// ---------------------------------------------------------------------------

test("the mock run reproduces the committed manifest; a second run makes zero Nova calls with byte-identical output", async (t) => {
  enterMockMode(t);
  assert.equal(novaApi.isMockMode(), true);
  assert.equal(novaApi.getMockDir(), novaApi.DEFAULT_MOCK_DIR);

  await withTempRoot(async ({ cacheDir, manifestDir }) => {
    let calls = 0;
    const ask = (prompt) => { calls += 1; return novaApi.askNova(prompt); };
    const askWithPdf = (prompt, bytes) => { calls += 1; return novaApi.askNovaWithPdf(prompt, bytes); };
    const options = { rulebookPath: REAL_RULEBOOK, cacheDir, manifestDir, ask, askWithPdf, log: () => {} };
    const jsonFile = path.join(manifestDir, precompute.MANIFEST_JSON);
    const jsFile = path.join(manifestDir, precompute.MANIFEST_JS);

    // Run 1: empty cache, one extraction plus one Template per Section.
    const manifest1 = await precompute.run(options);
    assert.equal(manifest1.sections.length, 5);
    assert.equal(calls, 1 + manifest1.sections.length);
    const json1 = await fs.readFile(jsonFile);
    const js1 = await fs.readFile(jsFile);
    assert.ok(json1.equals(await fs.readFile(COMMITTED_JSON)), "manifest.json differs from agents/cache/manifest.json");
    assert.ok(js1.equals(await fs.readFile(COMMITTED_JS)), "manifest.js differs from agents/cache/manifest.js");

    const rulebookSha = crypto.createHash("sha256").update(await fs.readFile(REAL_RULEBOOK)).digest("hex");
    assert.equal(manifest1.rulebook_sha256, rulebookSha);
    assert.equal(manifest1.model_id, novaApi.MODEL_ID);
    assert.equal((await listDir(cacheDir)).filter((f) => f.endsWith(".json")).length, 6);

    // Run 2: same cache, every request is a hit.
    calls = 0;
    const manifest2 = await precompute.run(options);
    assert.equal(calls, 0);
    assert.deepEqual(manifest2, manifest1);
    assert.ok((await fs.readFile(jsonFile)).equals(json1), "second manifest.json is not byte-identical");
    assert.ok((await fs.readFile(jsFile)).equals(js1), "second manifest.js is not byte-identical");
    assert.deepEqual(await tmpFiles(cacheDir, manifestDir), []);
  });
});
