"use strict";

// DOM tests for agents/browser.js (task 9.2).
// Requirements 2.10, 2.11, 2.12.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const GW = require("../grant_writer.js");
const { checkNumbers } = require("../check_numbers.js");
const { createAgentView } = require("../browser.js");
const { createFakeDocument, isInside, findAll, snapshot } = require("./fake_dom.js");

const RECORDS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "records.json"), "utf8")
);
function fixture(id) {
  const r = RECORDS.find((x) => x.id === id);
  assert.ok(r, "fixture missing: " + id);
  return structuredClone(r);
}
const QUOTE_TRUE_ID = "way/118883914";
const QUOTE_FALSE_ID = "way/212516707";
const EMPTY_FIXES_ID = "way/147156719";

// Templates are digit-free and use only Placeholders and an Unknown_Marker.
const MANIFEST = {
  model_id: "test-model",
  rulebook_sha256: "test-hash",
  sections: [
    {
      name: "Project summary",
      criteria: ["Need is clear"],
      template: "The {name} greenhouse in {town} will install {top_fix_name}. {UNKNOWN: deadline}"
    },
    {
      name: "Budget",
      criteria: [],
      template: "We request {grant_request} dollars and the farmer provides {farmer_match} dollars as match."
    }
  ]
};

// Same shape, but one Template carries a number that is not in any Record.
const FOREIGN_NUMBER_MANIFEST = {
  ...MANIFEST,
  sections: [
    MANIFEST.sections[0],
    { name: "Budget", criteria: [], template: "The project at {name} costs 123457 dollars." }
  ]
};

function setup(options) {
  const opts = options || {};
  const dom = createFakeDocument({ withOutput: opts.withOutput });
  const manifest = "manifest" in opts ? opts.manifest : MANIFEST;
  const view = createAgentView({
    document: dom.document,
    getCache: () => manifest,
    grantWriter: GW,
    checkNumbers
  });
  return { dom, view };
}

// Renders and checks Requirement 2.12 for that call: every logged mutation
// targets #agent-output or a descendant, every element created during the
// call ends inside #agent-output, and the sibling and body are untouched.
function renderInside(dom, view, record) {
  const logStart = dom.log.length;
  const createdStart = dom.created.length;
  const siblingBefore = snapshot(dom.sibling);
  const bodyAttrsBefore = { ...dom.body._state.attrs };

  view.render(record);

  for (const entry of dom.log.slice(logStart)) {
    assert.ok(isInside(entry.target, dom.output),
      "mutation outside #agent-output: " + entry.op + " " + (entry.key || "") +
      " on " + (entry.target && entry.target.tagName));
  }
  for (const node of dom.created.slice(createdStart)) {
    assert.ok(isInside(node, dom.output), "created element not inside #agent-output: " + node.tagName);
  }
  assert.deepEqual(snapshot(dom.sibling), siblingBefore);
  assert.deepEqual({ ...dom.body._state.attrs }, bodyAttrsBefore);
  const bodyChildren = dom.body.childNodes;
  assert.equal(bodyChildren.length, 2);
  assert.equal(bodyChildren[0], dom.sibling);
  assert.equal(bodyChildren[1], dom.output);
  assert.equal(dom.html.childNodes.length, 1);
  assert.equal(dom.html.firstChild, dom.body);
}

function checkboxes(output) {
  return findAll(output, "label").map((label) => {
    const [input] = findAll(label, "input");
    const [span] = findAll(label, "span");
    return { label, input, text: span && span.textContent };
  });
}

function byClass(root, tag, cls) {
  return findAll(root, tag).filter((n) => n.getAttribute("class") === cls);
}

function assertErrorShown(output, pattern) {
  const errors = byClass(output, "p", "agent-error");
  assert.equal(errors.length, 1, "expected one error element");
  assert.equal(errors[0].getAttribute("role"), "alert");
  assert.match(errors[0].textContent, pattern);
  assert.equal(findAll(output, "section").length, 0, "no Section shown with an error");
  assert.equal(findAll(output, "table").length, 0, "no Fixes_Table shown with an error");
  assert.equal(byClass(output, "div", "agent-quote-request").length, 0, "no Quote_Request with an error");
  assert.ok(!output.textContent.includes(GW.QUOTE_MISSING_LABEL), "no label with an error");
}

// ---------------------------------------------------------------------

test("test manifest Templates are valid digit-free Templates", () => {
  for (const s of MANIFEST.sections) {
    assert.deepEqual(GW.validateTemplate(s.template), { ok: true, offending: [] }, s.name);
  }
});

