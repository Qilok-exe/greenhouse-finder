#!/usr/bin/env node
// Reverse-geocodes every record in data/profiles.json with Nominatim and caches
// the town name in data/towns.json, keyed by record id.
//
// Plain Node 18+ (or Bun), no dependencies: uses the built-in fetch.
// Nominatim usage policy: max 1 request per second, identifying User-Agent.
// Set NOMINATIM_CONTACT (e.g. an email) to include contact info in the User-Agent.
//
// Cache format: { "<id>": "Amherst" | null }. null means Nominatim answered but had
// no town/city/village/hamlet/suburb. Failed requests are not cached, so a re-run retries them.

'use strict';

const fs = require('fs');
const path = require('path');

const PROFILES = path.join(__dirname, 'profiles.json');
const CACHE = path.join(__dirname, 'towns.json');
const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const MIN_INTERVAL_MS = 1100; // a little over 1 s for safety
const CONTACT = process.env.NOMINATIM_CONTACT;
const USER_AGENT =
  'greenhouse-finder/0.1 (Hampshire County greenhouse fuel map' +
  (CONTACT ? `; ${CONTACT}` : '') + ')';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadCache() {
  if (!fs.existsSync(CACHE)) return {};
  return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
}

// Write via a temp file so an interrupted run never leaves broken JSON.
function saveCache(cache) {
  const tmp = CACHE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2) + '\n');
  fs.renameSync(tmp, CACHE);
}

async function reverse(lat, lon) {
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lon), zoom: '10' });
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const body = await res.json();
  if (body.error) throw new Error(`Nominatim: ${body.error}`);
  const a = body.address || {};
  return a.town || a.city || a.village || a.hamlet || a.suburb || null;
}

async function main() {
  const records = JSON.parse(fs.readFileSync(PROFILES, 'utf8'));
  const cache = loadCache();
  const todo = records.filter((r) => !Object.prototype.hasOwnProperty.call(cache, r.id));

  console.log(`records: ${records.length}, cached: ${records.length - todo.length}, to fetch: ${todo.length}`);

  let failed = 0;
  let last = 0;
  for (const [i, r] of todo.entries()) {
    const wait = last + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      cache[r.id] = await reverse(r.lat, r.lon);
      saveCache(cache);
      console.log(`[${i + 1}/${todo.length}] ${r.id} -> ${cache[r.id] ?? '(none)'}`);
    } catch (e) {
      failed++;
      console.error(`[${i + 1}/${todo.length}] ${r.id} failed: ${e.message}`);
    }
  }

  const values = records.map((r) => cache[r.id]);
  console.log(`done. with town: ${values.filter((v) => v).length}, no town: ${values.filter((v) => v === null).length}, failed: ${failed}`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
