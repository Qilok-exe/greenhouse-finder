# Record shape — FROZEN. Do not rename fields.

{
  id, name, lat, lon,
  sqft, bays, covering, town, utility, hdd, price_per_gal,
  estimate: { low, high, point, confidence, method },
  fixes: [ {name, saves_usd, cost_usd, payback_years} ],
  evidence: { bill_uploaded, quote_uploaded, answers }
}

Person B produces this. Person A consumes it.
Nobody renames a field after the other has built against it.