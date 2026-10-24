'use strict';
// Precompute CLI (Requirement 5.1, 5.3, 5.5).
//
//   node agents/precompute.js
//
// Reads agents/rulebook.pdf, asks Nova (through the Cache) for the Section
// list and one Template per Section, then writes agents/cache/manifest.json
// and agents/cache/manifest.js. The manifests are written only after a full
// successful run; on any error the message is printed, the exit code is 1,
// and any previous manifest is left untouched.
//
// Mock_Mode is decided by nova_api.js (AWS_BEARER_TOKEN_BEDROCK unset). In
// Mock_Mode each missing mock file stops the run with its path.

const path = require('path');
const nodeFs = require('fs').promises;
const novaApi = require('./nova_api');
const cacheStore = require('./cache_store');
const grantWriter = require('./grant_writer');

const DEFAULT_RULEBOOK_PATH = path.join(__dirname, 'rulebook.pdf');
const DEFAULT_CACHE_DIR = cacheStore.DEFAULT_CACHE_DIR;
const MANIFEST_JSON = 'manifest.json';
const MANIFEST_JS = 'manifest.js';

// Manifest object with a fixed key order, so serialisation is stable.
function buildManifest(modelId, rulebookSha256, sections, templates) {
  if (templates.length !== sections.length) {
    throw new Error(`precompute: ${sections.length} Sections but ${templates.length} Templates`);
  }
  return {
    model_id: modelId,
    rulebook_sha256: rulebookSha256,
    sections: sections.map((s, i) => {
      const t = templates[i];
      if (!t || t.name !== s.name) {
        throw new Error(`precompute: Template ${i + 1} does not match Section "${s.name}"`);
      }
      return { name: s.name, criteria: s.criteria.slice(), template: t.template };
    }),
  };
}

// Deterministic text: two-space indentation and a trailing newline.
function manifestJsonText(manifest) {
  return JSON.stringify(manifest, null, 2) + '\n';
}

function manifestJsText(manifest) {
  return 'window.AGENT_CACHE = ' + JSON.stringify(manifest, null, 2) + ';\n';
}

// Writes every { file, text } to <file>.tmp first, then renames each into
// place, so a failure while preparing leaves the previous manifests intact.
// Tmp files are removed on failure.
async function writeFilesAtomically(files, fs) {
  const tmps = [];
  try {
    for (const { file, text } of files) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      tmps.push(tmp);
      await fs.writeFile(tmp, text, 'utf8');
    }
    for (const { file } of files) {
      await fs.rename(file + '.tmp', file);
    }
  } catch (err) {
    for (const tmp of tmps) {
      try { await fs.unlink(tmp); } catch (_) { /* already renamed or absent */ }
    }
    throw new Error(`Manifest write failed: ${err && err.message}`);
  }
}

// Options (all optional; defaults are the real paths and nova_api functions):
//   rulebookPath  default agents/rulebook.pdf
//   cacheDir      default agents/cache
//   manifestDir   default cacheDir
//   ask           (prompt) => Promise<string>, default nova_api.askNova
//   askWithPdf    (prompt, bytes) => Promise<string>, default nova_api.askNovaWithPdf
//   modelId       default nova_api.MODEL_ID
//   log           (message) => void, default console.log
//   fs            fs.promises-compatible object, used for the rulebook, the
//                 Cache and the manifests
// Returns the manifest object, or throws with no manifest written.
async function run(options = {}) {
  const {
    rulebookPath = DEFAULT_RULEBOOK_PATH,
    cacheDir = DEFAULT_CACHE_DIR,
    manifestDir = cacheDir,
    ask = novaApi.askNova,
    askWithPdf = novaApi.askNovaWithPdf,
    modelId = novaApi.MODEL_ID,
    log = (msg) => console.log(msg),
    fs = nodeFs,
  } = options;

  let rulebookBytes = null;
  const deps = {
    // ENOENT propagates so extractSections reports the rulebook as missing.
    readRulebook: async () => {
      const buf = await fs.readFile(rulebookPath);
      rulebookBytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      return rulebookBytes;
    },
    ask,
    askWithPdf,
    cachedCall: (opts) => cacheStore.cachedCall({ ...opts, cacheDir, modelId, fs }),
  };

  const sections = await grantWriter.extractSections(deps);
  log(`Extracted ${sections.length} Section(s)`);
  const templates = await grantWriter.generateTemplates(sections, deps);
  log(`Generated ${templates.length} Template(s)`);

  const manifest = buildManifest(modelId, cacheStore.sha256Hex(rulebookBytes), sections, templates);
  const jsonFile = path.join(manifestDir, MANIFEST_JSON);
  const jsFile = path.join(manifestDir, MANIFEST_JS);
  await writeFilesAtomically([
    { file: jsonFile, text: manifestJsonText(manifest) },
    { file: jsFile, text: manifestJsText(manifest) },
  ], fs);
  log(`Wrote ${jsonFile}`);
  log(`Wrote ${jsFile}`);
  return manifest;
}

async function main() {
  try {
    await run();
    process.exitCode = 0;
  } catch (err) {
    console.error(err && err.message ? err.message : String(err));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_RULEBOOK_PATH,
  DEFAULT_CACHE_DIR,
  MANIFEST_JSON,
  MANIFEST_JS,
  buildManifest,
  manifestJsonText,
  manifestJsText,
  run,
  main,
};