// Requirement 2.10
test("checkboxes are labelled and unchecked by default", () => {
  const { dom, view } = setup();
  renderInside(dom, view, fixture(QUOTE_TRUE_ID));

  const boxes = checkboxes(dom.output);
  assert.deepEqual(boxes.map((b) => b.text), ["Match is cash", "Nothing bought yet"]);
  for (const b of boxes) {
    assert.ok(b.input, "label contains an input");
    assert.equal(b.input.type, "checkbox");
    assert.equal(b.input.checked, false);
    assert.equal(b.input.listenerCount("change"), 1);
  }
  assert.deepEqual(boxes.map((b) => b.input.getAttribute("name")), ["match_is_cash", "nothing_bought"]);
  assert.deepEqual(view.getApplicantChecks(), { match_is_cash: false, nothing_bought: false });
});

// Requirements 2.10, 2.11, 2.12
test("toggling a checkbox changes only getApplicantChecks(); the Record is unchanged", () => {
  const { dom, view } = setup();
  const record = fixture(QUOTE_TRUE_ID);
  const original = structuredClone(record);

  renderInside(dom, view, record);
  assert.deepEqual(record, original, "render leaves the Record unchanged");

  const outputBefore = snapshot(dom.output);
  const [cash, bought] = checkboxes(dom.output).map((b) => b.input);

  // Toggle "Match is cash" on.
  let logStart = dom.log.length;
  cash.checked = true;
  cash.dispatch("change");
  // The only mutation is the test's own write to `checked`; the handler
  // changes no element.
  assert.deepEqual(dom.log.slice(logStart).map((e) => [e.target, e.op, e.key]),
    [[cash, "set", "checked"]]);
  assert.deepEqual(view.getApplicantChecks(), { match_is_cash: true, nothing_bought: false });

  // Toggle "Nothing bought yet" on, then "Match is cash" off.
  bought.checked = true;
  bought.dispatch("change");
  assert.deepEqual(view.getApplicantChecks(), { match_is_cash: true, nothing_bought: true });
  logStart = dom.log.length;
  cash.checked = false;
  cash.dispatch("change");
  assert.deepEqual(dom.log.slice(logStart).map((e) => [e.target, e.op, e.key]),
    [[cash, "set", "checked"]]);
  assert.deepEqual(view.getApplicantChecks(), { match_is_cash: false, nothing_bought: true });

  // Apart from the `checked` values set above, the rendered DOM is as before.
  const expected = structuredClone(outputBefore);
  const boxSnap = expected.children[expected.children.length - 1];
  boxSnap.children[1].children[0].props.checked = true;
  assert.deepEqual(snapshot(dom.output), expected);

  assert.deepEqual(record, original, "toggling leaves the Record unchanged");
  assert.deepEqual(snapshot(dom.sibling).text, "Greenhouse finder");
});

// Requirement 2.10: a later render shows the current Applicant_Checks.
test("re-render shows the current Applicant_Checks values", () => {
  const { dom, view } = setup();
  const record = fixture(QUOTE_TRUE_ID);
  renderInside(dom, view, record);
  const [, bought] = checkboxes(dom.output).map((b) => b.input);
  bought.checked = true;
  bought.dispatch("change");

  renderInside(dom, view, fixture(QUOTE_FALSE_ID));
  const inputs = checkboxes(dom.output).map((b) => b.input);
  assert.equal(inputs.length, 2, "old checkboxes were cleared");
  assert.deepEqual(inputs.map((i) => i.checked), [false, true]);
  assert.equal(findAll(dom.output, "table").length, 1, "old draft was cleared");
});

test("getApplicantChecks returns a copy", () => {
  const { dom, view } = setup();
  renderInside(dom, view, fixture(QUOTE_TRUE_ID));
  const copy = view.getApplicantChecks();
  copy.match_is_cash = true;
  copy.nothing_bought = true;
  copy.extra = 1;
  assert.deepEqual(view.getApplicantChecks(), { match_is_cash: false, nothing_bought: false });
  assert.notEqual(view.getApplicantChecks(), view.getApplicantChecks());
});

// Requirement 2.12
test("render is a no-op when #agent-output is absent", () => {
  const { dom, view } = setup({ withOutput: false });
  const htmlBefore = snapshot(dom.html);
  view.render(fixture(QUOTE_TRUE_ID));
  assert.deepEqual(dom.log, []);
  assert.deepEqual(dom.created, []);
  assert.deepEqual(snapshot(dom.html), htmlBefore);
});

