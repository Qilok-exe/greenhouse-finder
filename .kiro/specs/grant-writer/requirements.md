# Requirements Document

## Introduction

The Grant Writer turns the state CSAP rulebook (`agents/rulebook.pdf`) and one greenhouse record (shape frozen in `data/record-shape.md`) into application draft text. Amazon Nova reads the rulebook and writes each application section as a prose template. The model never writes a number: every quantity is a `{placeholder}`, and code fills it. A number checker then rejects any filled text containing a number that did not come from the flattened record.

The Grant Writer lives entirely in `agents/` (Person A). It reads `data/` but never edits `data/`, `calculator.js` or `app.html`. Record field names are used exactly as written in `data/record-shape.md` and are never renamed.

The Nova client `agents/nova_api.js` is in scope (Requirement 1). AWS access is pending, so mock mode is built first.

Assumptions and accepted trade-offs:
- The top fix is the element of `record.fixes` with the largest `saves_usd`. On a tie, the earliest element in the array wins. The user can override this rule.
- A number that appears inside a Flat_Record string field (for example a digit in `name`) counts as a Flat_Record value in `checkNumbers`. The user accepted this: Templates are digit-free, so `checkNumbers` is a backstop, not the primary guard.

Confirmed by the user:
- `farmer_match` = `top_fix_cost_usd` − `grant_request`.
- Rounding happens in `flatten`, so the stored value equals the displayed value: `grant_request` and `farmer_match` to whole dollars, `gallons_saved` to whole gallons, `carbon_tons_saved` to one decimal place. `farmer_match` uses the rounded `grant_request` and `carbon_tons_saved` uses the rounded `gallons_saved`, so the displayed numbers agree with each other.
- `fill` throws on a Placeholder whose key is missing from the Flat_Record (Requirement 3.8), and `flatten` omits Derived_Fields with invalid inputs so that `fill` throws on them (Requirement 3.5).

Notes:
- The constants 0.8 (grant share) and 50000 (grant cap in USD) are confirmed by the state's CSAP rulebook: a minimum 20% cash match, and a Greenhouse Energy Efficiency maximum of $50,000. Source: "CSAP FY26 RFR and Round II how-to page". The constant 5.72 (kg CO2 per gallon, a propane factor) is supplied by the user.
- `grant_request`, `farmer_match`, `gallons_saved` and `carbon_tons_saved` are numeric derivations that live in `agents/`. The steering file normally gives numeric work to Person B; the user chose this placement.

Design decisions flagged for the design phase:
- `{UNKNOWN: ...}` placeholders stay visible in filled text and do not cause `fill` to throw (Requirement 3).
- Number formatting (thousands separators, currency symbols, decimal places) must be the same in `fill` output, in the Fixes_Table and in `checkNumbers` matching.

## Glossary

