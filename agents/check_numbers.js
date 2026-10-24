/*
 * agents/check_numbers.js
 *
 * checkNumbers(text, flatRecord): every number in `text` must be a value
 * found in the Flat_Record or an Allowed_Number (Requirement 4.1 to 4.6).
 *
 * UMD: works as a Node CommonJS module and as a classic browser script
 * (sets the global `AgentCheckNumbers`; load agents/format.js first).
 * No ES modules, because <script type="module"> fails under file://.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./format.js"));
  } else {
    root.AgentCheckNumbers = factory(root.AgentFormat);
  }
})(typeof self !== "undefined" ? self : this, function (AgentFormat) {
  "use strict";

  if (!AgentFormat || !(AgentFormat.NUMBER_RE instanceof RegExp)) {
    throw new Error("check_numbers.js: agents/format.js must be loaded first");
  }

  // Fresh copy with the g flag so the shared regex's lastIndex is never touched.
  function numberRe() {
    return new RegExp(AgentFormat.NUMBER_RE.source, "g");
  }

  var BARE_INTEGER_RE = /^\d+$/;
  var SECTION_PREFIX = "Section ";

  // Strip currency symbol, thousands separators and percent sign, then Number().
  function parseToken(token) {
    return Number(token.replace(/[$€£,%]/g, ""));
  }

  // Every finite number at any depth, plus every number token inside any
  // string at any depth, stored as absolute values.
  function collectAllowed(flatRecord) {
    var allowed = new Set();
    var seen = new Set();

    function addString(s) {
      for (var m of s.matchAll(numberRe())) {
        var v = parseToken(m[0]);
        if (Number.isFinite(v)) allowed.add(Math.abs(v));
      }
    }

    function walk(value) {
      if (typeof value === "number") {
        if (Number.isFinite(value)) allowed.add(Math.abs(value));
      } else if (typeof value === "string") {
        addString(value);
      } else if (value !== null && typeof value === "object") {
        if (seen.has(value)) return;
        seen.add(value);
        var keys = Object.keys(value);
        for (var i = 0; i < keys.length; i++) walk(value[keys[i]]);
      }
    }

    walk(flatRecord);
    return allowed;
  }

  // Allowed_Number (Requirement 4.3): a four-digit bare year from 1900 to 2099,
  // or a bare integer directly after the case-sensitive text "Section ".
  function isAllowedNumber(token, text, index) {
    if (!BARE_INTEGER_RE.test(token)) return false;
    if (token.length === 4) {
      var year = Number(token);
      if (year >= 1900 && year <= 2099) return true;
    }
    return (
      index >= SECTION_PREFIX.length &&
      text.slice(index - SECTION_PREFIX.length, index) === SECTION_PREFIX
    );
  }

  /*
   * checkNumbers(text, flatRecord) -> { pass, rejected }
   * `rejected` lists each rejected token exactly as written, once per
   * occurrence, in order of appearance. Never throws on a rejection.
   * Throws naming the argument if `text` is not a string or `flatRecord`
   * is not an object.
   */
  function checkNumbers(text, flatRecord) {
    if (typeof text !== "string") {
      throw new TypeError("checkNumbers: text must be a string, got " + typeof text);
    }
    if (flatRecord === null || typeof flatRecord !== "object" || Array.isArray(flatRecord)) {
      throw new TypeError(
        "checkNumbers: flatRecord must be an object, got " +
          (flatRecord === null ? "null" : Array.isArray(flatRecord) ? "array" : typeof flatRecord)
      );
    }

    var allowed = collectAllowed(flatRecord);
    var rejected = [];
    for (var m of text.matchAll(numberRe())) {
      var token = m[0];
      var value = parseToken(token);
      if (Number.isFinite(value) && allowed.has(Math.abs(value))) continue;
      if (isAllowedNumber(token, text, m.index)) continue;
      rejected.push(token);
    }
    return { pass: rejected.length === 0, rejected: rejected };
  }

  return {
    checkNumbers: checkNumbers
  };
});

