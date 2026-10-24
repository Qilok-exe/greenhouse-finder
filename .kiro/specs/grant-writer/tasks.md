# Implementation Plan: Grant Writer

## Overview

Build the Grant Writer in JavaScript (Node v24, CommonJS plus UMD for browser-shared files), entirely inside `agents/`. Order: test setup, the shared number formatter, the cache, the Nova client in mock mode, the pure `grant_writer.js` functions, extraction and template generation, the number checker and its hook, the precompute script with mock responses, and finally the browser view.

Constraints that apply to every task:
- Never edit `data/`, `calculator.js` or `app.html`. They belong to Person B.
- Use the field names in `data/record-shape.md` exactly. Never rename them.
- Templates contain no digits. A model never writes a number; code fills every Placeholder.
- Never invent a program name, cost-share percentage, deadline or fuel price. Write `{UNKNOWN: ...}` instead.

Hand-off to Person B (not a task): `app.html` needs the script tags in this order: `agents/format.js`, `agents/check_numbers.js`, `agents/grant_writer.js`, `agents/cache/manifest.js`, `agents/browser.js`. It also needs a `<div id="agent-output">` and a call to `AgentView.render(record)` when a greenhouse is selected. The ready-to-paste snippets are already in `agents/INTEGRATION.md`.

## Tasks

- [x] 1. Set up the package and test fixtures
  - [x] 1.1 Create `agents/package.json`
    - CommonJS (`"type": "commonjs"`), dependency `@aws-sdk/client-bedrock-runtime`, dev dependency `fast-check`
    - Test script `node --test agents/test/`
    - _Requirements: 1.1, 5.3_
  - [x] 1.2 Create `agents/test/fixtures/records.json`
    - Records with exactly the `data/record-shape.md` fields: `id, name, lat, lon, sqft, bays, covering, town, utility, hdd, price_per_gal, estimate {low, high, point, confidence, method}, fixes [{name, saves_usd, cost_usd, payback_years}], evidence {bill_uploaded, quote_uploaded, answers}`
    - Include a Record with `quote_uploaded` true and one with false, one with a tied top `saves_usd`, one with empty `fixes`, one with invalid `price_per_gal`, and one whose `name` contains a digit
    - _Requirements: 2.7, 2.8, 3.3, 3.5_

- [x] 2. Implement the shared number formatter in `agents/format.js`
  - [x] 2.1 Write `formatNumber` and `NUMBER_RE` as a UMD file (global `AgentFormat`)
    - `formatNumber`: throws on non-finite input, shortest round-trip decimal with exponents expanded, comma thousands grouping, leading `-` for negatives, no rounding, no currency symbol
    - `NUMBER_RE = /[$€£]?\d(?:[\d,]*\d)?(?:\.\d+)?%?/g`
    - _Requirements: 3.10, 4.1_
  - [x] 2.2 Write property test for the formatter
    - **Property 3: Number formatting round trip**
    - **Validates: Requirements 3.10, 4.1**

- [x] 3. Implement the disk cache in `agents/cache_store.js`
  - [x] 3.1 Write `cacheKey` and `cachedCall`
    - `cacheKey(modelId, prompt, pdfBytes|null)` as sha256 of `JSON.stringify([modelId, prompt, pdfHash|null])`
    - `cachedCall({ prompt, pdfBytes, call, validate })`: return a hit unchanged; throw naming the path on an unreadable or zero-byte entry; on a miss call, validate, then write `{ "text" }` via tmp file and rename; create `agents/cache/` if absent; on write failure delete the tmp file and throw naming the path
    - _Requirements: 5.1, 5.2, 5.4, 5.6, 5.7_
  - [x] 3.2 Write property and unit tests for the cache
    - **Property 16: Cache_Key sensitivity**, **Property 17: Cache hit and idempotence**, **Property 18: Rejected responses are never cached**
    - Unit tests: zero-byte entry throws with zero calls; simulated rename failure leaves no file
    - Use `fs.mkdtemp` directories and fake `call` functions
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.6, 5.7**

- [x] 4. Implement the Nova client in `agents/nova_api.js`
  - [x] 4.1 Write Mock_Mode first (AWS access is pending)
    - When `AWS_BEARER_TOKEN_BEDROCK` is unset: log `MOCK MODE`, make no network call, read `agents/cache/mock/<cacheKey>.json` and return its `text`
    - Missing mock file throws `Mock response missing: <absolute path>`
    - Export `askNova`, `askNovaWithPdf`, `REGION = "us-east-1"`, `MODEL_ID = "us.amazon.nova-2-lite-v1:0"`
    - _Requirements: 1.2, 1.3_
  - [x] 4.2 DEFERRED until the user says AWS is ready: Write the live Converse path
    - One `ConverseCommand` per call, `temperature: 0`, PDF as a `document` block with `format: "pdf"`; return the concatenated text blocks
    - Read the token from the environment only; never log or commit it
    - Add a code comment: verify whether the installed SDK reads `AWS_BEARER_TOKEN_BEDROCK` itself; fallback is `fetch` to the Bedrock `converse` endpoint with `Authorization: Bearer <token>`
    - _Requirements: 1.1_
  - [x] 4.3 Write unit tests for Mock_Mode
    - Logs `MOCK MODE`; the Bedrock SDK is not loaded; missing-file error names the expected path
    - _Requirements: 1.2, 1.3_