- **Grant_Writer**: The module in `agents/grant_writer.js` that runs rulebook extraction and template generation and exposes `flatten` and `fill`.
- **Agent_View**: The browser code in `agents/browser.js` that renders Grant_Writer output and the Applicant_Checks checkboxes.
- **Agent_Output**: The element `<div id="agent-output">` in `app.html`, the only element the Agent_View renders into.
- **Nova_API**: The module `agents/nova_api.js` that exports `askNova(prompt)` and `askNovaWithPdf(prompt, pdfBytes)` and sends requests to Amazon Nova 2 Lite through the Bedrock Converse API, region `us-east-1`, modelId `us.amazon.nova-2-lite-v1:0`.
- **Mock_Mode**: The Nova_API state in which the environment variable `AWS_BEARER_TOKEN_BEDROCK` is not set.
- **Mock_Directory**: The directory `agents/cache/mock/` holding hand-provided model responses for Mock_Mode.
- **Number_Checker**: The module `agents/check_numbers.js` that exposes `checkNumbers(text, flatRecord)`.
- **Cache**: The directory `agents/cache/` holding stored model responses on disk.
- **Cache_Key**: A key computed from the full prompt text, the modelId and the PDF bytes sent with the request (none for a text-only request), such that a change to any one of these inputs produces a different key.
- **Rulebook**: The file `agents/rulebook.pdf` on local disk.
- **Record**: One greenhouse object matching the frozen shape in `data/record-shape.md`.
- **Top_Fix**: The element of `record.fixes` with the largest `saves_usd`; on a tie, the earliest such element in the array.
- **Grant_Constants**: The named constants `GRANT_SHARE` = 0.8 and `GRANT_CAP_USD` = 50000 (source: "CSAP FY26 RFR and Round II how-to page", which sets a minimum 20% cash match and a Greenhouse Energy Efficiency maximum of $50,000), and `CO2_KG_PER_GALLON` = 5.72 (source: user-supplied propane factor).
- **Derived_Field**: One of `estimate_low`, `estimate_high`, `estimate_point`, `top_fix_name`, `top_fix_saves_usd`, `top_fix_cost_usd`, `top_fix_payback_years`, `grant_request`, `farmer_match`, `gallons_saved`, `carbon_tons_saved`. Derived_Fields are computed by `flatten` and are not Record fields.
- **Flat_Record**: The new object returned by `flatten(record)`: every Record field unchanged, plus each Derived_Field whose inputs are valid under Requirement 3.
- **Placeholder_Name**: A Record top-level scalar field name other than `bays` (`id`, `name`, `lat`, `lon`, `sqft`, `covering`, `town`, `utility`, `hdd`, `price_per_gal`), or a Derived_Field name.
- **Placeholder**: The text `{` + Placeholder_Name + `}` inside a Template. `{bays}` and names of the `fixes`, `estimate` and `evidence` objects are not Placeholders.
- **Unknown_Marker**: The text `{UNKNOWN: <description of what is missing>}` inside a Template.
- **Section**: One application section named in the Rulebook, together with the evaluation criteria the Rulebook attaches to that section.
- **Template**: Prose for one Section that contains Placeholders and Unknown_Markers and contains zero digit characters.
- **Quote_Request**: Text asking a vendor for a price, listing quantities as Placeholders.
- **Quote_Missing_Label**: The exact text `application draft: quote missing`.
- **Filled_Text**: The output of `fill(template, flatten(record))`.
- **Fixes_Table**: The fixes table and budget table rendered by code from `record.fixes`, one row per element, containing only `name`, `saves_usd`, `cost_usd` and `payback_years` values copied from that element.
- **Application_Draft**: The combined output of the Grant_Writer for one Record: an optional Quote_Missing_Label line, then each Section's Filled_Text in Section-list order, then the Fixes_Table, then the Quote_Request.
- **Applicant_Checks**: Two booleans, `match_is_cash` and `nothing_bought`, held in memory in `agents/` module state, both false by default, stored neither in the Record nor in `data/`. The Reviewer (separate spec) reads them.
- **Allowed_Number**: A number in text that is a four-digit year from 1900 to 2099, or a section number that directly follows the word "Section".

## Requirements

### Requirement 1: Nova client and rulebook extraction

**User Story:** As Person A, I want one Nova client with a mock mode and an extraction step that lists the rulebook's sections and criteria, so that I can build before AWS access arrives and the application follows the state's own structure.

#### Acceptance Criteria

