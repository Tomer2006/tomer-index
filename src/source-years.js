import { escapeHtml } from "./format.js";

const METRIC_LABELS = {
  leYear: "Life exp.",
  haleYear: "HALE",
  gniYear: "GNI",
  homicideYear: "Homicides",
};

function sourceYearPart(row, key, displayYear) {
  const value = row?.[key];
  if (typeof value === "number" && value < displayYear) {
    return { label: METRIC_LABELS[key] ?? "Source", value: String(value) };
  }
  if (value === "mixed") {
    return { label: METRIC_LABELS[key] ?? "Source", value: "mixed" };
  }
  return null;
}

export function sourceYearParts(row, keys, displayYear) {
  return keys
    .map((key) => sourceYearPart(row, key, displayYear))
    .filter(Boolean);
}

export function sourceYearSummary(row, keys, displayYear) {
  const parts = sourceYearParts(row, keys, displayYear);
  if (!parts.length) return "";
  return parts.map((part) => `${part.label} ${part.value}`).join(", ");
}

export function sourceYearBadgeHtml(row, keys, displayYear) {
  const summary = sourceYearSummary(row, Array.isArray(keys) ? keys : [keys], displayYear);
  if (!summary) return "";
  const title = escapeHtml(`Older or mixed source year: ${summary}`);
  return ` <span class="source-year-badge" title="${title}" aria-label="${title}">${escapeHtml(
    summary
  )}</span>`;
}

export function staleMetricClass(row, keys, displayYear) {
  return sourceYearSummary(row, Array.isArray(keys) ? keys : [keys], displayYear)
    ? " has-source-note"
    : "";
}
