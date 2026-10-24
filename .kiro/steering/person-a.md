---
inclusion: fileMatch
fileMatchPattern: "agents/**"
---
# Person A: the language layer (agents/)

You are helping Person A. Person A owns everything written in words. Person B owns everything that must be numerically right, with one recorded exception: the grant calculations (see "Recorded departures" below). A model never produces a number in this project: it produces sentences with holes, and code fills the holes.

## Ownership
- Person A owns: agents/ (nova_api.js, grant_writer.js, reviewer.js, check_numbers.js, browser.js, cache/).
- Never edit: data/, calculator.js, app.html. Those belong to Person B.
- Render only inside `<div id="agent-output">`. Never touch any other element.
- The record shape is in data/record-shape.md. Never rename its fields.

## Agents in scope
- Grant Writer: build. Reads agents/rulebook.pdf (the state CSAP rulebook) with Amazon Nova and writes the application sections.
- Reviewer: hybrid. Code scores the published weights and evidence gates. The model only rates prose quality.
- Surveyor: last and optional. Count greenhouse bays from an aerial crop, nothing else.
- Cut: Interviewer, Engineer, Inspector. Person B does sensitivity and bill calibration in plain code.

## Model setup
- Amazon Nova 2 Lite via the Bedrock Converse API, region us-east-1, modelId "us.amazon.nova-2-lite-v1:0" (the "us." prefix is required).
- Credentials come from the AWS_BEARER_TOKEN_BEDROCK environment variable. Never commit keys.
- Precompute every model call and cache results in agents/cache/. The web page never calls the model live.

## The placeholder rule (non-negotiable)
- Write application prose only. Every quantity, cost, saving, area or date is a placeholder in curly braces, named exactly as a field in data/record-shape.md or a derived field created by flatten(record), for example {sqft} or {grant_request}.
- Never write a digit. If no placeholder exists for something, write {UNKNOWN: what is missing}.
- fill(template, record) replaces placeholders from the record and throws on a missing key. A crash is better than a wrong number.
- Let the model extract the section names from the rulebook instead of hardcoding them.
- Never generate a vendor quote. Generate a quote request with quantities, and label the output "application draft: quote missing" until a real quote is attached.

## Number checker
- agents/check_numbers.js extracts every number from the filled text and fails if any number is not in the record. Years and section numbers are allowed.
- It runs as a Kiro hook whenever a file in agents/ is saved.

## Reviewer
- Weights from the state's rulebook: applicant 10, project details 30, feasibility 25, long-term impact 20, financing and documents 15. Ratings: Very Good, Good, Fair, Poor, No Evidence.
- Code gates: has_budget, has_quote and has_baseline (bill uploaded) come from record.evidence. match_is_cash and nothing_bought come from the two checkboxes in agents/browser.js (read them with getApplicantChecks()), not from the record.
- The model only rates whether each written section reads as Very Good, Good, Fair or Poor, with a one-line reason, at temperature 0, cached.
- The state publishes weights but not points per rating, so the number is called a "practice score" everywhere.
- The score must never rise without real evidence.

## Recorded departures (grant-writer spec)
These were decided by Person A and override the defaults above.
1. Applicant checks come from checkboxes. "Match is cash" and "Nothing bought yet" are two checkboxes rendered inside `<div id="agent-output">`. Their state (match_is_cash, nothing_bought, both false by default) is held in memory in agents/browser.js. It is never stored in the record and never written to data/.
2. The grant calculations live in agents/. flatten(record) in agents/grant_writer.js derives grant_request, farmer_match, gallons_saved and carbon_tons_saved (plus the flat estimate_* and top_fix_* fields). The constants are GRANT_SHARE = 0.8 and GRANT_CAP_USD = 50000 (source: CSAP FY26 RFR and Round II how-to page: minimum 20% cash match, Greenhouse Energy Efficiency maximum $50,000) and CO2_KG_PER_GALLON = 5.72. All other numeric work stays with Person B.

## Order of work
1. One Nova call working: text first, then the PDF.
2. Grant Writer with the placeholder rule.
3. Number checker, made into a Kiro hook.
4. Reviewer, practice score and missing-items list.
5. Surveyor (bays only), only if ahead of schedule.
Stop after step 4 if time is short.

## Failure modes to avoid
- The model writes a number: the placeholder rule and the hook prevent it.
- A live model call during the demo: precompute and cache instead.
- The score moves when nothing changed: code owns the gates.
- The rulebook fetched from a URL: always use agents/rulebook.pdf on disk.
- Claiming a quote exists: keep the "quote missing" label until one is attached.
- A Bedrock access error: check model access and region before debugging code.

Never invent a program name, cost-share percentage, deadline or fuel price.