/*
 * Node-only CLI (Requirement 4.8, 4.9): `node agents/check_numbers.js`.
 *
 * runCli({ manifestPath, fixturesPath, dataDir, log }) -> exit code (0 or 1).
 * Defaults are resolved relative to this file: cache/manifest.json,
 * test/fixtures/records.json and ../data. `log` receives one line per call
 * (default console.log). data/ is only read, never written.
 *
 * Records: every element of the fixtures array, plus every element of an
 * array in data/*.json (the top-level array, or an array-valued top-level
 * property) that has a `fixes` array and an `evidence` object.
 *
 * For each Record, every manifest Section's fill(template, flatten(record))
 * and fixesTableText(renderFixesTable(record)) are checked with checkNumbers
 * against flatten(record). Output lines:
 *   PASS <record id> <Section name | Fixes_Table>
 *   FAIL <record id> <Section name | Fixes_Table>: <rejected numbers or error>
 *   SKIP <record id> <Section name>: <missing tokens>
 * SKIP: fill failed only because the Template uses Derived_Field
 * Placeholders that flatten omitted for this Record (for example no fixes).
 * A SKIP does not fail the run. A missing manifest prints a notice and only
 * the Fixes_Tables are checked; an unreadable or malformed manifest fails.
 *
 * The browser never reaches this block: `module` is undefined there, and
 * fs, path and grant_writer.js are required only inside runCli.
 */
