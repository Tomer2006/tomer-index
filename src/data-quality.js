import { escapeHtml } from "./format.js";

const REQUIRED_INDEX_METRICS = [
  ["le", "Life exp."],
  ["hale", "HALE"],
  ["gni", "GNI pc (PPP)"],
  ["homicidesPer100k", "Homicides /100k"],
];

const BAD_DATA_LABEL = "Incomplete data";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function formatList(items) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function missingLabelsForPoint(point) {
  const missing = REQUIRED_INDEX_METRICS
    .filter(([key]) => !isFiniteNumber(point?.[key]))
    .map(([, label]) => label);

  if (!missing.length && !isFiniteNumber(point?.customIndex)) {
    missing.push("Tomer index");
  }

  return missing;
}

export function dataQualityForSeries(series) {
  const points = Array.isArray(series?.points) ? series.points : [];
  if (!points.length) return null;

  const missingLabels = new Set();
  let badPoints = 0;

  for (const point of points) {
    const missing = missingLabelsForPoint(point);
    if (!missing.length) continue;
    badPoints += 1;
    missing.forEach((label) => missingLabels.add(label));
  }

  if (!badPoints) return null;

  const metricText = formatList([...missingLabels]);
  const pointText = badPoints === 1 ? "1 yearly point" : `${badPoints} yearly points`;
  const totalText = points.length === 1 ? "1 point" : `${points.length} points`;

  return {
    label: BAD_DATA_LABEL,
    description: `${metricText} missing for ${pointText} out of ${totalText}.`,
    badPoints,
    totalPoints: points.length,
  };
}

export function dataQualityForRow(row, entrySeries, qualityByIso = null) {
  if (!row?.iso) return null;
  if (qualityByIso?.[row.iso]) return qualityByIso[row.iso];
  return dataQualityForSeries(entrySeries?.[row.iso]);
}

export function dataQualityBadgeHtml(quality) {
  if (!quality) return "";
  const description = escapeHtml(quality.description);
  return ` <span class="data-quality-badge" tabindex="0" data-tip="${description}" aria-label="${description}">${escapeHtml(
    quality.label
  )}</span>`;
}
