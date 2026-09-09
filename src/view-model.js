import { YEAR_MAX, YEAR_MIN } from "./site-years.js";
import {
  DEFAULT_WEIGHT_POINTS,
  weightedIndexFromPillars,
} from "./index-weights.js";
import { formatTomer } from "./index-scale.js";
import { TOMER_SOURCE_KEYS } from "./metric-defs.js";

export function readYear(params) {
  return Math.max(
    YEAR_MIN,
    Math.min(YEAR_MAX, parseInt(params.get("year"), 10) || YEAR_MAX),
  );
}
export function readWeights(params) {
  return Object.fromEntries(
    Object.entries(DEFAULT_WEIGHT_POINTS).map(([key, fallback]) => {
      const raw = params.get(`w_${key}`);
      const value = raw === null ? fallback : Number(raw);
      return [
        key,
        Number.isFinite(value) && value >= 0 && value <= 100 ? value : fallback,
      ];
    }),
  );
}
export function weightQuery(weights) {
  return Object.fromEntries(
    Object.entries(weights).map(([key, value]) => [
      `w_${key}`,
      value === DEFAULT_WEIGHT_POINTS[key] ? null : value,
    ]),
  );
}
export function rowsForYear(countries, series, year) {
  if (year === YEAR_MAX) return countries;
  return countries.flatMap((row) => {
    const point = series?.[row.iso]?.points?.find(
      (point) => point.year === year,
    );
    if (!point) return [];
    // Copy metadata only, so missing historical inputs never inherit latest observations.
    const { iso, name, derivedKind, memberCount, region, incomeLevel } = row;
    return [
      { iso, name, derivedKind, memberCount, region, incomeLevel, ...point },
    ];
  });
}
export const TYPE_FILTERS = [
  { id: "country", name: "Country" },
  { id: "region", name: "Region" },
  { id: "income", name: "Income group" },
  { id: "derived", name: "Derived group" },
];
export function rowType(row) {
  if (!row.derivedKind) return "country";
  if (["region", "adminregion"].includes(row.derivedKind)) return "region";
  return row.derivedKind === "incomeLevel" ? "income" : "derived";
}
const number = (v) => (Number.isFinite(v) ? v.toFixed(1) : "—");
export const columns = [
  {
    key: "le",
    label: "Life exp.",
    sources: ["leYear"],
    value: (r) => r.le,
    format: number,
  },
  {
    key: "hale",
    label: "HALE",
    sources: ["haleYear"],
    value: (r) => r.hale,
    format: number,
  },
  {
    key: "health",
    label: "Health",
    sources: ["leYear", "haleYear"],
    value: (r) => r.healthIndex,
    format: formatTomer,
  },
  {
    key: "gni",
    label: "Abundance (income pc)",
    sources: ["gniYear"],
    value: (r) => r.gni,
    format: (v) =>
      Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : "—",
  },
  {
    key: "homicides",
    label: "Homicides /100k",
    sources: ["homicideYear"],
    value: (r) => r.homicidesPer100k,
    format: number,
    lower: true,
  },
  {
    key: "freedom",
    label: "Freedom",
    sources: ["freedomYear"],
    value: (r) => r.freedom,
    format: number,
  },
  {
    key: "tomer",
    label: "Tomer index",
    sources: TOMER_SOURCE_KEYS,
    value: weightedIndexFromPillars,
    format: formatTomer,
  },
];
export function sortedRows(
  rows,
  key = "tomer",
  bestFirst = true,
  weights = DEFAULT_WEIGHT_POINTS,
) {
  return [...rows].sort((a, b) => {
    if (key === "name")
      return a.name.localeCompare(b.name) * (bestFirst ? 1 : -1);
    const column = columns.find((col) => col.key === key) ?? columns.at(-1);
    const av = column.value(a, weights),
      bv = column.value(b, weights);
    if (!Number.isFinite(av))
      return Number.isFinite(bv) ? 1 : a.name.localeCompare(b.name);
    if (!Number.isFinite(bv)) return -1;
    return (
      (av - bv) * (column.lower ? 1 : -1) * (bestFirst ? 1 : -1) ||
      a.name.localeCompare(b.name)
    );
  });
}