(function () {
  if (typeof module !== "object" || !module || !module.exports || typeof require !== "function") {
    return;
  }

  var FIXES_TABLE = "Fixes_Table";

  function errMessage(e) {
    return e && e.message ? e.message : String(e);
  }

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function isCandidateRecord(v) {
    return isPlainObject(v) && Array.isArray(v.fixes) && isPlainObject(v.evidence);
  }

  // Returns { manifest } or { missing: true } or { error }.
  function loadManifest(fs, manifestPath) {
    var raw;
    try {
      raw = fs.readFileSync(manifestPath, "utf8");
    } catch (e) {
      if (e && e.code === "ENOENT") return { missing: true };
      return { error: "cannot read " + manifestPath + ": " + errMessage(e) };
    }
    var m;
    try {
      m = JSON.parse(raw);
    } catch (e) {
      return { error: "invalid JSON in " + manifestPath + ": " + errMessage(e) };
    }
    if (!isPlainObject(m) || !Array.isArray(m.sections)) {
      return { error: manifestPath + ": sections must be an array" };
    }
    for (var i = 0; i < m.sections.length; i++) {
      var s = m.sections[i];
      if (!isPlainObject(s) || typeof s.name !== "string" || typeof s.template !== "string") {
        return { error: manifestPath + ": sections[" + i + "] must have a string name and a string template" };
      }
    }
    return { manifest: m };
  }

  // Returns { records: [{ record, label }], errors: [string], notices: [string] }.
  function loadRecords(fs, path, fixturesPath, dataDir) {
    var records = [];
    var errors = [];
    var notices = [];

    function readJson(file) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }

    function label(record, source, index) {
      return typeof record.id === "string" || typeof record.id === "number"
        ? String(record.id)
        : "(" + source + " #" + index + ")";
    }

    try {
      var fixtures = readJson(fixturesPath);
      if (!Array.isArray(fixtures)) {
        errors.push(fixturesPath + ": must be an array of Records");
      } else {
        fixtures.forEach(function (r, i) {
          if (isPlainObject(r)) {
            records.push({ record: r, label: label(r, "fixtures", i) });
          } else {
            errors.push(fixturesPath + ": element " + i + " is not an object");
          }
        });
      }
    } catch (e) {
      errors.push("cannot load " + fixturesPath + ": " + errMessage(e));
    }

    var files;
    try {
      files = fs.readdirSync(dataDir).filter(function (f) { return /\.json$/i.test(f); }).sort();
    } catch (e) {
      if (e && e.code === "ENOENT") {
        notices.push("NOTICE: " + dataDir + " not found; only fixture Records checked");
        files = [];
      } else {
        errors.push("cannot list " + dataDir + ": " + errMessage(e));
        files = [];
      }
    }

    files.forEach(function (f) {
      var file = path.join(dataDir, f);
      var parsed;
      try {
        parsed = readJson(file);
      } catch (e) {
        errors.push("cannot load " + file + ": " + errMessage(e));
        return;
      }
      var arrays = Array.isArray(parsed) ? [parsed]
        : isPlainObject(parsed)
          ? Object.keys(parsed).map(function (k) { return parsed[k]; }).filter(Array.isArray)
          : [];
      arrays.forEach(function (arr) {
        arr.forEach(function (r, i) {
          if (isCandidateRecord(r)) records.push({ record: r, label: label(r, f, i) });
        });
      });
    });

    return { records: records, errors: errors, notices: notices };
  }

  /*
   * Tokens in `template` that block fill for `flat`, found by scanning the
   * Template (not by parsing fill's error). Returns
   * { derivedMissing: [token], other: [token] }, each without duplicates.
   */
  function blockingTokens(GW, template, flat) {
    var derived = Object.create(null);
    GW.DERIVED_FIELDS.forEach(function (n) { derived[n] = true; });
    var placeholder = Object.create(null);
    GW.PLACEHOLDER_NAMES.forEach(function (n) { placeholder[n] = true; });

    var hasOwn = Object.prototype.hasOwnProperty;
    var seen = Object.create(null);
    var derivedMissing = [];
    var other = [];
    var re = /\{([^{}]*)\}/g;
    var m;
    while ((m = re.exec(template)) !== null) {
      var token = m[0];
      var inner = m[1];
      if (seen[token]) continue;
      seen[token] = true;
      if (GW.isUnknownMarkerInner(inner)) continue;
      if (!placeholder[inner]) { other.push(token); continue; }
      if (!hasOwn.call(flat, inner)) {
        (derived[inner] ? derivedMissing : other).push(token);
        continue;
      }
      var v = flat[inner];
      var usable = typeof v === "string" || typeof v === "boolean" ||
        (typeof v === "number" && Number.isFinite(v));
      if (!usable) other.push(token);
    }
    return { derivedMissing: derivedMissing, other: other };
  }

  function runCli(options) {
    var fs = require("fs");
    var path = require("path");
    var GW = require("./grant_writer.js");
    var checkNumbers = module.exports.checkNumbers;

    var opts = options || {};
    var manifestPath = opts.manifestPath || path.join(__dirname, "cache", "manifest.json");
    var fixturesPath = opts.fixturesPath || path.join(__dirname, "test", "fixtures", "records.json");
    var dataDir = opts.dataDir || path.join(__dirname, "..", "data");
    var log = typeof opts.log === "function" ? opts.log : function (line) { console.log(line); };

    var failed = 0;
    var passed = 0;
    var skipped = 0;

    function pass(id, what) { passed++; log("PASS " + id + " " + what); }
    function fail(id, what, detail) { failed++; log("FAIL " + id + " " + what + ": " + detail); }
    function skip(id, what, detail) { skipped++; log("SKIP " + id + " " + what + ": " + detail); }

    var sections = [];
    var loaded = loadManifest(fs, manifestPath);
    if (loaded.missing) {
      log("NOTICE: " + manifestPath + " not found; Section Templates were not checked " +
        "(run node agents/precompute.js). Checking Fixes_Tables only.");
    } else if (loaded.error) {
      failed++;
      log("FAIL manifest: " + loaded.error);
    } else {
      sections = loaded.manifest.sections;
    }

    var rec = loadRecords(fs, path, fixturesPath, dataDir);
    rec.notices.forEach(function (n) { log(n); });
    rec.errors.forEach(function (e) { failed++; log("FAIL records: " + e); });
    if (rec.records.length === 0) {
      failed++;
      log("FAIL records: no Records found to check");
    }

    rec.records.forEach(function (entry) {
      var record = entry.record;
      var id = entry.label;
      var flat;
      try {
        flat = GW.flatten(record);
      } catch (e) {
        fail(id, "flatten", errMessage(e));
        return;
      }

      function check(what, text) {
        var result = checkNumbers(text, flat);
        if (result.pass) pass(id, what);
        else fail(id, what, result.rejected.join(" "));
      }

      sections.forEach(function (s) {
        var text;
        try {
          text = GW.fill(s.template, flat);
        } catch (e) {
          var b = blockingTokens(GW, s.template, flat);
          if (b.other.length === 0 && b.derivedMissing.length > 0) {
            skip(id, s.name, b.derivedMissing.join(", "));
          } else {
            fail(id, s.name, errMessage(e));
          }
          return;
        }
        check(s.name, text);
      });

      var tableText;
      try {
        tableText = GW.fixesTableText(GW.renderFixesTable(record));
      } catch (e) {
        fail(id, FIXES_TABLE, errMessage(e));
        return;
      }
      check(FIXES_TABLE, tableText);
    });

    log("check_numbers: " + passed + " passed, " + skipped + " skipped, " + failed + " failed");
    return failed === 0 ? 0 : 1;
  }

  module.exports.runCli = runCli;

  if (require.main === module) {
    process.exitCode = runCli();
  }
})();
