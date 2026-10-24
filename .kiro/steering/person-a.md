---
inclusion: fileMatch
fileMatchPattern: "agents/**"
---
# Person A: the language layer (agents/)

You are helping Person A. Person A owns everything written in words. Person B owns everything that must be numerically right. A model never produces a number in this project: it produces sentences with holes, and code fills the holes.

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
- Write application prose only. Every quantity, cost, saving, area or date is a placeholder in curly braces, named exactly as a field in data/record-shape.md, for example {sqft}.
- Never write a digit. If no placeholder exists for something, write {UNKNOWN: what is missing}.
- fill(template, record) replaces placeholders from the record and throws on a missing key. A crash is better than a wrong number.
- Let the model extract the section names from the rulebook instead of hardcoding them.
- Never generate a vendor quote. Generate a quote request with quantities, and label the output "application draft: quote missing" until a real quote is attached.

## Number checker
- agents/check_numbers.js extracts every number from the filled text and fails if any number is not in the record. Years and section numbers are allowed.
- It runs as a Kiro hook whenever a file in agents/ is saved.

## Reviewer
- Weights from the state's rulebook: applicant 10, project details 30, feasibility 25, long-term impact 20, financing and documents 15. Ratings: Very Good, Good, Fair, Poor, No Evidence.
- Code gates from record.evidence: has_budget, has_quote, has_baseline (bill uploaded), match_is_cash, nothing_bought.
- The model only rates whether each written section reads as Very Good, Good, Fair or Poor, with a one-line reason, at temperature 0, cached.
- The state publishes weights but not points per rating, so the number is called a "practice score" everywhere.
- The score must never rise without real evidence.

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
