import { formatInt, formatTick, stepDecimals } from "./format.js";
import { formatTomer, formatTomerAxis } from "./index-scale.js";
import { TOPIC_COLORS } from "./topic-colors.js";

/** Source-year keys that feed the Tomer index itself. */
export const TOMER_SOURCE_KEYS = ["leYear", "haleYear", "gniYear", "homicideYear", "freedomYear"];

const compactFormats = new Map();
/** en-US compact notation ("52.5K"); `digits` fraction digits at most. */
export function compactNumber(n, digits = 1) {
  if (!compactFormats.has(digits))
    compactFormats.set(
      digits,
      new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: digits,
      }),
    );
  return compactFormats.get(digits).format(n);
}

/**
 * Chart/table metric definitions shared by the entry and compare pages.
 * `axis(value, step)` prints a y tick with the precision its tick step needs;
 * `max` caps the axis for bounded scores (every metric is non-negative; the Tomer
 * index has none, since health and abundance keep rising past their goalposts).
 */
export const metricDefs = [
  {
    key: "customIndex",
    color: "#a78bfa",
    label: "Tomer index",
    axis: (v, step = 0.001) => formatTomerAxis(v, stepDecimals(step * 100)),
    value: (v) => formatTomer(v),
  },
  {
    key: "le",
    color: TOPIC_COLORS.health,
    sourceYearKey: "leYear",
    label: "Life expectancy",
    axis: (v, step = 1) => formatTick(v, step),
    value: (v) => `${v.toFixed(1)} years`,
  },
  {
    key: "hale",
    color: TOPIC_COLORS.health,
    sourceYearKey: "haleYear",
    label: "Healthy life expectancy (HALE)",
    axis: (v, step = 1) => formatTick(v, step),
    value: (v) => `${v.toFixed(1)} years`,
  },
  {
    key: "homicidesPer100k",
    color: TOPIC_COLORS.safety,
    sourceYearKey: "homicideYear",
    label: "Homicides per 100k",
    lowerIsBetter: true,
    axis: (v, step = 0.1) => formatTick(v, step),
    value: (v) => v.toFixed(2),
  },
  {
    key: "freedom",
    color: TOPIC_COLORS.freedom,
    sourceYearKey: "freedomYear",
    label: "Personal freedom (0–100)",
    max: 100,
    axis: (v, step = 1) => formatTick(v, step),
    value: (v) => v.toFixed(1),
  },
  {
    key: "gni",
    color: TOPIC_COLORS.abundance,
    sourceYearKey: "gniYear",
    label: "Income per person (PPP $)",
    axis: (v, step = 100) =>
      compactNumber(v, Math.min(3, stepDecimals(step / 1000))),
    value: (v) => formatInt(v),
  },
];

/** Source-year keys relevant to one metric (the index uses every listed input). */
export function metricSourceKeys(metric) {
  if (metric.key === "customIndex") return TOMER_SOURCE_KEYS;
  return metric.sourceYearKey ? [metric.sourceYearKey] : [];
}