1. WHILE `AWS_BEARER_TOKEN_BEDROCK` is set, THE Nova_API SHALL send each `askNova(prompt)` or `askNovaWithPdf(prompt, pdfBytes)` call as one Bedrock Converse API request in region `us-east-1` with modelId `us.amazon.nova-2-lite-v1:0`, authenticated with the value of `AWS_BEARER_TOKEN_BEDROCK`, and return the response text.
2. WHILE the Nova_API is in Mock_Mode, THE Nova_API SHALL make zero network calls, log the text "MOCK MODE", and return the content of the file in the Mock_Directory named by the request's Cache_Key.
3. IF the Nova_API is in Mock_Mode and the Mock_Directory has no file for the request's Cache_Key, THEN THE Nova_API SHALL throw an error naming the expected mock file path and SHALL return no response text.
4. WHEN extraction runs, THE Grant_Writer SHALL read the complete Rulebook from `agents/rulebook.pdf` on local disk and pass its bytes, unmodified and untruncated, to `askNovaWithPdf` in a single extraction request.
5. WHEN the Nova_API returns an extraction response, THE Grant_Writer SHALL produce a list of Sections in response order, each with one name and zero or more evaluation criteria, every name and criterion equal to response text with only leading and trailing whitespace removed, and zero Section names or criteria taken from Grant_Writer source code or prompt text.
6. IF the Rulebook file is absent or has a size of zero bytes, THEN THE Grant_Writer SHALL stop before making any Nova_API call, with an error naming `agents/rulebook.pdf` and stating whether the file is missing or empty.
7. IF the Nova_API returns an error for any request, THEN THE Grant_Writer SHALL stop with an error that includes the Nova_API error message, and the Section name for a Template request, and SHALL produce no Section list or Application_Draft.
8. IF the extraction response cannot be parsed into a Section list, yields zero Sections, or contains a Section name that is empty after trimming or duplicated, THEN THE Grant_Writer SHALL stop with an error that includes "no sections extracted" or names the empty or duplicated Section, and SHALL produce no Section list.

### Requirement 2: Generate digit-free Templates and render the Application_Draft

**User Story:** As Person A, I want each section written as a template with placeholders only, and the applicant's two yes/no checks shown next to the draft, so that the model can never put a wrong number into the application and the Reviewer can read the applicant's answers.

#### Acceptance Criteria

1. WHEN the Section list is available, THE Grant_Writer SHALL send exactly one Template request per Section to the Nova_API, each containing that Section's name, its evaluation criteria and the list of every Placeholder (which excludes `{bays}`), and SHALL output the accepted Templates in Section-list order.
2. THE Grant_Writer SHALL accept a Template only when the Template contains at least one non-whitespace character, contains zero digit characters (0 through 9), and every brace-delimited token is either a Placeholder or an Unknown_Marker with a non-empty description.
3. IF a returned Template fails any acceptance check in criterion 2, including a `{bays}` token or a brace-delimited token naming `fixes`, `estimate`, `evidence` or a dotted path, THEN THE Grant_Writer SHALL reject the Template and stop with an error that reports the Section name and every offending digit character or token, and SHALL produce no Application_Draft.
4. WHEN the Grant_Writer sends a Template request, THE Grant_Writer SHALL include in the prompt an instruction to refer to fixes only through the `top_fix_*` Derived_Fields and to write each program name, cost-share percentage, deadline or fuel price that has no matching Placeholder as an Unknown_Marker naming the missing item.
5. WHEN the Grant_Writer produces the Application_Draft, THE Grant_Writer SHALL include a Quote_Request in place of every vendor quote or vendor price, and the Quote_Request SHALL pass every acceptance check in criterion 2.
6. WHEN the Grant_Writer produces the Application_Draft, THE Grant_Writer SHALL render the Fixes_Table in code from `record.fixes`, with zero Nova_API calls and zero model-generated text in the Fixes_Table.
7. WHILE `evidence.quote_uploaded` in the Record is false, THE Grant_Writer SHALL place the Quote_Missing_Label as the first line of the Application_Draft.
8. WHILE `evidence.quote_uploaded` in the Record is true, THE Grant_Writer SHALL omit the Quote_Missing_Label from the Application_Draft.
9. IF `evidence.quote_uploaded` is absent from the Record or is not a boolean, THEN THE Grant_Writer SHALL stop with an error naming `evidence.quote_uploaded` and SHALL produce no Application_Draft.
10. WHEN the Agent_View renders the Application_Draft, THE Agent_View SHALL render inside Agent_Output two checkboxes labelled "Match is cash" and "Nothing bought yet", each showing the current value of `match_is_cash` and `nothing_bought` in the Applicant_Checks, unchecked when the Applicant_Checks hold their default values.
11. WHEN the user toggles either checkbox, THE Agent_View SHALL set the matching Applicant_Checks boolean to the checkbox's checked state, leave the Record unchanged, and write nothing to `data/`.
12. THE Agent_View SHALL limit every DOM element it creates or modifies to Agent_Output and its descendants, with zero DOM elements outside Agent_Output created or modified.

### Requirement 3: Flatten the Record into derived fields and fill Templates