- [x] 5. Implement the pure parts of `agents/grant_writer.js`
  - [x] 5.1 Write constants, `PLACEHOLDER_NAMES`, `flatten`, `fill` and `validateTemplate` as a UMD file (global `AgentGrantWriter`, no `require` of Node modules)
    - `GRANT_SHARE = 0.8` and `GRANT_CAP_USD = 50000`, with comments citing the CSAP FY26 RFR and Round II how-to page (minimum 20% cash match; Greenhouse Energy Efficiency maximum $50,000)
    - `CO2_KG_PER_GALLON = 5.72`, with the comment "user-supplied propane factor"
    - `PLACEHOLDER_NAMES`: the ten top-level scalar fields (no `bays`) plus the eleven Derived_Fields
    - `flatten`: follow the derivation table in design.md; omit fields with invalid inputs, never set them to `null`; do not mutate the Record
    - `fill`: single pass; keep Unknown_Markers verbatim; numbers through `formatNumber`; throw once naming every bad or missing token
    - `validateTemplate`: reject empty text, digits, non-Placeholder tokens (including `{bays}` and dotted paths), empty Unknown_Markers, stray braces, and Placeholders joined only by `,` or `.`; list every offender
    - _Requirements: 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 3.9, 3.10, 3.12_
  - [x] 5.2 Write `renderFixesTable`, `fixesTableText`, `QUOTE_REQUEST_TEMPLATE` and `buildDraft`
    - Fixes_Table: header row plus one row per element of `record.fixes`, values copied, no totals row, no model text
    - `QUOTE_REQUEST_TEMPLATE`: digit-free code constant using `{top_fix_name}`, `{sqft}`, `{covering}`, `{town}`; never a vendor price
    - `buildDraft(record, manifest)`: throw naming `evidence.quote_uploaded` if it is not a boolean; label `application draft: quote missing` when it is false, `null` when true
    - _Requirements: 2.5, 2.6, 2.7, 2.8, 2.9_
  - [x] 5.3 Write property tests for `flatten`, `fill` and `validateTemplate`
    - **Property 1: Top_Fix and grant split**, **Property 2: flatten matches the derivation table**, **Property 4: fill completeness**, **Property 5: Unknown_Markers and prose preserved**, **Property 6: fill rejects bad tokens**, **Property 7: flatten and fill are pure**, **Property 8: Template validation**
    - Shared generators: Records in the frozen shape (strings may contain digits but no braces, `fixes` of length 0 to 6), and digit-free Templates
    - **Validates: Requirements 2.2, 2.3, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.11, 3.12**
  - [x] 5.4 Write property and unit tests for the draft
    - **Property 13: Quote_Missing_Label**
    - Unit tests: `QUOTE_REQUEST_TEMPLATE` passes `validateTemplate`; constants exist with comments; non-boolean `quote_uploaded` throws
    - **Validates: Requirements 2.5, 2.7, 2.8, 2.9, 3.1**

- [x] 6. Implement extraction and Template generation in `agents/grant_writer.js`
  - [x] 6.1 Write `extractSections`, `parseSections` and `generateTemplates` with injected `deps` (`readRulebook`, `ask`, `askWithPdf`, `cachedCall`)
    - `extractSections`: throw naming `agents/rulebook.pdf` and "missing" or "empty" before any call; pass the full bytes unmodified in one `askWithPdf` request; never fetch the rulebook from a URL
    - `parseSections`: strip code fences, parse JSON, trim, keep order; throw `no sections extracted` or name the empty or duplicated Section; never hardcode Section names
    - `generateTemplates`: one request per Section in order; prompt includes the Section name, criteria, every Placeholder, the no-digit rule, fixes only via `top_fix_*`, and `{UNKNOWN: ...}` for any program name, cost-share percentage, deadline or fuel price; validate with `validateTemplate`; prefix errors with the Section name
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.8, 2.1, 2.3, 2.4, 5.1, 5.4_
  - [x] 6.2 Write property and unit tests for extraction and generation
    - **Property 14: Section parsing**, **Property 15: One Template request per Section**
    - Unit tests: rulebook bytes reach a fake `askWithPdf` unmodified; missing and empty rulebook throw before any call; the prompt contains the 2.4 instructions; a Nova error carries the Section name
    - **Validates: Requirements 1.4, 1.5, 1.6, 1.7, 1.8, 2.1, 2.4**

