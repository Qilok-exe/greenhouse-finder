"use strict";

/*
 * Minimal fake DOM for agents/browser.js tests.
 *
 * Implements only the surface listed in the browser.js header:
 *   document.getElementById, document.createElement, appendChild,
 *   removeChild, firstChild, textContent, setAttribute,
 *   addEventListener("change", fn), input.type, input.checked.
 *
 * Every mutation (appendChild, removeChild, textContent set, setAttribute,
 * addEventListener, any other property set) is appended to `log` with its
 * target element, so a test can check that nothing outside #agent-output
 * was touched. Setting innerHTML or outerHTML throws, so a test fails if
 * the code under test uses them instead of textContent.
 *
 * Tree built by createFakeDocument():
 *   <html>
 *     <body>
 *       <header id="app-header">Greenhouse finder</header>
 *       <div id="agent-output"></div>      (omitted with { withOutput: false })
 *     </body>
 *   </html>
 */

const FORBIDDEN = new Set(["innerHTML", "outerHTML"]);

function createFakeDocument(options) {
  const opts = options || {};
  const withOutput = opts.withOutput !== false;

  const log = [];        // { target, op, key? }
  const created = [];    // elements made by document.createElement
  let recording = false; // the initial tree is built before recording starts

  function record(target, op, key) {
    if (recording) log.push({ target, op, key });
  }

  function makeElement(tagName) {
    const state = {
      tagName: String(tagName).toUpperCase(),
      children: [],
      parent: null,
      text: "",
      attrs: Object.create(null),
      listeners: Object.create(null),
      props: Object.create(null)
    };
    if (state.tagName === "INPUT") {
      state.props.type = "text";
      state.props.checked = false;
    }

    let proxy;

    function detach(child) {
      const cs = child._state;
      if (cs.parent) {
        const siblings = cs.parent._state.children;
        siblings.splice(siblings.indexOf(child), 1);
        cs.parent = null;
      }
    }

    const api = {
      get _state() { return state; },
      get tagName() { return state.tagName; },
      get parentNode() { return state.parent; },
      get firstChild() { return state.children[0] || null; },
      get childNodes() { return state.children.slice(); },
      get children() { return state.children.slice(); },
      get textContent() {
        if (state.children.length === 0) return state.text;
        return state.text + state.children.map((c) => c.textContent).join("");
      },
      get id() { return state.attrs.id; },
      appendChild(child) {
        if (!child || !child._state) throw new TypeError("fake DOM: appendChild needs a fake element");
        record(proxy, "appendChild");
        if (child._state.parent) record(child._state.parent, "removeChild");
        detach(child);
        child._state.parent = proxy;
        state.children.push(child);
        return child;
      },
      removeChild(child) {
        if (!child || !child._state || child._state.parent !== proxy) {
          throw new Error("fake DOM: removeChild: node is not a child of this element");
        }
        record(proxy, "removeChild");
        detach(child);
        return child;
      },
      setAttribute(name, value) {
        record(proxy, "setAttribute", name);
        state.attrs[String(name)] = String(value);
      },
      getAttribute(name) {
        const v = state.attrs[String(name)];
        return v === undefined ? null : v;
      },
      addEventListener(type, fn) {
        record(proxy, "addEventListener", type);
        (state.listeners[type] = state.listeners[type] || []).push(fn);
      },
      // Test helper: fire every listener of `type` (not part of the real API).
      dispatch(type) {
        const event = { type, target: proxy, currentTarget: proxy };
        (state.listeners[type] || []).forEach((fn) => fn.call(proxy, event));
      },
      listenerCount(type) {
        return (state.listeners[type] || []).length;
      }
    };

    proxy = new Proxy(api, {
      get(target, key) {
        if (Object.prototype.hasOwnProperty.call(api, key)) return Reflect.get(api, key);
        return state.props[key];
      },
      set(target, key, value) {
        if (FORBIDDEN.has(key)) throw new Error("fake DOM: " + String(key) + " is forbidden, use textContent");
        if (key === "textContent") {
          record(proxy, "set", "textContent");
          state.children.slice().forEach(detach);
          state.text = value === null || value === undefined ? "" : String(value);
          return true;
        }
        if (Object.prototype.hasOwnProperty.call(api, key)) {
          throw new Error("fake DOM: cannot set read-only property " + String(key));
        }
        record(proxy, "set", key);
        state.props[key] = value;
        return true;
      }
    });
    return proxy;
  }

  // Initial tree.
  const html = makeElement("html");
  const body = makeElement("body");
  const sibling = makeElement("header");
  sibling.setAttribute("id", "app-header");
  sibling.textContent = "Greenhouse finder";
  html.appendChild(body);
  body.appendChild(sibling);
  let output = null;
  if (withOutput) {
    output = makeElement("div");
    output.setAttribute("id", "agent-output");
    body.appendChild(output);
  }

  function findById(node, id) {
    if (node.getAttribute("id") === id) return node;
    for (const c of node.childNodes) {
      const hit = findById(c, id);
      if (hit) return hit;
    }
    return null;
  }

  const docApi = {
    documentElement: html,
    body,
    getElementById(id) {
      return findById(html, String(id));
    },
    createElement(tagName) {
      const node = makeElement(tagName);
      created.push(node);
      return node;
    }
  };
  const document = new Proxy(docApi, {
    set(target, key) {
      if (recording) log.push({ target: document, op: "set", key });
      throw new Error("fake DOM: document." + String(key) + " must not be set");
    }
  });

  recording = true;
  return { document, html, body, sibling, output, log, created };
}

// True when `node` is `ancestor` or inside it.
function isInside(node, ancestor) {
  for (let n = node; n; n = n.parentNode) {
    if (n === ancestor) return true;
  }
  return false;
}

// Elements under `root` (not including root) with the given tag name.
function findAll(root, tagName) {
  const want = String(tagName).toUpperCase();
  const out = [];
  (function walk(n) {
    for (const c of n.childNodes) {
      if (c.tagName === want) out.push(c);
      walk(c);
    }
  })(root);
  return out;
}

// A plain snapshot of a subtree (tag, attributes, own text, children) for
// deep-equal comparisons before and after an action.
function snapshot(node) {
  const s = node._state;
  return {
    tag: s.tagName,
    attrs: { ...s.attrs },
    text: s.text,
    props: { ...s.props },
    children: s.children.map(snapshot)
  };
}

module.exports = { createFakeDocument, isInside, findAll, snapshot };
