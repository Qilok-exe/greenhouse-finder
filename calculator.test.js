// Run with: bun test calculator.test.js   (uses Bun's built-in test runner)
const { test, expect } = require('bun:test');
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
