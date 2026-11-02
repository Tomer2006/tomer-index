import { YEAR_MAX, YEAR_MIN } from "./site-years.js";
import {
  DEFAULT_WEIGHT_POINTS,
  WEIGHT_KEYS,
  normalizedWeightPoints,
  weightedIndexFromPillars,
} from "./index-weights.js";
import { formatTomer } from "./index-scale.js";
import { SAFETY_SOURCE_KEYS, TOMER_SOURCE_KEYS } from "./metric-defs.js";
import { geographicRegionForRow } from "./regions.js";

/** Comma-separated query values, trimmed and de-duplicated. */
export function readList(params, key) {
  return [
    ...new Set(
      (params.get(key) ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}
export function readIso(params, key = "iso") {
  return (params.get(key) ?? "").trim().toUpperCase();
}
/** Compare picks keep duplicates so the page can warn about them. */
export function readPicks(params) {
  return (params.get("picks") ?? "")
    .split(",")
    .map((iso) => iso.trim().toUpperCase())
    .filter(Boolean);
}
export const QUALITY_FILTERS = ["all", "complete", "incomplete"];
export function readQuality(params) {
  const value = params.get("quality");
  return QUALITY_FILTERS.includes(value) ? value : "all";
}
export function entryHref(iso) {
  return `/entry/${encodeURIComponent(iso)}`;
}
export function readYear(params) {
  return Math.max(
    YEAR_MIN,
    Math.min(YEAR_MAX, parseInt(params.get("year"), 10) || YEAR_MAX),
  );
}
export function readWeights(params) {
  return Object.fromEntries(
    Object.entries(DEFAULT_WEIGHT_POINTS).map(([key, fallback]) => {
      const raw = params.get(`w_${key}`)?.trim();
      // An empty value (w_health=) is a missing value, not zero.
      const value = raw ? Number(raw) : fallback;
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
const DEFAULT_SHARES = normalizedWeightPoints(DEFAULT_WEIGHT_POINTS);
/**
 * True when the effective (rescaled) weights differ from the published index, so
 * proportional points (80/60/40/20) and the all-zero fallback are not "custom".
 */
export function isCustomWeights(weights) {
  const shares = normalizedWeightPoints(weights);
  return WEIGHT_KEYS.some(
    (key) => Math.abs(shares[key] - DEFAULT_SHARES[key]) > 1e-9,
  );
}
function withMetadata(row, point) {
  // Copy metadata only, so missing historical inputs never inherit latest observations.
  // A group's member count is per year (the point's `n`), not the latest one.
  const { iso, name, derivedKind, memberCount, region, incomeLevel } = row;
  return {
    iso,
    name,
    derivedKind,
    region,
    incomeLevel,
    ...point,
    memberCount: point.n ?? memberCount,
  };
}
export function rowsForYear(countries, series, year) {
  if (year === YEAR_MAX) return countries;
  return countries.flatMap((row) => {
    const point = series?.[row.iso]?.points?.find(
      (point) => point.year === year,
    );
    return point ? [withMetadata(row, point)] : [];
  });
}
/** Same rows as rowsForYear, from a one-year snapshot ({ [iso]: point }). */
export function rowsForSnapshot(countries, snapshot, year) {
  if (year === YEAR_MAX) return countries;
  return countries.flatMap((row) => {
    const point = snapshot?.[row.iso];
    return point ? [withMetadata(row, point)] : [];
  });
}
export const TYPE_FILTERS = [
  { id: "country", name: "Country" },
  { id: "region", name: "Region" },
  { id: "income", name: "Income group" },
  { id: "derived", name: "World & lending groups" },
];
export function rowType(row) {
  if (!row.derivedKind) return "country";
  if (["region", "adminregion"].includes(row.derivedKind)) return "region";
  return row.derivedKind === "incomeLevel" ? "income" : "derived";
}
export function rowTypeName(row) {
  return TYPE_FILTERS.find((type) => type.id === rowType(row))?.name;
}
/** Reader-facing names for aggregate kinds (raw derivedKind values are internal). */
export const KIND_LABELS = {
  region: "World Bank region",
  adminregion: "World Bank region",
  incomeLevel: "Income group",
  lendingType: "World Bank lending group",
  world: "World",
};
export function kindLabel(row) {
  return row.derivedKind ? (KIND_LABELS[row.derivedKind] ?? "Group") : "Country";
}
/** Income chips keep their countries plus the matching income-group row, as region chips do. */
export function matchesIncome(row, selectedIds) {
  if (!selectedIds.length) return true;
  return selectedIds.includes(
    row.derivedKind === "incomeLevel" ? row.iso : row.incomeLevel?.id,
  );
}
/** One search haystack for every page that filters rows by free text. */
export function matchesSearch(row, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    row.name,
    row.iso,
    row.region?.name,
    geographicRegionForRow(row)?.name,
    row.incomeLevel?.name,
    row.derivedKind && kindLabel(row),
    rowTypeName(row),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}
const number = (v) => (Number.isFinite(v) ? v.toFixed(1) : "—");
// One shared formatter: constructing Intl formatters per cell is slow.
const wholeNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
// Ordered by pillar weight (health, safety, freedom, abundance) after the index itself.
export const columns = [
  {
    key: "tomer",
    label: "Tomer index",
    long: "Tomer index (100 = every goalpost met)",
    sources: TOMER_SOURCE_KEYS,
    value: weightedIndexFromPillars,
    format: formatTomer,
  },
  {
    key: "le",
    label: "Life exp.",
    long: "Life expectancy (years)",
    sources: ["leYear"],
    value: (r) => r.le,
    format: number,
  },
  {
    key: "hale",
    label: "HALE",
    long: "Healthy life expectancy, HALE (years)",
    sources: ["haleYear"],
    value: (r) => r.hale,
    format: number,
  },
  {
    key: "health",
    label: "Health score",
    long: "Health pillar score (100 = life expectancy and HALE of 85)",
    sources: ["leYear", "haleYear"],
    value: (r) => r.healthIndex,
    format: formatTomer,
  },
  {
    key: "deaths",
    label: "Violent & road deaths per 100k",
    long: "Deaths from homicide, war and road crashes per 100,000 people",
    sources: SAFETY_SOURCE_KEYS,
    value: (r) => r.safetyDeathsPer100k,
    format: number,
    lower: true,
  },
  {
    key: "freedom",
    label: "Freedom",
    long: "Personal freedom score (0–100)",
    sources: ["freedomYear"],
    value: (r) => r.freedom,
    format: number,
  },
  {
    key: "gni",
    label: "Income per person",
    long: "Income per person (PPP $, constant 2021 prices)",
    sources: ["gniYear"],
    value: (r) => r.gni,
    format: (v) =>
      Number.isFinite(v) ? wholeNumber.format(Math.round(v)) : "—",
  },
];
export function columnFor(key) {
  return columns.find((col) => col.key === key) ?? columns[0];
}
export const SORT_KEYS = ["name", ...columns.map((col) => col.key)];
export function readSort(params) {
  const value = params.get("sort");
  return SORT_KEYS.includes(value) ? value : "tomer";
}
export function sortedRows(
  rows,
  key = "tomer",
  bestFirst = true,
  weights = DEFAULT_WEIGHT_POINTS,
) {
  return [...rows].sort((a, b) => {
    if (key === "name")
      return a.name.localeCompare(b.name) * (bestFirst ? 1 : -1);
    const column = columnFor(key);
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
/**
 * Rank numbers for already-sorted rows. Only countries are ranked (aggregates stay
 * unranked), and rows missing the sort value get no rank. Equal values share a rank
 * (1, 2, 2, 4), so the order within a tie never shows out-of-order ranks.
 */
export function countryRanks(
  sorted,
  key = "tomer",
  weights = DEFAULT_WEIGHT_POINTS,
) {
  const column = key === "name" ? null : columnFor(key);
  const ranks = new Map();
  let previous, rank;
  for (const row of sorted) {
    if (row.derivedKind) continue;
    const value = column ? column.value(row, weights) : row.name;
    if (column && !Number.isFinite(value)) continue;
    if (!ranks.size || value !== previous) rank = ranks.size + 1;
    ranks.set(row.iso, rank);
    previous = value;
  }
  return ranks;
}
/** Tomer-index ranks among all countries, plus how many countries were ranked. */
export function tomerRanks(rows, weights = DEFAULT_WEIGHT_POINTS) {
  const ranks = countryRanks(
    sortedRows(rows, "tomer", true, weights),
    "tomer",
    weights,
  );
  return { ranks, total: ranks.size };
}
