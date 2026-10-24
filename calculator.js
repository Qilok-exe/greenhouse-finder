// calculator.js — greenhouse winter fuel estimates.
// Plain JavaScript, no dependencies. UMD wrapper: CommonJS in Bun/Node
// (require('./calculator.js')), global `Calculator` in the browser via a
// classic <script> tag (works under file://, unlike ES modules).

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Calculator = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Source: UW-Madison extension A3907-01. A 24,000 sq ft five-bay gutter-connected
  // house, double polyethylene with IR treatment, 78% seasonal heater efficiency,
  // heated 15 Feb–31 May, uses an estimated 11,929 gallons of LP gas.
  // https://fyi.extension.wisc.edu/energy/files/2018/07/reducing_greenhouse_energy_consumption_-_an_overview.pdf
  // Calibrated figure. Do not replace with a heat-loss formula.
  const BASE_GAL_PER_SQFT = 11929 / 24000;

  // Source: published ranges, same source: all single-walled glazings
  // 1.1–1.2 Btu/ft²-°F-hr; double-walled 0.5–0.7. Values chosen within those
  // ranges; only the ratio to double_poly is used.
  // https://fyi.extension.wisc.edu/energy/files/2018/07/reducing_greenhouse_energy_consumption_-_an_overview.pdf
  const U = Object.freeze({
    double_poly: 0.70,
    single_poly: 1.20,
    single_glass: 1.15,
    polycarbonate: 0.65,
  });

  // Source: Massachusetts residential propane, EIA weekly series, week of 19 Oct 2026
  // (USD per gallon). Matches the LP gas base figure above.
  const PRICE_PER_GAL = 3.66;

  // Source: project brief. Fraction of winter fuel cost saved by each fix.
  // `only` restricts a fix to one covering.
  const FIXES = Object.freeze([
    { name: 'Second poly layer', fraction: 0.35, only: 'single_poly' },
    { name: 'Thermal curtain', fraction: 0.25 },
    { name: 'Night setback 5°F', fraction: 0.12 },
    { name: 'Seal gaps and end walls', fraction: 0.10 },
  ]);

  function checkSqft(sqft) {
    if (typeof sqft !== 'number' || !Number.isFinite(sqft) || sqft < 0) {
      throw new TypeError(`sqft must be a non-negative number, got ${sqft}`);
    }
  }

  // Accepts dataset values like "double_poly (assumed)" or " Single_Poly ".
  // Returns the canonical U key, or throws if the covering is unknown.
  function normalizeCovering(covering) {
    const key =
      typeof covering === 'string'
        ? covering.trim().toLowerCase().replace(/\s*\(assumed\)$/, '')
        : covering;
    if (!Object.prototype.hasOwnProperty.call(U, key)) {
      throw new TypeError(
        `unknown covering "${covering}"; expected one of ${Object.keys(U).join(', ')}`
      );
    }
    return key;
  }

  // Unrounded gallons for a covering; rounding happens once, at the output.
  function rawGal(sqft, covering) {
    return sqft * BASE_GAL_PER_SQFT * (U[covering] / U.double_poly);
  }

  function toEstimate(gal) {
    return { gal: Math.round(gal), usd: Math.round(gal * PRICE_PER_GAL) };
  }

  function pointEstimate(sqft, covering) {
    checkSqft(sqft);
    const key = normalizeCovering(covering);
    return {
      ...toEstimate(rawGal(sqft, key)),
      method: `Building size × UW-Madison calibrated rate, scaled for ${key} covering, at EIA Massachusetts fuel price. Assumes a heated season comparable to the source case, mid-February to end of May.`,
    };
  }

  function wideRange(sqft) {
    checkSqft(sqft);
    return {
      low: toEstimate(rawGal(sqft, 'polycarbonate') * 0.6),
      high: toEstimate(rawGal(sqft, 'single_poly') * 1.1),
      // Default assumption: double_poly covering (required by data/record-shape.md).
      point: pointEstimate(sqft, 'double_poly'),
      confidence: 'wide',
      method: 'From building size only. No site data yet.',
    };
  }

  function rankedFixes(usdWinter, covering) {
    if (typeof usdWinter !== 'number' || !Number.isFinite(usdWinter) || usdWinter < 0) {
      throw new TypeError(`usdWinter must be a non-negative number, got ${usdWinter}`);
    }
    const key = normalizeCovering(covering);
    return FIXES
      .filter((f) => !f.only || f.only === key)
      .map((f) => ({
        name: f.name,
        saves_usd: Math.round(usdWinter * f.fraction),
        // No vendor quote exists yet; cost and payback stay unknown.
        cost_usd: null,
        payback_years: null,
        method: `${f.fraction * 100}% of winter fuel cost, applied on its own (not combined with other fixes).`,
      }))
      .sort((a, b) => b.saves_usd - a.saves_usd);
  }

  return Object.freeze({
    BASE_GAL_PER_SQFT,
    U,
    PRICE_PER_GAL,
    pointEstimate,
    wideRange,
    rankedFixes,
  });
});
