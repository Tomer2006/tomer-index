import { escapeHtml } from "./format.js";

const METRIC_LABELS = {
  leYear: "Life exp.",
  haleYear: "HALE",
  gniYear: "GNI",
  homicideYear: "Homicides",
};

function sourceYearPart(row, key, displayYear) {
  const value = row?.[key];
  if (typeof value === "number") {
    if (typeof displayYear === "number" && value === displayYear) return null;
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
  const keyList = Array.isArray(keys) ? keys : [keys];
  const parts = sourceYearParts(row, keyList, displayYear);
  if (!parts.length) return "";
  const summary = parts.map((part) => `${part.label} ${part.value}`).join(", ");
  const tip = escapeHtml(`Source ${parts.length === 1 ? "year" : "years"}: ${summary}`);
  return ` <span class="source-year-badge" tabindex="0" data-tip="${tip}" aria-label="${tip}">${escapeHtml(
    summary
  )}</span>`;
}
