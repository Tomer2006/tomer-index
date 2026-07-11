import { formatInt } from "./format.js";
import { formatTomer, formatTomerAxis } from "./index-scale.js";

/** Source-year keys that feed the Tomer index itself. */
export const TOMER_SOURCE_KEYS = ["leYear", "haleYear", "gniYear", "homicideYear", "freedomYear"];

export function compactNumber(n) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

export function metricValue(row, key) {
  const v = row?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : NaN;
}

/** Chart/table metric definitions shared by the entry and compare pages. */
export const metricDefs = [
  {
    key: "customIndex",
    label: "Tomer index",
    axis: (v) => formatTomerAxis(v),
    value: (v) => formatTomer(v),
  },
  {
    key: "le",
    sourceYearKey: "leYear",
    label: "Life expectancy",
    axis: (v) => v.toFixed(0),
    value: (v) => `${v.toFixed(1)} years`,
  },
  {
    key: "hale",
    sourceYearKey: "haleYear",
    label: "HALE",
    axis: (v) => v.toFixed(0),
    value: (v) => `${v.toFixed(1)} years`,
  },
  {
    key: "gni",
    sourceYearKey: "gniYear",
    label: "Abundance (income pc, PPP)",
    axis: (v) => compactNumber(v),
    value: (v) => formatInt(v),
  },
  {
    key: "homicidesPer100k",
    sourceYearKey: "homicideYear",
    label: "Homicides /100k",
    axis: (v) => v.toFixed(1),
    value: (v) => v.toFixed(2),
  },
  {
    key: "freedom",
    sourceYearKey: "freedomYear",
    label: "Personal freedom (0–100)",
    axis: (v) => v.toFixed(0),
    value: (v) => v.toFixed(1),
  },
];

/** Source-year keys relevant to one metric (the index uses every listed input). */
export function metricSourceKeys(metric) {
  if (metric.key === "customIndex") return TOMER_SOURCE_KEYS;
  return metric.sourceYearKey ? [metric.sourceYearKey] : [];
}
