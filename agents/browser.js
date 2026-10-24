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
      renderCheckboxes(out);
    }

    return { render: render, getApplicantChecks: getApplicantChecks };
  }

  return { createAgentView: createAgentView };
});
