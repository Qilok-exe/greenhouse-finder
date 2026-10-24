/*
 * agents/browser.js
 *
 * AgentView: renders the Application_Draft for one Record into
 * <div id="agent-output"> (Requirements 2.10 to 2.12, 5.5).
 *
 * - Reads the cached Templates from window.AGENT_CACHE (written by
 *   agents/cache/manifest.js). No Nova call, no fetch, no network.
 * - Creates and changes elements only inside #agent-output. Uses
 *   textContent only, never innerHTML.
 * - Does not modify the Record and writes nothing to data/.
 * - Runs checkNumbers on every Filled_Text, the Quote_Request and the
 *   Fixes_Table text before display. On any failure, or if buildDraft
 *   throws, the error message is shown instead of the draft.
 * - The two Applicant_Checks checkboxes are shown in both cases (draft or
 *   error). They are the applicant's own answers, do not depend on the
 *   draft, and must stay visible and editable while the applicant fixes
 *   the Record. Their state lives in memory here, never in the Record.
 *
 * UMD: in Node, module.exports = { createAgentView } so tests can pass a
 * fake document. In the browser (classic script, no type="module"), sets
 * the global `AgentView` built from the real globals. Load after
 * agents/format.js, agents/check_numbers.js, agents/grant_writer.js and
 * agents/cache/manifest.js.
 *
 * DOM surface used (all a fake document needs to implement):
 *   document.getElementById(id)
 *   document.createElement(tagName)
 *   element.appendChild(child)
 *   element.removeChild(child), element.firstChild
 *   element.textContent (set)
 *   element.setAttribute(name, value)
 *   element.addEventListener("change", handler)
 *   input.type, input.checked (set and read)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    var lib = factory();
    root.AgentView = lib.createAgentView({
      document: root.document,
      getCache: function () { return root.AGENT_CACHE; },
      grantWriter: root.AgentGrantWriter,
      checkNumbers: root.AgentCheckNumbers && root.AgentCheckNumbers.checkNumbers
    });
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var OUTPUT_ID = "agent-output";

  var CHECKBOXES = [
    { key: "match_is_cash", label: "Match is cash" },
    { key: "nothing_bought", label: "Nothing bought yet" }
  ];

  var LETTERHEAD = "Climate Smart Agriculture Program, Round II: application draft";

  // Missing items. Record items are struck through at render time from
  // record.evidence; checkbox items are struck through by CSS (:has), so a
  // toggle changes no element.
  var MISSING_ITEMS = [
    { key: "bill_uploaded", label: "Last winter's fuel bill (baseline)", from: "record" },
    { key: "quote_uploaded", label: "Vendor quote", from: "record" },
    { key: "match_is_cash", label: "Confirm the match is cash", from: "checkbox" },
    { key: "nothing_bought", label: "Confirm nothing has been bought yet", from: "checkbox" }
  ];

  /*
   * The paper sheet. Lives in a <style> inside #agent-output (nothing outside
   * it is touched). Selectors start with "body #agent-output" so they win
   * over the page's own #agent-output rules. The DOM order is fixed by the
   * tests (quote label or first section first, checkboxes last), so the
   * letterhead, quote label and score box are lifted to the top with order.
   */
  var PAPER_CSS = [
    "body #agent-output {",
    "  --paper-ink: #22201d; --paper-muted: #6b645e; --paper-rule: #e6e1db;",
    "  display: flex; flex-direction: column;",
    "  margin: 40px 0 0; padding: clamp(24px, 9%, 64px) clamp(20px, 8%, 56px);",
    "  border: 1px solid rgba(0,0,0,.06); border-radius: 2px; background: #fff;",
    "  box-shadow: 0 1px 2px rgba(40,30,20,.06), 0 12px 32px -8px rgba(40,30,20,.14);",
    "  color: var(--paper-ink);",
    "  font: 17px/1.6 Charter, 'Bitstream Charter', 'Iowan Old Style', 'Source Serif 4', Georgia, serif;",
    "  font-variant-numeric: lining-nums;",
    "  hyphens: auto; text-wrap: pretty;",
    "}",
    "body #agent-output > * { margin: 0; }",
    "body #agent-output .agent-letterhead { order: -3; padding-bottom: 12px; border-bottom: 1px solid var(--paper-ink); }",
    "body #agent-output .agent-letterhead p { max-width: none; }",
    "body #agent-output .agent-letterhead-title { font-size: 19px; line-height: 1.3; font-weight: 600; letter-spacing: -.005em; text-wrap: balance; }",
    "body #agent-output .agent-letterhead-applicant { margin-top: 4px; font-size: 15px; color: var(--paper-muted); }",
    "body #agent-output .agent-quote-missing { order: -2; margin-top: 16px; font-size: 15px; font-style: italic; color: #8a2a12; max-width: none; }",
    "body #agent-output .agent-score {",
    "  order: -1; margin-top: 24px; padding: 16px 20px;",
    "  display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: 4px 24px;",
    "  border: 1px solid var(--paper-ink);",
    "}",
    "body #agent-output .agent-score p { max-width: none; }",
    "body #agent-output .agent-score-label { font-weight: 600; }",
    "body #agent-output .agent-score-value { grid-row: span 2; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums lining-nums; }",
    "body #agent-output .agent-score-value strong { font-weight: 600; }",
    "body #agent-output .agent-score-value span { color: var(--paper-muted); }",
    "body #agent-output .agent-score-note { font-size: 15px; line-height: 1.45; color: var(--paper-muted); }",
    "body #agent-output > section, body #agent-output > .agent-quote-request, body #agent-output > .agent-missing { margin-top: 40px; }",
    "body #agent-output > section + section { margin-top: 32px; }",
    "body #agent-output h3, body #agent-output h4 {",
    "  margin: 0 0 8px; font: inherit; font-size: 19px; line-height: 1.3; font-weight: 600;",
    "  color: var(--paper-ink); letter-spacing: -.005em; text-wrap: balance;",
    "}",
    "body #agent-output p { max-width: 62ch; }",
    "body #agent-output .agent-fixes-table { margin-top: 32px; width: 100%; border-collapse: collapse; font-size: 15px; font-variant-numeric: tabular-nums lining-nums; }",
    "body #agent-output .agent-fixes-table th, body #agent-output .agent-fixes-table td {",
    "  padding: 8px 0; border: 0; border-bottom: 1px solid var(--paper-rule); text-align: left; vertical-align: baseline; font-weight: 400;",
    "}",
    "body #agent-output .agent-fixes-table th { padding-top: 0; border-bottom-color: var(--paper-ink); font-weight: 600; font-size: 15px; color: var(--paper-ink); }",
    "body #agent-output .agent-fixes-table th + th, body #agent-output .agent-fixes-table td + td { text-align: right; padding-left: 16px; }",
    "body #agent-output .agent-error { order: -1; margin-top: 24px; padding: 12px 16px; border: 1px solid #8a2a12; color: #8a2a12; font-size: 15px; }",
    "body #agent-output .agent-missing ul { margin: 0; padding: 0; list-style: none; }",
    "body #agent-output .agent-missing li { position: relative; padding: 4px 0 4px 28px; }",
    "body #agent-output .agent-missing li::before {",
    "  content: ''; position: absolute; left: 2px; top: .55em; width: 12px; height: 12px;",
    "  border: 1px solid var(--paper-ink); box-sizing: border-box;",
    "}",
    "body #agent-output .agent-missing li.is-done,",
    "body #agent-output:has(input[name='match_is_cash']:checked) li[data-key='match_is_cash'],",
    "body #agent-output:has(input[name='nothing_bought']:checked) li[data-key='nothing_bought'] {",
    "  color: var(--paper-muted); text-decoration: line-through; text-decoration-thickness: 1px;",
    "}",
    "body #agent-output .agent-missing li.is-done::before,",
    "body #agent-output:has(input[name='match_is_cash']:checked) li[data-key='match_is_cash']::before,",
    "body #agent-output:has(input[name='nothing_bought']:checked) li[data-key='nothing_bought']::before {",
    "  border-color: var(--paper-muted);",
    "  background: linear-gradient(45deg, transparent 45%, var(--paper-muted) 45% 55%, transparent 55%),",
    "              linear-gradient(-45deg, transparent 45%, var(--paper-muted) 45% 55%, transparent 55%);",
    "}",
    "body #agent-output .agent-applicant-checks { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--paper-rule); }",
    "body #agent-output .agent-applicant-checks label {",
    "  display: flex; justify-content: space-between; align-items: center; gap: 16px;",
    "  padding: 8px 0; cursor: pointer; font-size: 17px;",
    "}",
    "body #agent-output .agent-applicant-checks span { order: -1; }",
    "body #agent-output .agent-applicant-checks input {",
    "  -webkit-appearance: none; appearance: none; flex: none; margin: 0;",
    "  width: 36px; height: 20px; border-radius: 10px; cursor: pointer;",
    "  background: radial-gradient(circle at center, #fff 7px, rgba(0,0,0,.18) 7.5px, transparent 8px) 0 0 / 20px 20px no-repeat #d6cfc8;",
    "  transition: background-position 160ms cubic-bezier(.22,.8,.25,1), background-color 160ms ease;",
    "}",
    "body #agent-output .agent-applicant-checks input:checked {",
    "  background-position: 16px 0; background-color: var(--paper-ink);",
    "}",
    "body #agent-output .agent-applicant-checks input:focus-visible { outline: 2px solid var(--paper-ink); outline-offset: 2px; }",
    "@media (prefers-reduced-motion: reduce) { body #agent-output .agent-applicant-checks input { transition: none; } }",
    "@media (prefers-contrast: more) { body #agent-output { box-shadow: none; border-color: var(--paper-ink); } }",
    "@media print { body #agent-output { box-shadow: none; border: 0; padding: 0; } }"
  ].join("\n");

  function errorMessage(e) {
    return e && typeof e.message === "string" ? e.message : String(e);
  }

  /*
   * createAgentView({ document, getCache, grantWriter, checkNumbers })
   *   document     object with getElementById and createElement
   *   getCache     () => manifest { model_id, rulebook_sha256, sections }
   *   grantWriter  { buildDraft, flatten, fixesTableText }
   *   checkNumbers (text, flat) => { pass, rejected }
   * Dependencies are checked when render runs, so a missing script shows
   * as an error inside #agent-output instead of failing at load.
   * Returns { render(record), getApplicantChecks() }.
   */
  function createAgentView(deps) {
    deps = deps || {};
    var doc = deps.document;

    // Applicant_Checks: in memory only, not persisted, not in the Record.
    var applicantChecks = { match_is_cash: false, nothing_bought: false };

    function getApplicantChecks() {
      return {
        match_is_cash: applicantChecks.match_is_cash,
        nothing_bought: applicantChecks.nothing_bought
      };
    }

    function el(tag, text) {
      var node = doc.createElement(tag);
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function clear(node) {
      while (node.firstChild) node.removeChild(node.firstChild);
    }

    // Builds the draft and checks every number. Throws with a readable
    // message on any problem; returns the draft otherwise.
    function buildCheckedDraft(record) {
      var gw = deps.grantWriter;
      if (!gw || typeof gw.buildDraft !== "function" ||
          typeof gw.flatten !== "function" || typeof gw.fixesTableText !== "function") {
        throw new Error("agents/grant_writer.js is not loaded (AgentGrantWriter is missing)");
      }
      if (typeof deps.checkNumbers !== "function") {
        throw new Error("agents/check_numbers.js is not loaded (AgentCheckNumbers is missing)");
      }
      var manifest = typeof deps.getCache === "function" ? deps.getCache() : undefined;
      if (manifest === undefined || manifest === null) {
        throw new Error("Cached templates are missing: window.AGENT_CACHE is not set. " +
          "Run node agents/precompute.js to create agents/cache/manifest.js.");
      }

      var draft = gw.buildDraft(record, manifest);
      var flat = gw.flatten(record);

      var checks = draft.sections.map(function (s) {
        return { where: "Section \"" + s.name + "\"", text: s.text };
      });
      checks.push({ where: "Quote_Request", text: draft.quoteRequest });
      checks.push({ where: "Fixes_Table", text: gw.fixesTableText(draft.fixesTable) });

      var failures = [];
      checks.forEach(function (c) {
        var result = deps.checkNumbers(c.text, flat);
        if (!result.pass) failures.push(c.where + ": " + result.rejected.join(", "));
      });
      if (failures.length > 0) {
        throw new Error("Number check failed. Numbers not found in the record: " +
          failures.join("; "));
      }
      return draft;
    }

    function renderDraft(out, draft) {
      if (draft.quoteMissingLabel) {
        var label = el("p", draft.quoteMissingLabel);
        label.setAttribute("class", "agent-quote-missing");
        out.appendChild(label);
      }

      draft.sections.forEach(function (s) {
        var section = el("section");
        section.appendChild(el("h3", s.name));
        section.appendChild(el("p", s.text));
        out.appendChild(section);
      });

      var table = el("table");
      table.setAttribute("class", "agent-fixes-table");
      draft.fixesTable.forEach(function (row, i) {
        var tr = el("tr");
        row.forEach(function (cell) {
          tr.appendChild(el(i === 0 ? "th" : "td", cell));
        });
        table.appendChild(tr);
      });
      out.appendChild(table);

      var quote = el("div");
      quote.setAttribute("class", "agent-quote-request");
      quote.appendChild(el("h4", "Quote request"));
      quote.appendChild(el("p", draft.quoteRequest));
      out.appendChild(quote);
    }

    // Letterhead, practice score box and missing-items list. Appended after
    // the draft and before the checkboxes; CSS lifts the first two to the top.
    function renderPaper(out, record) {
      var style = el("style", PAPER_CSS);
      out.appendChild(style);

      var head = el("div");
      head.setAttribute("class", "agent-letterhead");
      var title = el("p", LETTERHEAD);
      title.setAttribute("class", "agent-letterhead-title");
      head.appendChild(title);
      var who = record && typeof record.name === "string" && record.name.trim() !== ""
        ? record.name + (typeof record.town === "string" && record.town ? ", " + record.town : "")
        : null;
      if (who) {
        var applicant = el("p", "Applicant: " + who);
        applicant.setAttribute("class", "agent-letterhead-applicant");
        head.appendChild(applicant);
      }
      out.appendChild(head);

      // No Reviewer yet, so there is no score to show. "100" is the sum of
      // the published section weights, not a score.
      var score = el("div");
      score.setAttribute("class", "agent-score");
      var label = el("p", "Practice score");
      label.setAttribute("class", "agent-score-label");
      var value = el("p");
      value.setAttribute("class", "agent-score-value");
      value.appendChild(el("strong", "Not scored yet"));
      value.appendChild(el("span", " / 100"));
      var note = el("p", "A practice score only. The state publishes section weights, not points per rating.");
      note.setAttribute("class", "agent-score-note");
      score.appendChild(label);
      score.appendChild(value);
      score.appendChild(note);
      out.appendChild(score);

      var evidence = record && record.evidence ? record.evidence : {};
      var missing = el("div");
      missing.setAttribute("class", "agent-missing");
      missing.appendChild(el("h3", "Missing items"));
      var ul = el("ul");
      MISSING_ITEMS.forEach(function (item) {
        var li = el("li", item.label);
        li.setAttribute("data-key", item.key);
        if (item.from === "record" && evidence[item.key] === true) {
          li.setAttribute("class", "is-done");
          li.setAttribute("aria-label", item.label + ", received");
        }
        ul.appendChild(li);
      });
      missing.appendChild(ul);
      out.appendChild(missing);
    }

    function renderError(out, message) {
      var p = el("p", "Grant draft not shown: " + message);
      p.setAttribute("class", "agent-error");
      p.setAttribute("role", "alert");
      out.appendChild(p);
    }

    function renderCheckboxes(out) {
      var box = el("div");
      box.setAttribute("class", "agent-applicant-checks");
      CHECKBOXES.forEach(function (c) {
        var label = el("label");
        var input = el("input");
        input.type = "checkbox";
        input.setAttribute("name", c.key);
        input.setAttribute("role", "switch");
        input.checked = applicantChecks[c.key];
        input.addEventListener("change", function () {
          applicantChecks[c.key] = input.checked === true;
        });
        label.appendChild(input);
        label.appendChild(el("span", c.label));
        box.appendChild(label);
      });
      out.appendChild(box);
    }

    /*
     * render(record): clears #agent-output and redraws it. Does nothing
     * if #agent-output is absent or there is no document.
     */
    function render(record) {
      if (!doc || typeof doc.getElementById !== "function") return;
      var out = doc.getElementById(OUTPUT_ID);
      if (!out) return;

      clear(out);
      var draft;
      try {
        draft = buildCheckedDraft(record);
      } catch (e) {
        renderError(out, errorMessage(e));
      }
      if (draft) renderDraft(out, draft);
      renderPaper(out, record);
      renderCheckboxes(out);
    }

    return { render: render, getApplicantChecks: getApplicantChecks };
  }

  return { createAgentView: createAgentView };
});
