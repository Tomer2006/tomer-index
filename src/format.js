// Formatters are built once: Intl.NumberFormat construction is far costlier than format().
// Every number uses en-US so separators match the toFixed decimals used elsewhere.
const INT_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatInt(n) {
  return INT_FORMAT.format(Math.round(n));
}

/** Decimal places needed to print every multiple of `step` exactly (2.5 -> 1, 0.25 -> 2). */
export function stepDecimals(step) {
  for (let digits = 0; digits < 6; digits++) {
    const scaled = step * 10 ** digits;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6 * Math.max(1, scaled))
      return digits;
  }
  return 6;
}

/** An axis tick printed with exactly the decimals its tick step needs. */
export function formatTick(value, step) {
  return value.toFixed(stepDecimals(step));
}
