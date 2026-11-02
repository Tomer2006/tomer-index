const DISPLAY_SCALE = 100;

export function formatTomer(v01) {
  if (typeof v01 !== "number" || !Number.isFinite(v01)) return "—";
  return (v01 * DISPLAY_SCALE).toFixed(2);
}

/** Axis label; `digits` lets a chart match the precision of its tick step. */
export function formatTomerAxis(v01, digits = 1) {
  if (typeof v01 !== "number" || !Number.isFinite(v01)) return "—";
  return (v01 * DISPLAY_SCALE).toFixed(digits);
}