**User Story:** As Person A, I want flatten(record) to expose the estimate, the top fix and the grant figures as flat fields and fill(template, flatRecord) to crash on a missing key, so that templates can name these values and a wrong number can never reach the page.

#### Acceptance Criteria

1. THE Grant_Writer SHALL define the Grant_Constants as named constants in `agents/` code, each with a comment giving the constant's source, where the comments for `GRANT_SHARE` and `GRANT_CAP_USD` cite "CSAP FY26 RFR and Round II how-to page".
2. WHEN `flatten(record)` is called on a Record with an `estimate` object, THE Grant_Writer SHALL set `estimate_low`, `estimate_high` and `estimate_point` to `estimate.low`, `estimate.high` and `estimate.point`.
3. WHEN `flatten(record)` is called on a Record with at least one element in `fixes`, THE Grant_Writer SHALL set the `top_fix_*` Derived_Fields to the Top_Fix's `name`, `saves_usd`, `cost_usd` and `payback_years`, set `grant_request` to min(`GRANT_SHARE` × `top_fix_cost_usd`, `GRANT_CAP_USD`) rounded to whole dollars, and set `farmer_match` to `top_fix_cost_usd` − `grant_request` rounded to whole dollars.
4. WHEN `flatten(record)` is called on a Record with at least one element in `fixes` and a `price_per_gal` that is a number greater than zero, THE Grant_Writer SHALL set `gallons_saved` to `top_fix_saves_usd` / `price_per_gal` rounded to whole gallons and `carbon_tons_saved` to `gallons_saved` × `CO2_KG_PER_GALLON` / 1000 rounded to one decimal place.
5. IF `fixes` is absent or empty, `price_per_gal` is absent, not a number or at most zero, or `estimate` is absent, THEN THE Grant_Writer SHALL omit from the Flat_Record every Derived_Field that depends on the invalid input (all `top_fix_*`, `grant_request`, `farmer_match`, `gallons_saved` and `carbon_tons_saved` for `fixes`; `gallons_saved` and `carbon_tons_saved` for `price_per_gal`; all `estimate_*` for `estimate`), so that `fill` throws on the matching Placeholders.
6. FOR ALL Records with at least one element in `fixes`, `flatten(record).top_fix_saves_usd` SHALL equal the largest `saves_usd` in `fixes` with no earlier element of `fixes` having that same `saves_usd`, `grant_request` SHALL be at most `GRANT_CAP_USD`, and `grant_request` + `farmer_match` SHALL equal `top_fix_cost_usd` rounded to whole dollars (Top_Fix and grant-split property).
7. WHEN `fill(template, flatRecord)` is called, THE Grant_Writer SHALL replace every occurrence of each Placeholder with the value of that Placeholder_Name's top-level key in the Flat_Record.
8. IF a brace-delimited token that is not an Unknown_Marker is not a Placeholder (including `{bays}`, dotted paths and names of `fixes`, `estimate` or `evidence`), or names a key that is absent from the Flat_Record or holds a null, undefined, object or array value, THEN THE Grant_Writer SHALL throw an error naming every such token in the Template and SHALL return no Filled_Text.
9. WHEN `fill(template, flatRecord)` is called, THE Grant_Writer SHALL keep every Unknown_Marker and all Template text outside Placeholders unchanged character for character, including whitespace and line breaks, and SHALL throw no error because of any Unknown_Marker.
10. WHEN `fill` replaces a Placeholder whose value is a number, THE Grant_Writer SHALL render that number in the formatting that the Number_Checker parses, so that `checkNumbers` extracts from the rendered text a number equal to the value; WHEN the value is a string, THE Grant_Writer SHALL insert the string character for character.
11. FOR ALL Templates accepted under Requirement 2 and Flat_Records that contain a non-null number, string or boolean at every referenced Placeholder, the Filled_Text SHALL contain zero Placeholders (completeness property).
12. THE Grant_Writer SHALL leave the Record, the Flat_Record and the Template unmodified in `flatten` and `fill`, and SHALL return identical output for identical inputs.

### Requirement 4: Check every number in Filled_Text and the Fixes_Table against the Flat_Record