- [x] 7. Implement the number checker and its Kiro hook
  - [x] 7.1 Write `checkNumbers` in `agents/check_numbers.js` as a UMD file (global `AgentCheckNumbers`)
    - Throw naming `text` or `flatRecord` on a bad argument type
    - Allowed set: every finite number at any depth plus every `NUMBER_RE` token inside any string, compared as absolute values
    - Allow years 1900 to 2099 (four bare digits) and integers after `Section `; return rejected tokens as written, in order, without throwing
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [x] 7.2 Add the CLI to `agents/check_numbers.js`
    - Load `agents/cache/manifest.json` and Records from `agents/test/fixtures/records.json` plus `data/*.json` elements that have `fixes` and `evidence` (read only, never write `data/`)
    - Check each Section's `fill` output and `fixesTableText`; print `PASS` or `<Section name | Fixes_Table>: <rejected numbers>`; report a `fill` throw as a failure; exit 0 or 1
    - _Requirements: 4.8, 4.9_
  - [x] 7.3 Create the hook `.kiro/hooks/check-numbers.json` with the `createHook` tool (do not hand-write it)
    - Trigger `PostFileSave`, matcher `agents[\\/]`, command `node agents/check_numbers.js`
    - _Requirements: 4.9_
  - [x] 7.4 Write property tests for the checker
    - **Property 9: Fill then check round trip**, **Property 10: Fixes_Table is copied and checks clean**, **Property 11: Foreign numbers are rejected in order**, **Property 12: Allowed_Numbers**
    - **Validates: Requirements 2.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.8**

- [x] 8. Implement precompute and the mock run
  - [x] 8.1 Write `agents/precompute.js`
    - Wire Node deps (rulebook reader for `agents/rulebook.pdf`, `nova_api`, `cachedCall`), run `extractSections` then `generateTemplates`
    - Write `agents/cache/manifest.json` (`model_id`, `rulebook_sha256`, `sections` with `name`, `criteria`, `template`) and `agents/cache/manifest.js` (`window.AGENT_CACHE = ...;`) only after a full successful run; any error exits 1 with no manifest written
    - _Requirements: 5.1, 5.3, 5.5_
  - [x] 8.2 Add mock responses under `agents/cache/mock/`
    - One extraction response (JSON Section list taken from the Rulebook text, not invented) and one digit-free Template per Section, each named by its `cacheKey`; add them one run at a time, since Template prompts depend on the extraction output
    - Templates use only Placeholders and `{UNKNOWN: ...}`; no program name, cost-share percentage, deadline or fuel price is invented
    - _Requirements: 1.2, 1.5, 2.2, 2.4, 5.5_
  - [x] 8.3 Write unit tests for precompute
    - Manifests are written only on success; a second mock run makes zero Nova calls and produces byte-identical output
    - _Requirements: 5.3, 5.5_

- [x] 9. Implement the browser view in `agents/browser.js`
  - [x] 9.1 Write `AgentView` with `render(record)` and `getApplicantChecks()`
    - In-memory `applicantChecks = { match_is_cash: false, nothing_bought: false }`; not stored in the Record or `data/`; `getApplicantChecks()` returns a copy for the Reviewer
    - `render`: no-op if `#agent-output` is absent; otherwise clear it and render with `textContent` only: label line, one `<section>` per Section, the Fixes_Table as a `<table>`, the Quote_Request, and checkboxes "Match is cash" and "Nothing bought yet"
    - Run `checkNumbers` on every Filled_Text and the Fixes_Table; on any failure or `buildDraft` error, show the error instead of the draft
    - Read `window.AGENT_CACHE` only: no Nova call, no `fetch`, no change to any element outside `#agent-output`, no edit to `app.html`
    - _Requirements: 2.10, 2.11, 2.12, 5.5_
  - [x] 9.2 Write DOM tests with a minimal fake `document`
    - Checkboxes default unchecked; toggling changes only `getApplicantChecks()`; the Record is deep-equal before and after; nothing outside `#agent-output` is created or changed
    - _Requirements: 2.10, 2.11, 2.12_

- [x] 10. Final checkpoint
  - Run `node --test agents/test/` and `node agents/check_numbers.js`; both must pass. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Property tests use fast-check with at least 100 runs and the comment `// Feature: grant-writer, Property <n>: <title>`.
- Task 4.2 is deferred and marked optional so "Run required tasks" skips it. Do not start it until the user says AWS is ready. Everything else runs in Mock_Mode.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "4.1", "5.1", "7.1"] },
    { "id": 3, "tasks": ["4.2", "5.2"] },
    { "id": 4, "tasks": ["4.3", "5.3", "5.4", "6.1", "7.2", "9.1"] },
    { "id": 5, "tasks": ["6.2", "7.3", "7.4", "8.1", "9.2"] },
    { "id": 6, "tasks": ["8.2"] },
    { "id": 7, "tasks": ["8.3"] }
  ]
}
```
