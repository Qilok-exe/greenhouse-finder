/*
 * agents/grant_writer.js
 *
 * Grant Writer core: constants, Placeholder list, flatten, fill,
 * validateTemplate, renderFixesTable, fixesTableText, QUOTE_REQUEST_TEMPLATE
 * and buildDraft. Later additions (extractSections, ...) go into the same
 * factory and the `api` object at the bottom.
 *
 * UMD: works as a Node CommonJS module and as a classic browser script
 * (sets the global `AgentGrantWriter`). No Node built-ins are required here,
 * so the file loads in the browser. In the browser, agents/format.js must be
 * loaded first (global `AgentFormat`).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./format.js"));
  } else {
    if (!root.AgentFormat) {
      throw new Error("grant_writer.js: load agents/format.js first (AgentFormat is not defined)");
    }
    root.AgentGrantWriter = factory(root.AgentFormat);
  }
})(typeof self !== "undefined" ? self : this, function (AgentFormat) {
  "use strict";

  var formatNumber = AgentFormat.formatNumber;
  var hasOwn = Object.prototype.hasOwnProperty;

  // ---------------------------------------------------------------------
  // Grant_Constants
  // ---------------------------------------------------------------------

  // Share of the top fix's cost requested as grant.
  // Source: CSAP FY26 RFR and Round II how-to page (minimum 20% cash match,
  // so the grant covers at most 80% of the project cost).
  var GRANT_SHARE = 0.8;

  // Maximum grant in USD.
  // Source: CSAP FY26 RFR and Round II how-to page (Greenhouse Energy
  // Efficiency maximum $50,000).
  var GRANT_CAP_USD = 50000;
  // Placeholder text inserted for a quote-dependent field when no vendor
  // quote exists yet (fixes[0].cost_usd is null). It carries no digits, so
  // checkNumbers is unaffected, and flows through fill as a plain string.
  var PENDING_QUOTE = "[pending vendor quote]";

  // Kilograms of CO2 per gallon of fuel.
  // Source: user-supplied propane factor.
  var CO2_KG_PER_GALLON = 5.72;

  // ---------------------------------------------------------------------
  // Placeholder names
  // ---------------------------------------------------------------------

  // Record top-level scalar fields (data/record-shape.md), `bays` excluded.
  var RECORD_PLACEHOLDER_FIELDS = Object.freeze([
    "id", "name", "lat", "lon", "sqft", "covering", "town", "utility",
    "hdd", "price_per_gal"
  ]);

  // Fields computed by flatten.
  var DERIVED_FIELDS = Object.freeze([
    "estimate_low", "estimate_high", "estimate_point",
    "top_fix_name", "top_fix_saves_usd", "top_fix_cost_usd",
    "top_fix_payback_years",
    "grant_request", "farmer_match",
    "gallons_saved", "carbon_tons_saved"
  ]);

  var PLACEHOLDER_NAMES = Object.freeze(
    RECORD_PLACEHOLDER_FIELDS.concat(DERIVED_FIELDS)
  );

  var PLACEHOLDER_SET = Object.create(null);
  PLACEHOLDER_NAMES.forEach(function (n) { PLACEHOLDER_SET[n] = true; });

  function isPlaceholderName(inner) {
    return PLACEHOLDER_SET[inner] === true;
  }

  // Inner text of an Unknown_Marker: "UNKNOWN:" then a non-empty description.
  var UNKNOWN_INNER_RE = /^UNKNOWN:\s*\S/;

  function isUnknownMarkerInner(inner) {
    return UNKNOWN_INNER_RE.test(inner);
  }

  // A brace-delimited token: "{", any characters except braces, "}".
  // Created fresh per use, because a g-flag regex carries lastIndex state.
  function tokenRe() {
    return /\{([^{}]*)\}/g;
  }

  // ---------------------------------------------------------------------
  // flatten
  // ---------------------------------------------------------------------

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function isFiniteNumber(v) {
    return typeof v === "number" && Number.isFinite(v);
  }
  function isBlankOrMissingString(v) {
    // null, absent, or a string that is empty or only whitespace.
    return v === null || v === undefined ||
      (typeof v === "string" && v.trim() === "");
  }

  /*
   * flatten(record): a new object with every Record field copied unchanged
   * (shallow) plus each Derived_Field whose inputs are valid. A field with
   * invalid inputs is omitted, never set to null, so fill throws on it; a
   * quote-dependent field whose quote is absent (cost null) is PENDING_QUOTE,
   * a plain string, not a number. The Record is not modified.
   *
   * Derivation (real record shape, data/record-shape.md and data/profiles.js):
   *  - name: record.name if a non-blank string, else the town fallback
   *    ("an unnamed greenhouse in " + town, or "an unnamed greenhouse"),
   *    which carries no digit.
   *  - utility: record.utility if a non-blank string, else the digit-free
   *    fallback "an unspecified utility" (the real data has utility null).
   *  - estimate_low/high/point: the .usd of estimate.low/high/point, each set
   *    only when that .usd is a finite number (the old plain-number shape is
   *    not supported).
   *  - Top_Fix is fixes[0] (fixes are pre-sorted by saves_usd descending): no
   *    max search, and later elements never invalidate it.
   *  - top_fix_name/top_fix_saves_usd from fixes[0] when each is usable.
   *  - top_fix_cost_usd, top_fix_payback_years, grant_request, farmer_match
   *    are quote-dependent: PENDING_QUOTE when the quote is absent (cost or
   *    payback null/absent), the computed value when cost/payback is finite,
   *    omitted for any other value so fill throws (a crash beats a wrong
   *    number).
   *  - gallons_saved/carbon_tons_saved depend only on top_fix_saves_usd and a
   *    positive finite price_per_gal, never on a quote.
   */
  function flatten(record) {
    if (!isPlainObject(record)) {
      throw new Error("flatten: record must be an object");
    }
    var flat = {};
    Object.keys(record).forEach(function (k) { flat[k] = record[k]; });

    // name fallback: a non-blank string stays; otherwise a digit-free text
    // naming the town when the town is a non-empty string.
    if (isBlankOrMissingString(record.name)) {
      var town = record.town;
      flat.name = (typeof town === "string" && town !== "")
        ? "an unnamed greenhouse in " + town
        : "an unnamed greenhouse";
    }

    // utility fallback: the real data has utility null for every record, and
    // the Applicant template names {utility}. A null/absent/blank utility
    // becomes a digit-free, quote-free text so fill does not throw; it invents
    // no utility name. (Decided with Person A; mirrors the name fallback.)
    if (isBlankOrMissingString(record.utility)) {
      flat.utility = "an unspecified utility";
    }

    // estimate_*: the .usd of each sub-object, only when it is finite.
    var est = record.estimate;
    if (isPlainObject(est)) {
      if (isPlainObject(est.low) && isFiniteNumber(est.low.usd)) flat.estimate_low = est.low.usd;
      if (isPlainObject(est.high) && isFiniteNumber(est.high.usd)) flat.estimate_high = est.high.usd;
      if (isPlainObject(est.point) && isFiniteNumber(est.point.usd)) flat.estimate_point = est.point.usd;
    }

    // top_fix_*, grant_request, farmer_match, gallons_saved, carbon_tons_saved
    var fixes = record.fixes;
    var top = Array.isArray(fixes) && fixes.length > 0 ? fixes[0] : undefined;
    if (isPlainObject(top)) {
      var saves = top.saves_usd;

      if (typeof top.name === "string") flat.top_fix_name = top.name;
      if (isFiniteNumber(saves)) flat.top_fix_saves_usd = saves;

      // Quote-dependent cost -> top_fix_cost_usd, grant_request, farmer_match.
      var cost = top.cost_usd;
      if (cost === null || cost === undefined) {
        flat.top_fix_cost_usd = PENDING_QUOTE;
        flat.grant_request = PENDING_QUOTE;
        flat.farmer_match = PENDING_QUOTE;
      } else if (isFiniteNumber(cost)) {
        flat.top_fix_cost_usd = cost;
        var grant = Math.round(Math.min(GRANT_SHARE * cost, GRANT_CAP_USD));
        flat.grant_request = grant;
        // grant is an integer, so this equals round(cost - grant) exactly.
        flat.farmer_match = Math.round(cost) - grant;
      }
      // else (NaN, string, ...): omit all three so fill throws.

      // Quote-dependent payback.
      var payback = top.payback_years;
      if (isFiniteNumber(payback)) {
        flat.top_fix_payback_years = payback;
      } else if (payback === null || payback === undefined) {
        flat.top_fix_payback_years = PENDING_QUOTE;
      }
      // else: omit so fill throws.

      // gallons_saved / carbon_tons_saved: not quote-dependent.
      var price = record.price_per_gal;
      if (isFiniteNumber(saves) && isFiniteNumber(price) && price > 0) {
        var gallons = Math.round(saves / price);
        flat.gallons_saved = gallons;
        flat.carbon_tons_saved = Math.round(gallons * CO2_KG_PER_GALLON / 1000 * 10) / 10;
      }
    }

    return flat;
  }

  // ---------------------------------------------------------------------
  // fill
  // ---------------------------------------------------------------------

  /*
   * fill(template, flat): single pass over brace tokens.
   *  - Unknown_Marker: kept verbatim.
   *  - Placeholder holding a finite number: formatNumber(v).
   *  - Placeholder holding a string: inserted verbatim (not re-scanned).
   *  - Placeholder holding a boolean: "true" / "false".
   *  - Anything else (non-Placeholder token, or a Placeholder whose key is
   *    absent or holds null, undefined, an object, an array or a non-finite
   *    number) is collected; fill then throws once naming every such token.
   * Text outside tokens is untouched. Inputs are not modified.
   */
  function fill(template, flat) {
    if (typeof template !== "string") {
      throw new Error("fill: template must be a string");
    }
    if (!isPlainObject(flat)) {
      throw new Error("fill: flatRecord must be an object");
    }

    var bad = [];
    var seen = Object.create(null);
    function collect(token) {
      if (!seen[token]) {
        seen[token] = true;
        bad.push(token);
      }
      return token;
    }

    var out = template.replace(tokenRe(), function (token, inner) {
      if (isUnknownMarkerInner(inner)) return token;
      if (!isPlaceholderName(inner) || !hasOwn.call(flat, inner)) return collect(token);
      var v = flat[inner];
      if (typeof v === "number") {
        return Number.isFinite(v) ? formatNumber(v) : collect(token);
      }
      if (typeof v === "string") return v;
      if (typeof v === "boolean") return v ? "true" : "false";
      return collect(token);
    });

    if (bad.length > 0) {
      throw new Error("fill: bad or missing placeholder(s): " + bad.join(", "));
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // validateTemplate
  // ---------------------------------------------------------------------

  /*
   * validateTemplate(text): { ok, offending }. Offenders are listed as the
   * exact offending text, grouped by kind in this order, each kind in order
   * of appearance:
   *  - "empty template" for empty or whitespace-only text;
   *  - each digit character (one entry per occurrence);
   *  - each {...} token that is neither a Placeholder nor an Unknown_Marker
   *    with a non-empty description (covers {bays}, {fixes}, dotted paths);
   *  - each stray "{" or "}" outside a token;
   *  - each pair of Placeholders separated by nothing or only "," / "."
   *    characters, given as the text from the first to the second token.
   */
  function validateTemplate(text) {
    if (typeof text !== "string") {
      return { ok: false, offending: ["template is not a string"] };
    }
    var offending = [];

    if (text.trim() === "") {
      offending.push("empty template");
    }

    var digits = text.match(/[0-9]/g);
    if (digits) offending = offending.concat(digits);

    var re = tokenRe();
    var m;
    var lastEnd = 0;
    var outside = "";
    var prevPlaceholder = null; // { start, end } of the previous token if it was a Placeholder
    while ((m = re.exec(text)) !== null) {
      var start = m.index;
      var end = start + m[0].length;
      var inner = m[1];
      outside += text.slice(lastEnd, start);

      var placeholder = isPlaceholderName(inner);
      if (!placeholder && !isUnknownMarkerInner(inner)) {
        offending.push(m[0]);
      }

      if (placeholder && prevPlaceholder &&
          /^[,.]*$/.test(text.slice(prevPlaceholder.end, start))) {
        offending.push(text.slice(prevPlaceholder.start, end));
      }
      prevPlaceholder = placeholder ? { start: start, end: end } : null;
      lastEnd = end;
    }
    outside += text.slice(lastEnd);

    var stray = outside.match(/[{}]/g);
    if (stray) offending = offending.concat(stray);

    return { ok: offending.length === 0, offending: offending };
  }

  // ---------------------------------------------------------------------
  // Fixes_Table
  // ---------------------------------------------------------------------

  var FIXES_TABLE_HEADER = Object.freeze([
    "Fix", "Saves (USD per year)", "Cost (USD)", "Payback (years)"
  ]);

  // Fix fields in column order, matching FIXES_TABLE_HEADER.
  var FIXES_TABLE_FIELDS = Object.freeze([
    "name", "saves_usd", "cost_usd", "payback_years"
  ]);

  // Fields whose absent/null value is a pending quote, not an unknown.
  var QUOTE_FIELD = Object.create(null);
  QUOTE_FIELD.cost_usd = true;
  QUOTE_FIELD.payback_years = true;
  function fixesTableCell(fix, field) {
    var v = isPlainObject(fix) ? fix[field] : undefined;
    if (typeof v === "number" && Number.isFinite(v)) return formatNumber(v);
    if (typeof v === "string") return v;
    // A quote-dependent cell that is null or absent shows the pending-quote
    // text; any other non-number/non-string value stays an Unknown_Marker.
    if (QUOTE_FIELD[field] && (v === null || v === undefined)) return PENDING_QUOTE;
    return "{UNKNOWN: " + field + "}";
  }

  /*
   * renderFixesTable(record): string[][]. A header row, then one row per
   * element of record.fixes in array order. Every cell is copied from the
   * element by code (no model text): a finite number goes through
   * formatNumber, a string is copied, anything else (missing, null,
   * boolean, object, non-finite number, or a non-object element) becomes
   * "{UNKNOWN: <field>}". No totals row: a computed total is not a
   * Flat_Record value and would fail checkNumbers.
   * When record.fixes is absent or not an array, the table is the header
   * row only. The Record is not modified.
   */
  function renderFixesTable(record) {
    if (!isPlainObject(record)) {
      throw new Error("renderFixesTable: record must be an object");
    }
    var rows = [FIXES_TABLE_HEADER.slice()];
    var fixes = record.fixes;
    if (!Array.isArray(fixes)) return rows;
    for (var i = 0; i < fixes.length; i++) {
      rows.push(FIXES_TABLE_FIELDS.map(function (field) {
        return fixesTableCell(fixes[i], field);
      }));
    }
    return rows;
  }

  // Plain-text form of the Fixes_Table, for checkNumbers.
  function fixesTableText(rows) {
    if (!Array.isArray(rows)) {
      throw new Error("fixesTableText: rows must be an array");
    }
    return rows.map(function (row) { return row.join(" | "); }).join("\n");
  }

  // ---------------------------------------------------------------------
  // Quote_Request
  // ---------------------------------------------------------------------

  // Sent to a vendor in place of any vendor quote or price (Requirement 2.5).
  // Placeholders only, no digits, never a price; checked by validateTemplate.
  var QUOTE_REQUEST_TEMPLATE =
    "Request for quote: please send a written, itemised price quote to supply " +
    "and install {top_fix_name} in a greenhouse of {sqft} square feet in " +
    "{town}. The current covering is {covering}. Please list materials, " +
    "labour and installation separately, and state how long the quote is valid.";

  // ---------------------------------------------------------------------
  // buildDraft
  // ---------------------------------------------------------------------

  var QUOTE_MISSING_LABEL = "application draft: quote missing";

  /*
   * buildDraft(record, manifest): {
   *   quoteMissingLabel,            // QUOTE_MISSING_LABEL or null
   *   sections: [{ name, text }],   // fill(template, flat), manifest order
   *   fixesTable,                   // renderFixesTable(record)
   *   quoteRequest                  // fill(QUOTE_REQUEST_TEMPLATE, flat)
   * }
   * manifest: { model_id, rulebook_sha256, sections: [{ name, criteria, template }] }.
   * Throws, producing no draft, when evidence.quote_uploaded is absent or not
   * a boolean (Requirement 2.9), when the manifest is malformed, or when any
   * fill throws (the error names the Section or the Quote_Request).
   * Neither argument is modified.
   */
  function buildDraft(record, manifest) {
    if (!isPlainObject(record)) {
      throw new Error("buildDraft: record must be an object");
    }
    var evidence = record.evidence;
    var quoteUploaded = isPlainObject(evidence) ? evidence.quote_uploaded : undefined;
    if (typeof quoteUploaded !== "boolean") {
      throw new Error("buildDraft: evidence.quote_uploaded must be a boolean, got " +
        (quoteUploaded === null ? "null" : typeof quoteUploaded));
    }
    if (!isPlainObject(manifest) || !Array.isArray(manifest.sections)) {
      throw new Error("buildDraft: manifest.sections must be an array");
    }
    manifest.sections.forEach(function (s, i) {
      if (!isPlainObject(s) || typeof s.name !== "string" || typeof s.template !== "string") {
        throw new Error("buildDraft: manifest.sections[" + i +
          "] must have a string name and a string template");
      }
    });

    var flat = flatten(record);

    var sections = manifest.sections.map(function (s) {
      var text;
      try {
        text = fill(s.template, flat);
      } catch (e) {
        throw new Error("buildDraft: Section \"" + s.name + "\": " + e.message);
      }
      return { name: s.name, text: text };
    });

    var quoteRequest;
    try {
      quoteRequest = fill(QUOTE_REQUEST_TEMPLATE, flat);
    } catch (e) {
      throw new Error("buildDraft: Quote_Request: " + e.message);
    }

    return {
      quoteMissingLabel: quoteUploaded ? null : QUOTE_MISSING_LABEL,
      sections: sections,
      fixesTable: renderFixesTable(record),
      quoteRequest: quoteRequest
    };
  }

  // ---------------------------------------------------------------------
  // Rulebook extraction (Requirement 1.4 - 1.8)
  // ---------------------------------------------------------------------

  var RULEBOOK_PATH = "agents/rulebook.pdf";

  // Fixed text, so the extraction Cache_Key depends only on the PDF bytes and
  // the modelId. Contains no Section names: every name comes from the model.
  var EXTRACTION_PROMPT = [
    "The attached PDF is a state grant programme rulebook.",
    "List every application section that the rulebook asks an applicant to write,",
    "in the order the rulebook presents them. For each section, list the evaluation",
    "criteria the rulebook attaches to that section, copied as closely as possible",
    "from the rulebook text. A section may have no criteria.",
    "Answer with JSON only, no commentary, in exactly this shape:",
    "{\"sections\":[{\"name\":\"...\",\"criteria\":[\"...\"]}]}"
  ].join("\n");

  function requireDeps(deps, names, fnName) {
    if (!isPlainObject(deps)) {
      throw new Error(fnName + ": deps must be an object");
    }
    names.forEach(function (n) {
      if (typeof deps[n] !== "function") {
        throw new Error(fnName + ": deps." + n + " must be a function");
      }
    });
  }

  function errMessage(e) {
    return e && e.message ? e.message : String(e);
  }

  // Removes one surrounding Markdown code fence (``` or ```json), if present.
  function stripCodeFences(text) {
    var t = text.trim();
    var m = t.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
    return m ? m[1].trim() : t;
  }

  /*
   * parseSections(text): Section[] = [{ name, criteria: string[] }].
   * Accepts {"sections":[...]} (or a bare array), optionally inside a code
   * fence. Names and criteria are trimmed response text, in response order.
   * Throws "no sections extracted" on a parse failure or zero Sections, and
   * names any empty or duplicated Section (1.8). Used as the cachedCall
   * validator, so a throw means no Cache entry is written (5.4).
   */
  function parseSections(text) {
    if (typeof text !== "string") {
      throw new Error("no sections extracted (response is not a string)");
    }
    var parsed;
    try {
      parsed = JSON.parse(stripCodeFences(text));
    } catch (e) {
      throw new Error("no sections extracted (invalid JSON: " + errMessage(e) + ")");
    }
    var list = Array.isArray(parsed) ? parsed
      : (isPlainObject(parsed) ? parsed.sections : undefined);
    if (!Array.isArray(list)) {
      throw new Error("no sections extracted (no \"sections\" array in response)");
    }
    if (list.length === 0) {
      throw new Error("no sections extracted (zero sections in response)");
    }

    var seen = Object.create(null);
    return list.map(function (s, i) {
      if (!isPlainObject(s)) {
        throw new Error("no sections extracted (section " + (i + 1) + " is not an object)");
      }
      var name = typeof s.name === "string" ? s.name.trim() : "";
      if (name === "") {
        throw new Error("empty Section name: section " + (i + 1) + " of " + list.length +
          " has a blank or missing name");
      }
      if (seen[name]) {
        throw new Error("duplicated Section name: \"" + name + "\"");
      }
      seen[name] = true;

      var criteria = s.criteria === undefined || s.criteria === null ? [] : s.criteria;
      if (!Array.isArray(criteria)) {
        throw new Error("Section \"" + name + "\": criteria must be an array");
      }
      criteria = criteria.map(function (c, j) {
        if (typeof c !== "string") {
          throw new Error("Section \"" + name + "\": criterion " + (j + 1) + " is not a string");
        }
        return c.trim();
      });
      return { name: name, criteria: criteria };
    });
  }

  /*
   * extractSections(deps): Section[].
   * deps.readRulebook() returns the bytes of agents/rulebook.pdf (Uint8Array)
   * or throws (ENOENT when absent). A missing or zero-byte rulebook throws
   * before any Nova call (1.6). Otherwise one cachedCall sends the full bytes,
   * unmodified, with EXTRACTION_PROMPT through deps.askWithPdf (1.4).
   */
  async function extractSections(deps) {
    requireDeps(deps, ["readRulebook", "askWithPdf", "cachedCall"], "extractSections");

    var bytes;
    try {
      bytes = await deps.readRulebook();
    } catch (e) {
      if (e && e.code === "ENOENT") {
        throw new Error(RULEBOOK_PATH + " is missing");
      }
      throw new Error(RULEBOOK_PATH + " could not be read: " + errMessage(e));
    }
    if (bytes === null || bytes === undefined) {
      throw new Error(RULEBOOK_PATH + " is missing");
    }
    if (!(bytes instanceof Uint8Array)) {
      throw new Error(RULEBOOK_PATH + " could not be read: readRulebook must return a Uint8Array");
    }
    if (bytes.length === 0) {
      throw new Error(RULEBOOK_PATH + " is empty (zero bytes)");
    }

    var text;
    try {
      text = await deps.cachedCall({
        prompt: EXTRACTION_PROMPT,
        pdfBytes: bytes,
        call: function () { return deps.askWithPdf(EXTRACTION_PROMPT, bytes); },
        validate: parseSections
      });
    } catch (e) {
      throw new Error("Rulebook extraction failed: " + errMessage(e));
    }
    // A cache hit skips the validator, so parse here as well.
    try {
      return parseSections(text);
    } catch (e) {
      throw new Error("Rulebook extraction failed: " + errMessage(e));
    }
  }

  // ---------------------------------------------------------------------
  // Template generation (Requirement 2.1, 2.3, 2.4)
  // ---------------------------------------------------------------------

  /*
   * buildTemplatePrompt(section): the exact Template prompt for one Section.
   * Deterministic in section.name and section.criteria, so task 8.2 can
   * compute mock file names by cacheKey. Lists every Placeholder (never
   * the bays field) and the rules from 2.4.
   */
  function buildTemplatePrompt(section) {
    if (!isPlainObject(section) || typeof section.name !== "string") {
      throw new Error("buildTemplatePrompt: section must have a string name");
    }
    var criteria = Array.isArray(section.criteria) ? section.criteria : [];
    var criteriaText = criteria.length === 0
      ? "- (none listed)"
      : criteria.map(function (c) { return "- " + c; }).join("\n");
    var placeholders = PLACEHOLDER_NAMES.map(function (n) { return "{" + n + "}"; }).join("\n");

    return [
      "You are writing one section of a grant application for a greenhouse energy efficiency project.",
      "",
      "Section name: " + section.name,
      "",
      "Evaluation criteria for this section:",
      criteriaText,
      "",
      "Write the section as plain prose that addresses every criterion.",
      "",
      "Rules:",
      "- Never write a number. The text must contain no digit characters at all (no 0, 1, 2, 3, 4, 5, 6, 7, 8 or 9), not even in years, dates, percentages or lists.",
      "- Write every quantity, name or location of the applicant's greenhouse as one of these placeholders, exactly as written, including the braces:",
      placeholders,
      "- Use no other words inside braces, except the unknown marker described below.",
      "- Refer to energy-saving fixes only through the top_fix placeholders ({top_fix_name}, {top_fix_saves_usd}, {top_fix_cost_usd}, {top_fix_payback_years}). Do not describe or list any other fix.",
      "- Write any program name, cost-share percentage, deadline or fuel price that has no matching placeholder as {UNKNOWN: <what is missing>}, naming the missing item.",
      "- Never put two placeholders next to each other separated only by a comma or a full stop; put words between them.",
      "- Do not mention vendor quotes or vendor prices.",
      "",
      "Answer with the section text only: no title, no commentary, no code fence."
    ].join("\n");
  }

  // cachedCall validator: throws listing every offender (2.3).
  function validateTemplateOrThrow(text) {
    var result = validateTemplate(text);
    if (!result.ok) {
      throw new Error("Template rejected, offending: " + result.offending.join(", "));
    }
  }

  /*
   * generateTemplates(sections, deps): [{ name, template }] in Section-list
   * order. One cachedCall per Section, sequential, with call =
   * deps.ask(buildTemplatePrompt(section)) and validateTemplate as the
   * validator. The Template is the trimmed response text. Every error is
   * prefixed with the Section name (1.7, 2.3); the first error stops the run.
   */
  async function generateTemplates(sections, deps) {
    requireDeps(deps, ["ask", "cachedCall"], "generateTemplates");
    if (!Array.isArray(sections)) {
      throw new Error("generateTemplates: sections must be an array");
    }
    sections.forEach(function (s, i) {
      if (!isPlainObject(s) || typeof s.name !== "string") {
        throw new Error("generateTemplates: sections[" + i + "] must have a string name");
      }
    });

    var out = [];
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      var prompt = buildTemplatePrompt(section);
      var template;
      try {
        var text = await deps.cachedCall({
          prompt: prompt,
          pdfBytes: null,
          call: function () { return deps.ask(prompt); },
          validate: validateTemplateOrThrow
        });
        // A cache hit skips the validator, so check again.
        if (typeof text !== "string") {
          throw new Error("Template response is not a string");
        }
        validateTemplateOrThrow(text);
        template = text.trim();
      } catch (e) {
        throw new Error("Section \"" + section.name + "\": " + errMessage(e));
      }
      out.push({ name: section.name, template: template });
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Exports. Later tasks add their functions here.
  // ---------------------------------------------------------------------

  var api = {
    GRANT_SHARE: GRANT_SHARE,
    GRANT_CAP_USD: GRANT_CAP_USD,
    PENDING_QUOTE: PENDING_QUOTE,
    CO2_KG_PER_GALLON: CO2_KG_PER_GALLON,
    PLACEHOLDER_NAMES: PLACEHOLDER_NAMES,
    DERIVED_FIELDS: DERIVED_FIELDS,
    isUnknownMarkerInner: isUnknownMarkerInner,
    flatten: flatten,
    fill: fill,
    validateTemplate: validateTemplate,
    FIXES_TABLE_HEADER: FIXES_TABLE_HEADER,
    QUOTE_REQUEST_TEMPLATE: QUOTE_REQUEST_TEMPLATE,
    QUOTE_MISSING_LABEL: QUOTE_MISSING_LABEL,
    renderFixesTable: renderFixesTable,
    fixesTableText: fixesTableText,
    buildDraft: buildDraft,
    RULEBOOK_PATH: RULEBOOK_PATH,
    EXTRACTION_PROMPT: EXTRACTION_PROMPT,
    parseSections: parseSections,
    extractSections: extractSections,
    buildTemplatePrompt: buildTemplatePrompt,
    generateTemplates: generateTemplates
  };

  return api;
});