**User Story:** As Person A, I want checkNumbers(text, flatRecord) to fail on any number not in the flattened record, so that any number the model slipped in is caught before the demo.

#### Acceptance Criteria

1. WHEN `checkNumbers(text, flatRecord)` is called with a string and a Flat_Record, THE Number_Checker SHALL extract every number in the text. A number is a maximal run of digits that may contain comma thousands separators and at most one decimal point, may be preceded by a currency symbol and may be followed by a percent sign. Digits next to letters also count as numbers.
2. WHEN the numeric value of an extracted number (after removing the currency symbol, thousands separators and percent sign) equals a Flat_Record value, either directly or after the formatting rule shared with `fill`, THE Number_Checker SHALL accept that number. Flat_Record values are those at any depth: top-level fields including Derived_Fields, every field of `estimate` and `evidence`, every field of every element of `fixes`, and any number inside a Flat_Record string value.
3. WHEN an extracted number is an Allowed_Number, THE Number_Checker SHALL accept that number. A year qualifies only with exactly four digits, no separator, decimal point, currency symbol or percent sign, and a value from 1900 to 2099 inclusive. A section number qualifies only as an integer that follows the word "Section" and a single space.
4. IF an extracted number is neither a Flat_Record value nor an Allowed_Number, THEN THE Number_Checker SHALL return a failure result, without throwing, that lists each rejected number exactly as it appears in the text, once per occurrence, in order of appearance.
5. WHEN every extracted number is accepted, including the case of zero numbers, THE Number_Checker SHALL return a pass result with an empty list of rejected numbers.
6. IF `text` is not a string or `flatRecord` is not an object, THEN THE Number_Checker SHALL throw an error naming the invalid argument.
7. FOR ALL valid Templates and Records whose Flat_Record contains every referenced Placeholder, including Records whose string fields contain digits and Records with zero or more elements in `fixes`, `checkNumbers(fill(template, flatten(record)), flatten(record))` SHALL return a pass result (round-trip property).
8. FOR ALL Records, `checkNumbers(fixesTable, flatten(record))` on the Fixes_Table rendered from that Record SHALL return a pass result.
9. WHEN a file in `agents/` is saved, THE Number_Checker SHALL run as a Kiro hook that checks, for each available Record, the Filled_Text of every Template in the Cache and the Fixes_Table against `flatten(record)`, and reports either a pass or the Section name (or "Fixes_Table") and the rejected numbers for each failure.

### Requirement 5: Cache every model call

**User Story:** As Person A, I want every model result precomputed and cached on disk, so that the demo never depends on a live model call.

#### Acceptance Criteria

1. WHEN the Nova_API returns a response that passes validation (an extraction response accepted under Requirement 1 or a Template accepted under Requirement 2), THE Grant_Writer SHALL write the full response text to one file in the Cache named by the request's Cache_Key, creating `agents/cache/` first if it is absent.
2. WHEN a request's Cache_Key already exists in the Cache, THE Grant_Writer SHALL return the stored response text byte-for-byte unchanged and make zero Nova_API calls for that request.
3. FOR ALL requests, running the Grant_Writer twice with byte-identical Rulebook, identical prompt text and identical modelId SHALL produce byte-identical Sections and Templates on both runs, and the second run SHALL make zero Nova_API calls (idempotence property).
4. IF the Nova_API returns an error, or returns a response rejected under Requirement 1.8 or Requirement 2.3, THEN THE Grant_Writer SHALL write no Cache entry for that request and SHALL leave every existing Cache entry unchanged.
5. WHEN a full Grant_Writer run completes without error, THE Grant_Writer SHALL have written to the Cache the Section list and one Template per Section, so that the web page reads Cache files only and makes zero Nova_API calls.
6. IF a Cache entry exists for a request's Cache_Key but the file cannot be read or contains zero bytes, THEN THE Grant_Writer SHALL stop with an error naming the Cache file path and make zero Nova_API calls for that request.
7. IF writing a Cache entry fails, THEN THE Grant_Writer SHALL stop with an error naming the Cache file path and SHALL leave no Cache file for that key.
