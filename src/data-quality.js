import { YEAR_MAX, YEAR_MIN } from "./site-years.js";
import { columnFor } from "./view-model.js";

/** Index inputs in leaderboard column order, named with the column labels. */
const REQUIRED_INDEX_METRICS = [
  ["le", "le"],
  ["hale", "hale"],
  ["homicidesPer100k", "homicides"],
  ["freedom", "freedom"],
  ["gni", "gni"],
].map(([field, column]) => [field, columnFor(column).label]);

export const HISTORY_GAPS_LABEL = "History gaps";

// Labels written by older builds of leaderboard.json's qualityByIso.
const LEGACY_LABELS = {
  "Life exp.": columnFor("le").label,
  HALE: columnFor("hale").label,
  "Abundance (income pc, PPP)": columnFor("gni").label,
  "Homicides /100k": columnFor("homicides").label,
  "Personal freedom": columnFor("freedom").label,
};
const LEGACY_DESCRIPTION =
  /^(.+) missing for (\d+) yearly points? out of (\d+) points?\.$/;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function formatList(items) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** [2000, 2001, 2002, 2005] -> "2000–2002, 2005" */
function yearRanges(years) {
  const ranges = [];
  for (const year of [...years].sort((a, b) => a - b)) {
    const last = ranges.at(-1);
    if (last && year === last[1] + 1) last[1] = year;
    else ranges.push([year, year]);
  }
  return ranges
    .map(([from, to]) => (from === to ? String(from) : `${from}–${to}`))
    .join(", ");
}

function describeGaps(details) {
  return `Some years between ${YEAR_MIN} and ${YEAR_MAX} are missing at least one index input${details ? ` (${details})` : ""}.`;
}

function missingLabelsForPoint(point) {
  const missing = REQUIRED_INDEX_METRICS.filter(
    ([key]) => !isFiniteNumber(point?.[key]),
  ).map(([, label]) => label);

  if (!missing.length && !isFiniteNumber(point?.customIndex)) {
    missing.push("Tomer index");
  }

  return missing;
}

export function dataQualityForSeries(series) {
  const points = Array.isArray(series?.points) ? series.points : [];
  if (!points.length) return null;

  const missingYears = new Map();
  let badPoints = 0;

  for (const point of points) {
    const missing = missingLabelsForPoint(point);
    if (!missing.length) continue;
    badPoints += 1;
    for (const label of missing) {
      if (!missingYears.has(label)) missingYears.set(label, []);
      missingYears.get(label).push(point.year);
    }
  }

  if (!badPoints) return null;

  const order = [...REQUIRED_INDEX_METRICS.map(([, label]) => label), "Tomer index"];
  const details = order
    .filter((label) => missingYears.has(label))
    .map((label) => `${label}: ${yearRanges(missingYears.get(label))}`)
    .join("; ");

  return {
    label: HISTORY_GAPS_LABEL,
    description: describeGaps(details),
    badPoints,
    totalPoints: points.length,
  };
}

// Older committed data has the previous label and wording; reword each note once.
const normalized = new WeakMap();
function normalizeQuality(quality) {
  if (quality.label === HISTORY_GAPS_LABEL) return quality;
  if (!normalized.has(quality)) {
    const match = LEGACY_DESCRIPTION.exec(quality.description ?? "");
    const labels = match
      ? match[1]
          .split(/, and |, | and /)
          .map((label) => LEGACY_LABELS[label] ?? label)
      : [];
    normalized.set(quality, {
      ...quality,
      label: HISTORY_GAPS_LABEL,
      description: describeGaps(
        match
          ? `${formatList(labels)} missing in ${match[2]} of ${match[3]} years`
          : "",
      ),
    });
  }
  return normalized.get(quality);
}

/**
 * The "History gaps" note for a row. leaderboard.json's qualityByIso covers every
 * flagged row, so callers pass null for `entrySeries`; the series is only read when
 * no qualityByIso is given.
 */
export function dataQualityForRow(row, entrySeries, qualityByIso = null) {
  if (!row?.iso) return null;
  if (qualityByIso) {
    const quality = qualityByIso[row.iso];
    return quality ? normalizeQuality(quality) : null;
  }
  return dataQualityForSeries(entrySeries?.[row.iso]);
}
