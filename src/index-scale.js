const DISPLAY_SCALE = 100;

export function formatTomer(v01) {
  if (typeof v01 !== "number" || !Number.isFinite(v01)) return "\u2014";
  return (v01 * DISPLAY_SCALE).toFixed(2);
}

export function formatTomerAxis(v01) {
  if (typeof v01 !== "number" || !Number.isFinite(v01)) return "\u2014";
  return (v01 * DISPLAY_SCALE).toFixed(1);
}
