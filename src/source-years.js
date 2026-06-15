import { escapeHtml } from "./format.js";

const METRIC_LABELS = {
  leYear: "Life exp.",
  haleYear: "HALE",
  gniYear: "GNI",
  homicideYear: "Homicides",
};

function yearPart(row, key) {
  const value = row?.[key];
  const incomeLabel =
    row?.incomeSource === "GDP"
      ? "GDP"
      : row?.incomeSource === "mixed"
        ? "GNI/GDP"
        : "GNI";
  const metricLabel =
    key === "gniYear"
      ? incomeLabel
      : key === "haleYear" && row?.haleEstimated
        ? "HALE est."
        : METRIC_LABELS[key] ?? "Source";
  if (typeof value === "number") {
    return { label: metricLabel, value: String(value), year: value };
  }
  if (value === "mixed") {
    return {
      label: metricLabel,
      value: "mixed",
      year: null,
    };
  }
  return null;
}

function sourceYearPart(row, key, displayYear) {
  const part = yearPart(row, key);
  if (!part) return null;
  const isGdpFallback = key === "gniYear" && row?.incomeSource === "GDP";
  if (!isGdpFallback && typeof displayYear === "number" && part.year === displayYear) return null;
  return part;
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

function badgeHtml(text, tip, extraClass = "") {
  const safeTip = escapeHtml(tip);
  return ` <span class="source-year-badge${extraClass}" tabindex="0" data-tip="${safeTip}" aria-label="${safeTip}">${escapeHtml(
    text
  )}</span>`;
}

function partsTip(parts) {
  const summary = parts.map((part) => `${part.label} ${part.value}`).join(", ");
  return `Source ${parts.length === 1 ? "year" : "years"}: ${summary}`;
}

export function sourceYearBadgeHtml(row, keys, displayYear) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  const parts = sourceYearParts(row, keyList, displayYear);
  if (!parts.length) return "";
  return badgeHtml(parts.map((part) => `${part.label} ${part.value}`).join(", "), partsTip(parts));
}

/**
 * Always-visible variant for the leaderboard: every data point gets its source
 * year, not just the ones that differ from the displayed year. The badge text
 * is compact — a single year, a `2021–2023` range for multi-metric cells, or
 * `mixed` for aggregate rows — with the per-metric breakdown in the tooltip.
 * Years matching the displayed year get `is-current` (muted styling) so
 * carried-forward values keep their visual emphasis.
 */
export function sourceYearCellHtml(row, keys, displayYear) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  const parts = keyList.map((key) => yearPart(row, key)).filter(Boolean);
  if (!parts.length) {
    // Derived-group history points don't store per-metric source years; they
    // are population-weighted mixes of member-country observations.
    if (row?.derivedKind) {
      return badgeHtml("mixed", "Source years: mixed (population-weighted aggregate of member countries)");
    }
    return "";
  }
  const years = [...new Set(parts.map((part) => part.year).filter((y) => typeof y === "number"))];
  const hasMixed = parts.some((part) => part.year === null);
  let text;
  if (hasMixed) text = "mixed";
  else if (years.length === 1) text = String(years[0]);
  else text = `${Math.min(...years)}–${Math.max(...years)}`;
  const isCurrent = !hasMixed && years.length === 1 && years[0] === displayYear;
  return badgeHtml(text, partsTip(parts), isCurrent ? " is-current" : "");
}
