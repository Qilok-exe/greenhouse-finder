// Run with: bun test calculator.test.js   (uses Bun's built-in test runner)
const { test, expect, describe } = require('bun:test');
const C = require('./calculator.js');

test('"double_poly (assumed)" gives the same point estimate as "double_poly"', () => {
  expect(C.pointEstimate(3000, 'double_poly (assumed)')).toEqual(
    C.pointEstimate(3000, 'double_poly')
  );
});

test('covering is trimmed and lowercased before lookup', () => {
  expect(C.pointEstimate(3000, '  Single_Poly (Assumed) ')).toEqual(
    C.pointEstimate(3000, 'single_poly')
  );
});

test('rankedFixes normalises covering too (second poly layer kept for single_poly)', () => {
  expect(C.rankedFixes(6000, 'single_poly (assumed)')).toEqual(
    C.rankedFixes(6000, 'single_poly')
  );
});

test('wideRange includes point = pointEstimate for double_poly', () => {
  const r = C.wideRange(3000);
  expect(r.point).toEqual(C.pointEstimate(3000, 'double_poly'));
  expect(r.low.usd).toBeLessThan(r.point.usd);
  expect(r.point.usd).toBeLessThan(r.high.usd);
});

test('genuinely unknown coverings still throw', () => {
  expect(() => C.pointEstimate(3000, 'triple_glass')).toThrow(/unknown covering/);
  expect(() => C.pointEstimate(3000, '(assumed)')).toThrow(/unknown covering/);
  expect(() => C.pointEstimate(3000, 'double_poly (estimated)')).toThrow(/unknown covering/);
  expect(() => C.rankedFixes(6000, null)).toThrow(/unknown covering/);
});

describe('calibrate', () => {
  const house = { sqft: 3000, covering: 'double_poly (assumed)' };
  const predicted = C.pointEstimate(house.sqft, house.covering).gal;

  test('burning exactly the predicted gallons gives factor 1.00', () => {
    const c = C.calibrate(house, predicted);
    expect(c.factor).toBe(1);
    expect(c.method).toContain('1.00x');
  });

  test('burning double the predicted gallons gives factor 2.00', () => {
    const c = C.calibrate(house, predicted * 2);
    expect(c.factor).toBe(2);
    expect(c.method).toContain('2.00x');
  });

  test('point, low and high come from actual gallons at PRICE_PER_GAL, ±10%', () => {
    const c = C.calibrate(house, 2000);
    expect(c.point.gal).toBe(2000);
    expect(c.point.usd).toBe(Math.round(2000 * C.PRICE_PER_GAL));
    expect(c.low).toEqual({ gal: 1800, usd: Math.round(1800 * C.PRICE_PER_GAL) });
    expect(c.high).toEqual({ gal: 2200, usd: Math.round(2200 * C.PRICE_PER_GAL) });
    expect(c.confidence).toBe('narrowed');
    expect(c.method).toBe(
      'Calibrated to 2000 gallons actually burned. This house runs 1.34x our size-only model.'
    );
  });

  test('has the same estimate keys as wideRange (plus factor)', () => {
    const w = C.wideRange(house.sqft);
    const c = C.calibrate(house, 2000);
    for (const k of Object.keys(w)) expect(c).toHaveProperty(k);
    for (const k of ['low', 'high', 'point']) {
      expect(Object.keys(c[k]).sort()).toEqual(Object.keys(w[k]).sort());
    }
  });

  test('rejects bad input', () => {
    expect(() => C.calibrate(house, -1)).toThrow();
    expect(() => C.calibrate(house, NaN)).toThrow();
    expect(() => C.calibrate({ sqft: 0, covering: 'double_poly' }, 100)).toThrow(RangeError);
    expect(() => C.calibrate({ sqft: 3000, covering: 'triple_glass' }, 100)).toThrow(/unknown covering/);
  });
});
