'use strict';
// Unit tests for agents/cache_store.js failure paths (Requirements 5.6, 5.7).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { cacheKey, cachedCall, entryPath, DEFAULT_MODEL_ID } = require('../cache_store');

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gw-cache-unit-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('zero-byte cache entry throws naming the path and makes zero Nova calls', async () => {
  await withTempDir(async (cacheDir) => {
    const file = entryPath(cacheKey(DEFAULT_MODEL_ID, 'prompt', null), cacheDir);
    await fs.writeFile(file, '');
    let calls = 0;
    await assert.rejects(
      cachedCall({ prompt: 'prompt', cacheDir, call: async () => { calls += 1; return 'x'; }, validate: () => {} }),
      (err) => err.message.includes(file),
    );
    assert.equal(calls, 0);
    assert.equal((await fs.stat(file)).size, 0);
  });
});

test('simulated rename failure throws naming the path and leaves no cache file', async () => {
  await withTempDir(async (cacheDir) => {
    const file = entryPath(cacheKey(DEFAULT_MODEL_ID, 'prompt', null), cacheDir);
    const failingFs = {
      ...fs,
      rename: async () => { throw new Error('simulated rename failure'); },
    };
    await assert.rejects(
      cachedCall({ prompt: 'prompt', cacheDir, fs: failingFs, call: async () => 'response', validate: () => {} }),
      (err) => err.message.includes(file),
    );
    assert.deepEqual(await fs.readdir(cacheDir), []);
  });
});

test('creates the cache directory when absent and stores { text }', async () => {
  await withTempDir(async (root) => {
    const cacheDir = path.join(root, 'cache');
    const text = await cachedCall({ prompt: 'p', cacheDir, call: async () => 'hello', validate: () => {} });
    assert.equal(text, 'hello');
    const file = entryPath(cacheKey(DEFAULT_MODEL_ID, 'p', null), cacheDir);
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { text: 'hello' });
    assert.deepEqual(await fs.readdir(cacheDir), [path.basename(file)]);
  });
});
