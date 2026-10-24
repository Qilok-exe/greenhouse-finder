/*
 * agents/format.js
 *
 * The single number formatter shared by fill, renderFixesTable and
 * checkNumbers, plus the number-token regex used by checkNumbers.
 *
 * UMD: works as a Node CommonJS module and as a classic browser script
 * (sets the global `AgentFormat`). No ES modules, because
 * <script type="module"> fails under file://.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.AgentFormat = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /*
   * Number token: optional currency symbol, digits with optional comma
   * grouping (a token never ends in a comma), optional decimal part,
   * optional percent sign. No word boundary, so digits next to letters match.
   *
   * The regex has the g flag and therefore a mutable lastIndex. Use it with
   * String.prototype.match / matchAll / replace, or reset lastIndex before
   * calling exec in a loop.
   */
  var NUMBER_RE = /[$€£]?\d(?:[\d,]*\d)?(?:\.\d+)?%?/g;

  // Turn String(x) for a non-negative finite x into plain digits,
  // expanding exponent notation (for example "1e-7", "1.5e+21").
  function plainDigits(x) {
    var s = String(x);
    var ePos = s.indexOf("e");
    if (ePos === -1) return s;

    var mantissa = s.slice(0, ePos);
    var exp = Number(s.slice(ePos + 1));
    var dot = mantissa.indexOf(".");
    var intPart = dot === -1 ? mantissa : mantissa.slice(0, dot);
    var fracPart = dot === -1 ? "" : mantissa.slice(dot + 1);
    var digits = intPart + fracPart;
    var pointPos = intPart.length + exp;

    var out;
    if (pointPos <= 0) {
      out = "0." + "0".repeat(-pointPos) + digits;
    } else if (pointPos >= digits.length) {
      out = digits + "0".repeat(pointPos - digits.length);
    } else {
      out = digits.slice(0, pointPos) + "." + digits.slice(pointPos);
    }
    // Normalise leading zeros in the integer part ("00.5" cannot occur from
    // String(), but keep the output canonical anyway).
    return out.replace(/^0+(?=\d)/, "");
  }

  /*
   * formatNumber(n): shortest round-trip decimal of |n| with exponents
   * expanded, integer part grouped with commas every three digits (en-US),
   * fraction digits kept as they are, "-" prefixed for negatives.
   * No rounding, no currency symbol, no unit, no padding.
   * Throws on a non-finite number (or a non-number).
   *
   *   2906 -> "2,906"   3.5 -> "3.5"   -72.532322 -> "-72.532322"
   *   40000 -> "40,000" -0 -> "0"     1e-7 -> "0.0000001"
   */
  function formatNumber(n) {
    if (typeof n !== "number" || !Number.isFinite(n)) {
      throw new Error("formatNumber: expected a finite number, got " + String(n));
    }
    var negative = n < 0; // false for -0, so -0 formats as "0"
    var plain = plainDigits(Math.abs(n));
    var dot = plain.indexOf(".");
    var intPart = dot === -1 ? plain : plain.slice(0, dot);
    var fracPart = dot === -1 ? "" : plain.slice(dot);
    var grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (negative ? "-" : "") + grouped + fracPart;
  }

  return {
    formatNumber: formatNumber,
    NUMBER_RE: NUMBER_RE
  };
});
