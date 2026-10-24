'use strict';
// Disk cache for Nova responses (Requirement 5).
// Entries live at <cacheDir>/<key>.json as { "text": "<full response>" }.
// The mock directory <cacheDir>/mock/ holds Mock_Mode inputs and is never
// read or written here: entries are only direct children named <key>.json.

const crypto = require('crypto');
const path = require('path');
const nodeFs = require('fs').promises;

const DEFAULT_CACHE_DIR = path.join(__dirname, 'cache');
// Must equal nova_api.js MODEL_ID. Duplicated here to avoid a circular require
// (nova_api.js uses cacheKey for mock file names).
const DEFAULT_MODEL_ID = 'us.amazon.nova-2-lite-v1:0';

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Cache_Key: sha256 of JSON [modelId, prompt, sha256(pdf) | null].
// The JSON array keeps the inputs unambiguous, and an empty PDF hashes to a
// string while an absent PDF is null, so the two get different keys.
function cacheKey(modelId, prompt, pdfBytes) {
  if (typeof modelId !== 'string') throw new TypeError('cacheKey: modelId must be a string');
  if (typeof prompt !== 'string') throw new TypeError('cacheKey: prompt must be a string');
  let pdfHash = null;
  if (pdfBytes !== null && pdfBytes !== undefined) {
    if (!(pdfBytes instanceof Uint8Array)) {
      throw new TypeError('cacheKey: pdfBytes must be a Uint8Array, null or undefined');
    }
    pdfHash = sha256Hex(pdfBytes);
  }
  return sha256Hex(JSON.stringify([modelId, prompt, pdfHash]));
}

function entryPath(key, cacheDir = DEFAULT_CACHE_DIR) {
  return path.join(cacheDir, key + '.json');
}

// Reads an existing entry. Returns undefined on a miss (file absent).
// Throws naming the path if the entry exists but is unreadable, zero bytes,
// or not a { "text": string } object (5.6).
async function readEntry(file, fs) {
  let stat;
  try {
    stat = await fs.stat(file);
  } catch (err) {
    if (err && err.code === 'ENOENT') return undefined;
    throw new Error(`Cache entry unreadable: ${file} (${err && err.message})`);
  }
  if (stat.size === 0) throw new Error(`Cache entry is empty (zero bytes): ${file}`);
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    throw new Error(`Cache entry unreadable: ${file} (${err && err.message})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Cache entry unreadable: ${file} (invalid JSON: ${err.message})`);
  }
  if (!parsed || typeof parsed.text !== 'string') {
    throw new Error(`Cache entry unreadable: ${file} (missing string "text" field)`);
  }
  return parsed.text;
}

// Writes { text } via <key>.json.tmp + rename. On any failure the tmp file is
// removed and the error names the entry path; no entry is left for the key (5.7).
async function writeEntry(file, text, fs) {
  const dir = path.dirname(file);
  const tmp = file + '.tmp';
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(tmp, JSON.stringify({ text }), 'utf8');
    await fs.rename(tmp, file);
  } catch (err) {
    try { await fs.unlink(tmp); } catch (_) { /* tmp may not exist */ }
    throw new Error(`Cache write failed: ${file} (${err && err.message})`);
  }
}

// Options:
//   prompt    full prompt text (string)
//   pdfBytes  Uint8Array or null/undefined for a text-only request
//   call      async () => string, the Nova request; only invoked on a miss
//   validate  (text) => void, throws to reject. A return value of false or
//             { ok: false } is also treated as a rejection.
//   cacheDir  default agents/cache
//   modelId   default us.amazon.nova-2-lite-v1:0
//   fs        fs.promises-compatible object (stat, readFile, writeFile,
//             rename, mkdir, unlink), for failure simulation in tests
async function cachedCall({
  prompt,
  pdfBytes = null,
  call,
  validate,
  cacheDir = DEFAULT_CACHE_DIR,
  modelId = DEFAULT_MODEL_ID,
  fs = nodeFs,
}) {
  if (typeof call !== 'function') throw new TypeError('cachedCall: call must be a function');
  if (typeof validate !== 'function') throw new TypeError('cachedCall: validate must be a function');

  const file = entryPath(cacheKey(modelId, prompt, pdfBytes), cacheDir);

  // 1. Hit: return stored text unchanged, zero Nova calls (5.2, 5.6).
  const hit = await readEntry(file, fs);
  if (hit !== undefined) return hit;

  // 2. Miss: a Nova error propagates and nothing is written (5.4).
  const text = await call();
  if (typeof text !== 'string') {
    throw new TypeError('cachedCall: call() must resolve to a string');
  }

  // 3. Validate before writing; a rejection writes nothing (5.4).
  const verdict = validate(text);
  if (verdict === false || (verdict && typeof verdict === 'object' && verdict.ok === false)) {
    const offending = verdict && Array.isArray(verdict.offending) ? `: ${verdict.offending.join(', ')}` : '';
    throw new Error(`Response rejected by validator${offending}`);
  }

  // 4. Write atomically (5.1, 5.7).
  await writeEntry(file, text, fs);
  return text;
}

module.exports = {
  DEFAULT_CACHE_DIR,
  DEFAULT_MODEL_ID,
  sha256Hex,
  cacheKey,
  entryPath,
  cachedCall,
};