test("a successful render shows the label, sections, table and Quote_Request (quote missing)", () => {
  const { dom, view } = setup();
  const record = fixture(QUOTE_FALSE_ID);
  renderInside(dom, view, record);
  const out = dom.output;
  const flat = GW.flatten(record);

  assert.equal(byClass(out, "p", "agent-error").length, 0);

  // Quote_Missing_Label is the first line.
  assert.equal(out.firstChild.tagName, "P");
  assert.equal(out.firstChild.textContent, "application draft: quote missing");

  // One <section> per manifest Section, in order, with the Filled_Text.
  const sections = findAll(out, "section");
  assert.equal(sections.length, MANIFEST.sections.length);
  sections.forEach((sec, i) => {
    const s = MANIFEST.sections[i];
    assert.equal(findAll(sec, "h3")[0].textContent, s.name);
    assert.equal(findAll(sec, "p")[0].textContent, GW.fill(s.template, flat));
  });
  assert.ok(sections[0].textContent.includes("{UNKNOWN: deadline}"));

  // Fixes_Table: header row plus one row per fix, cells copied.
  const tables = findAll(out, "table");
  assert.equal(tables.length, 1);
  const rows = findAll(tables[0], "tr");
  const expected = GW.renderFixesTable(record);
  assert.equal(rows.length, record.fixes.length + 1);
  rows.forEach((tr, i) => {
    const cells = findAll(tr, i === 0 ? "th" : "td");
    assert.deepEqual(cells.map((c) => c.textContent), expected[i]);
  });

  // Quote_Request.
  const quote = byClass(out, "div", "agent-quote-request");
  assert.equal(quote.length, 1);
  assert.equal(findAll(quote[0], "p")[0].textContent, GW.fill(GW.QUOTE_REQUEST_TEMPLATE, flat));

  // Checkboxes come last.
  const last = out.childNodes[out.childNodes.length - 1];
  assert.equal(last.getAttribute("class"), "agent-applicant-checks");
});

test("a successful render omits the label when quote_uploaded is true", () => {
  const { dom, view } = setup();
  renderInside(dom, view, fixture(QUOTE_TRUE_ID));
  const out = dom.output;
  assert.equal(out.firstChild.tagName, "SECTION");
  assert.ok(!out.textContent.includes(GW.QUOTE_MISSING_LABEL));
  assert.equal(findAll(out, "section").length, MANIFEST.sections.length);
  assert.equal(findAll(out, "table").length, 1);
});

test("a buildDraft error (empty fixes) shows an error instead of the draft", () => {
  const { dom, view } = setup();
  const record = fixture(EMPTY_FIXES_ID);
  const original = structuredClone(record);
  renderInside(dom, view, record);
  assertErrorShown(dom.output, /grant_request|top_fix_name/);
  assert.equal(checkboxes(dom.output).length, 2, "checkboxes stay visible with an error");
  assert.deepEqual(record, original);
});

test("a Template with a foreign number shows a number-check error", () => {
  const { dom, view } = setup({ manifest: FOREIGN_NUMBER_MANIFEST });
  renderInside(dom, view, fixture(QUOTE_TRUE_ID));
  assertErrorShown(dom.output, /Number check failed.*Budget.*123457/);
  assert.equal(checkboxes(dom.output).length, 2);
});

test("a missing AGENT_CACHE shows an error", () => {
  const { dom, view } = setup({ manifest: undefined });
  renderInside(dom, view, fixture(QUOTE_TRUE_ID));
  assertErrorShown(dom.output, /AGENT_CACHE/);
  assert.equal(checkboxes(dom.output).length, 2);
});

// Browser wiring: classic scripts in a vm context with a fake window.
test("classic scripts wire the global AgentView in a browser-like context", () => {
  const dom = createFakeDocument();
  const context = { console, document: dom.document };
  context.window = context;
  context.self = context;
  vm.createContext(context);

  const agentsDir = path.join(__dirname, "..");
  for (const file of ["format.js", "check_numbers.js", "grant_writer.js"]) {
    vm.runInContext(fs.readFileSync(path.join(agentsDir, file), "utf8"), context, { filename: file });
  }
  // Stands in for agents/cache/manifest.js.
  vm.runInContext("window.AGENT_CACHE = " + JSON.stringify(MANIFEST) + ";", context,
    { filename: "manifest.js" });
  vm.runInContext(fs.readFileSync(path.join(agentsDir, "browser.js"), "utf8"), context,
    { filename: "browser.js" });

  assert.equal(typeof context.AgentView, "object");
  assert.equal(typeof context.AgentView.render, "function");
  assert.equal(typeof context.AgentView.getApplicantChecks, "function");

  const record = fixture(QUOTE_FALSE_ID);
  const original = structuredClone(record);
  renderInside(dom, context.AgentView, record);
  assert.equal(byClass(dom.output, "p", "agent-error").length, 0, dom.output.textContent);
  assert.equal(dom.output.firstChild.textContent, GW.QUOTE_MISSING_LABEL);
  assert.equal(findAll(dom.output, "section").length, MANIFEST.sections.length);

  const [cash] = checkboxes(dom.output).map((b) => b.input);
  cash.checked = true;
  cash.dispatch("change");
  // The copy comes from the vm realm, so compare as JSON.
  assert.equal(JSON.stringify(context.AgentView.getApplicantChecks()),
    JSON.stringify({ match_is_cash: true, nothing_bought: false }));
  assert.deepEqual(record, original);
});
