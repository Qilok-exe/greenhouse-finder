'use strict';
// Property tests for agents/cache_store.js (design Properties 16-18).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const fc = require('fast-check');

const { cacheKey, cachedCall } = require('../cache_store');

const RUNS = { numRuns: 100 };

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gw-cache-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// Recursive snapshot: relative path -> file contents (base64), or '<dir>'.
async function snapshot(root) {
  const out = {};
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full);
      if (e.isDirectory()) {
        out[rel] = '<dir>';
        await walk(full);
      } else {
        out[rel] = (await fs.readFile(full)).toString('base64');
      }
    }
  }
  await walk(root);
  return out;
}

// Any code point, including lone surrogates: JSON.stringify escapes them, so
// they must still round-trip byte-identically.
const anyText = fc.string({ unit: 'binary', maxLength: 40 });
const pdfArb = fc.option(fc.uint8Array({ maxLength: 32 }), { nil: null });
const requestArb = fc.record({ modelId: anyText, prompt: anyText, pdf: pdfArb });

function samePdf(a, b) {
  if (a === null || b === null) return a === b;
  return Buffer.from(a).equals(Buffer.from(b));
}

// Feature: grant-writer, Property 16: Cache_Key sensitivity
test('Property 16: Cache_Key sensitivity', () => {
  // Identical inputs (including fresh copies of the PDF bytes) give the same key.
  fc.assert(
    fc.property(requestArb, ({ modelId, prompt, pdf }) => {
      const copy = pdf === null ? null : Uint8Array.from(pdf);
      assert.equal(cacheKey(modelId, prompt, pdf), cacheKey(modelId, prompt, copy));
    }),
    RUNS,
  );

  // Changing exactly one of modelId, prompt or PDF changes the key.
  const mutated = fc
    .tuple(requestArb, fc.constantFrom('modelId', 'prompt', 'pdf'), anyText, pdfArb)
    .filter(([req, field, text, pdf]) => {
      if (field === 'pdf') return !samePdf(req.pdf, pdf);
      return req[field] !== text;
    });
  fc.assert(
    fc.property(mutated, ([req, field, text, pdf]) => {
      const other = { ...req };
      if (field === 'pdf') other.pdf = pdf;
      else other[field] = text;
      assert.notEqual(
        cacheKey(req.modelId, req.prompt, req.pdf),
        cacheKey(other.modelId, other.prompt, other.pdf),
      );
    }),
    RUNS,
  );

  // Two independent requests: keys are equal exactly when inputs are equal.
  fc.assert(
    fc.property(requestArb, requestArb, (a, b) => {
      const equalInputs = a.modelId === b.modelId && a.prompt === b.prompt && samePdf(a.pdf, b.pdf);
      const equalKeys = cacheKey(a.modelId, a.prompt, a.pdf) === cacheKey(b.modelId, b.prompt, b.pdf);
      assert.equal(equalKeys, equalInputs);
    }),
    RUNS,
  );

  // PDF absent versus empty.
  fc.assert(
    fc.property(anyText, anyText, (modelId, prompt) => {
      assert.notEqual(cacheKey(modelId, prompt, null), cacheKey(modelId, prompt, new Uint8Array(0)));
    }),
    RUNS,
  );
});

// Feature: grant-writer, Property 17: Cache hit and idempotence
test('Property 17: Cache hit and idempotence', async () => {
  const stepArb = fc.record({
    prompt: fc.string({ unit: 'binary', maxLength: 20 }),
    pdf: fc.option(fc.uint8Array({ maxLength: 8 }), { nil: null }),
    response: anyText,
  });
  await fc.assert(
    fc.asyncProperty(fc.array(stepArb, { minLength: 1, maxLength: 8 }), async (steps) => {
      await withTempDir(async (cacheDir) => {
        // Run 1: fake Nova answers each request with its generated response.
        const firstResponse = new Map();
        const run1 = [];
        let calls1 = 0;
        for (const s of steps) {
          const k = cacheKey('model-x', s.prompt, s.pdf);
          if (!firstResponse.has(k)) firstResponse.set(k, s.response);
          run1.push(
            await cachedCall({
              prompt: s.prompt,
              pdfBytes: s.pdf,
              modelId: 'model-x',
              cacheDir,
              call: async () => { calls1 += 1; return s.response; },
              validate: () => {},
            }),
          );
        }
        // Each distinct request reached Nova once and returned its own response.
        assert.equal(calls1, firstResponse.size);
        steps.forEach((s, i) => {
          assert.equal(run1[i], firstResponse.get(cacheKey('model-x', s.prompt, s.pdf)));
        });

        // Run 2: same requests, Nova must not be called.
        let calls2 = 0;
        const run2 = [];
        for (const s of steps) {
          run2.push(
            await cachedCall({
              prompt: s.prompt,
              pdfBytes: s.pdf === null ? null : Uint8Array.from(s.pdf),
              modelId: 'model-x',
              cacheDir,
              call: async () => { calls2 += 1; throw new Error('Nova must not be called on a hit'); },
              validate: () => {},
            }),
          );
        }
        assert.equal(calls2, 0);
        assert.deepEqual(
          run2.map((t) => Buffer.from(t, 'utf8')),
          run1.map((t) => Buffer.from(t, 'utf8')),
        );
        assert.deepEqual(run2, run1);
      });
    }),
    RUNS,
  );
});

// Feature: grant-writer, Property 18: Rejected responses are never cached
test('Property 18: Rejected responses are never cached', async () => {
  const failureArb = fc.constantFrom('nova-error', 'validator-throws', 'validator-false', 'validator-ok-false');
  const arb = fc
    .record({
      existing: fc.uniqueArray(fc.record({ prompt: anyText, response: anyText }), {
        maxLength: 4,
        selector: (e) => e.prompt,
      }),
      mockFile: fc.option(anyText, { nil: null }),
      prompt: anyText,
      pdf: pdfArb,
      response: anyText,
      failure: failureArb,
    })
    .filter((c) => c.pdf !== null || !c.existing.some((e) => e.prompt === c.prompt));

  await fc.assert(
    fc.asyncProperty(arb, async (c) => {
      await withTempDir(async (cacheDir) => {
        // Pre-populate valid entries and, optionally, a mock directory file.
        for (const e of c.existing) {
          await cachedCall({ prompt: e.prompt, cacheDir, call: async () => e.response, validate: () => {} });
        }
        if (c.mockFile !== null) {
          await fs.mkdir(path.join(cacheDir, 'mock'), { recursive: true });
          await fs.writeFile(path.join(cacheDir, 'mock', 'some.json'), c.mockFile, 'utf8');
        }
        const before = await snapshot(cacheDir);

        let novaCalls = 0;
        const call = async () => {
          novaCalls += 1;
          if (c.failure === 'nova-error') throw new Error('simulated Nova error');
          return c.response;
        };
        const validate = (text) => {
          if (c.failure === 'validator-throws') throw new Error('rejected');
          if (c.failure === 'validator-false') return false;
          if (c.failure === 'validator-ok-false') return { ok: false, offending: ['7'] };
          return text;
        };

        await assert.rejects(cachedCall({ prompt: c.prompt, pdfBytes: c.pdf, cacheDir, call, validate }));
        assert.equal(novaCalls, 1);
        assert.deepEqual(await snapshot(cacheDir), before);
      });
    }),
    RUNS,
  );
});
