#!/usr/bin/env node
// Builds data/profiles.json from data/greenhouses_hampshire.json.
// Plain Node, no dependencies. The source file is read-only here.

'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'greenhouses_hampshire.json');
const OUT = path.join(__dirname, 'profiles.json');

// Defaults added to every record (existing fields are left untouched).
const DEFAULTS = {
  town: null,
  utility: null,
  hdd: 6000,
  price_per_gal: 3.66,
};

// Rule 1: case-insensitive substring match on the record name.
const EXCLUDE = /research|education|university|college/i;

// Rule 2: explicit names to drop (exact match after trim, case-insensitive).
const EXCLUDE_NAMES = new Set(
  [
    'Durfee Conservatory',
    'Morrill Greenhouses',
    'Clark Hall Greenhouses',
    'Thaler-Null Greenhouse',
    'Leverett Elementary Greenhouse',
  ].map((n) => n.toLowerCase())
);

// Returns the rule that excludes this record, or null if it is kept.
function exclusionRule(rec) {
  if (typeof rec.name !== 'string') return null;
  const m = rec.name.match(EXCLUDE);
  if (m) return `keyword "${m[0].toLowerCase()}"`;
  if (EXCLUDE_NAMES.has(rec.name.trim().toLowerCase())) return 'name list';
  return null;
}

const records = JSON.parse(fs.readFileSync(SRC, 'utf8'));
if (!Array.isArray(records)) {
  throw new Error(`${SRC}: expected a top-level array`);
}

const kept = [];
const dropped = []; // { name, rule }

for (const rec of records) {
  const rule = exclusionRule(rec);
  if (rule) {
    dropped.push({ name: rec.name, rule });
    continue;
  }
  // Spread the original record first so no existing field is renamed or lost.
  kept.push({ ...rec, ...DEFAULTS });
}

fs.writeFileSync(OUT, JSON.stringify(kept, null, 2) + '\n');

const totalSqft = kept.reduce((s, r) => s + (Number(r.sqft) || 0), 0);
const totalUsd = kept.reduce((s, r) => s + (Number(r.usd_winter) || 0), 0);

for (const d of dropped) {
  console.log(`dropped "${d.name}" (${d.rule})`);
}

console.log(`kept: ${kept.length}`);
console.log(`dropped: ${dropped.length}`);
console.log(`total sqft: ${totalSqft}`);
console.log(`total usd_winter: ${totalUsd}`);
