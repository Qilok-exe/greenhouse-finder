# Greenhouse finder

Greenhouse finder maps commercial greenhouses in the Connecticut River valley of Massachusetts and estimates how much propane each one burns in a winter. Click a greenhouse to see its estimated fuel cost, narrow the estimate with the gallons it actually burned, and see which fixes would save the most.

## How to run

From the project root:

```
python3 -m http.server 8000
```

Then open http://localhost:8000/app.html.

## Data sources

- Greenhouse outlines: [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, queried via the [Overpass API](https://overpass-api.de/). Map tiles are also from OpenStreetMap.
- Fuel rate: UW-Madison extension A3907-01, [Reducing Greenhouse Energy Consumption: An Overview](https://fyi.extension.wisc.edu/energy/files/2018/07/reducing_greenhouse_energy_consumption_-_an_overview.pdf). A 24,000 sq ft double-poly house uses an estimated 11,929 gallons of LP gas.
- Propane price: [U.S. Energy Information Administration](https://www.eia.gov/petroleum/heatingoilpropane/), Massachusetts residential propane, weekly series, week of 19 October 2026.
- Town names: reverse geocoding with [Nominatim](https://nominatim.org/).

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
