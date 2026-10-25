# Greenhouse finder

Greenhouse finder maps commercial greenhouses in the Connecticut River valley of Massachusetts and estimates how much propane each one burns in a winter. Click a greenhouse to see its estimated fuel cost, narrow the estimate with the gallons it actually burned, see which fixes would save the most, and get a draft grant application to pay for them.

## Try it

[Open Greenhouse Finder](https://greenhouseinitiative.netlify.app/app.html)

### Run it locally

From the repo root, run:

```
python3 -m http.server 8000
```

Then open http://localhost:8000/app.html. Opening app.html straight from disk can fail in some browsers, so use the local server instead.

## The problem

A greenhouse is a thin plastic or glass shell, so it loses heat fast and burns a lot of propane in winter. We estimate the 217 commercial greenhouses in the Connecticut River valley will burn about $2.5 million of it this winter. There is no public list of which buildings they are or what each one spends. Massachusetts has grant money for fixes, but a farmer has to work out the savings and write the application alone.

## What it does

1. Finds greenhouse outlines in OpenStreetMap and measures each one in code.
2. Estimates each one's winter fuel bill as a range. Darker on the map means more money.
3. Lets the farmer enter last winter's gallons, which narrows the range.
4. Ranks the fixes by dollars saved.
5. Drafts a Climate Smart Agriculture grant application.

For example, a 7,945 sq ft greenhouse in Amherst is estimated at about $8,100 to $27,300 this winter. After the farmer enters 2,000 gallons, the range narrows to about $6,600 to $8,100.

## How the grant draft works

(From agents/INTEGRATION.md, agents/precompute.js, agents/nova_api.js and agents/grant_writer.js.)

Amazon Nova reads the state rulebook ahead of time and writes one template per section. The page reads the cached templates and never calls the model. The model writes only placeholders, and the calculator fills in every number. The draft stays marked "quote missing" until a real quote is attached.

The grant it drafts covers up to $50,000, and the farmer must put in a cash match of at least 20%.

## How we built it with Kiro

Two people built this, each with their own Kiro account. We split the code by folder: one person owned data/, calculator.js and app.html; the other owned agents/ and .kiro/.

- Rules for the model live in .kiro/steering/.
- The spec in .kiro/specs/grant-writer/ (requirements, design and tasks) was written before the code.
- The hook in .kiro/hooks/check-numbers.json runs after a file under agents/ is saved. It runs the number checker over every cached template's filled text and the fixes table for each available record, and reports PASS or the section name and the rejected numbers.
- Design skills live in .kiro/skills/.
- We used git to join the two halves of the work.

## Data sources

- Greenhouse outlines: [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, queried via the [Overpass API](https://overpass-api.de/). Map tiles are also from OpenStreetMap.
- 2025 aerial imagery: [MassGIS](https://www.mass.gov/orgs/massgis-bureau-of-geographic-information).
- Fuel rate: UW-Madison extension A3907-01, [Reducing Greenhouse Energy Consumption: An Overview](https://fyi.extension.wisc.edu/energy/files/2018/07/reducing_greenhouse_energy_consumption_-_an_overview.pdf). A 24,000 sq ft double-poly house uses an estimated 11,929 gallons of LP gas.
- Propane price: [U.S. Energy Information Administration](https://www.eia.gov/petroleum/heatingoilpropane/), Massachusetts residential propane, weekly series, week of 19 October 2026.
- Town names: reverse geocoding with [Nominatim](https://nominatim.org/).
- Grant text: [Amazon Nova](https://aws.amazon.com/ai/generative-ai/nova/) on AWS Bedrock.

## Headline figures

- 217 greenhouses
- 1,369,180 sq ft under cover
- an estimated $2,490,786 burned this winter

## These are estimates

Every figure here is an estimate, not an energy audit. It is calculated from building size alone unless a farm enters the gallons it actually burned. The assumptions are:

- Double-poly covering for every greenhouse, because the map data does not record the covering.
- A heated season comparable to the source case, mid-February to end of May.
- Propane at $3.66 per gallon.

## Coverage

The data covers the Connecticut River valley, not just Hampshire County. It includes towns in Franklin County (for example Whately, Montague, Sunderland, Deerfield and Ashfield) and Hampden County (for example Westfield, Ludlow and Springfield).

## Tests

- Calculator tests: run `bun test` from the repo root.
- Agents tests: run `cd agents && npm test`.

## Project layout

- `data/` — greenhouse outlines and records.
- `agents/` — the grant draft code and its cached templates.
- `.kiro/` — steering rules, the spec, the hook and design skills.
- `app.html` — the map and the page the farmer uses.
- `calculator.js` — the fuel and savings estimates.
