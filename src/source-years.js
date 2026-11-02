/** Badge labels per source-year key (income switches to GDP or GNI/GDP by source). */
const METRIC_LABELS = {
  leYear: "Life exp.",
  haleYear: "HALE",
  gniYear: "GNI",
  homicideYear: "Homicides",
  freedomYear: "Freedom",
};

/** Nouns for the "Latest … data is from …" note on stale values. */
const DATA_NOUNS = {
  leYear: "life expectancy",
  haleYear: "HALE",
  gniYear: "income",
  homicideYear: "homicide",
  freedomYear: "freedom",
};

/** A source year at least this many years before the shown year is flagged as stale. */
export const STALE_YEARS = 5;

const GROUP_SOURCES =
  "Source years: mixed (population-weighted average of member countries).";

function incomeLabel(row) {
  if (row?.incomeSource === "GDP") return "GDP";
  return row?.incomeSource === "mixed" ? "GNI/GDP" : "GNI";
}

function yearPart(row, key) {
  const value = row?.[key];
  if (typeof value !== "number" && value !== "mixed") return null;
  const year = typeof value === "number" ? value : null;
  const estimated =
    (key === "haleYear" && Boolean(row?.haleEstimated)) ||
    (key === "gniYear" && Boolean(row?.incomeEstimated));
  const name = key === "gniYear" ? incomeLabel(row) : (METRIC_LABELS[key] ?? "Source");
  const label = !estimated
    ? name
    : year === null
      ? `${name} est.`
      : `${name} est. from`;
  return {
    key,
    label,
    value: String(value),
    year,
    estimated,
    gdp: key === "gniYear" && row?.incomeSource === "GDP",
  };
}

function partText(part) {
  return `${part.label} ${part.value}`;
}

/**
 * Source years that differ from the displayed year. A GDP income fallback is always
 * listed, because the value isn't the GNI the index normally uses.
 */
export function sourceYearParts(row, keys, displayYear) {
  return keys
    .map((key) => yearPart(row, key))
    .filter(
      (part) =>
        part &&
        (part.gdp ||
          typeof displayYear !== "number" ||
          part.year !== displayYear),
    );
}

export function sourceYearSummary(row, keys, displayYear) {
  return sourceYearParts(row, keys, displayYear).map(partText).join(", ");
}

function yearRange(years) {
  const low = Math.min(...years),
    high = Math.max(...years);
  return low === high ? String(low) : `${low}–${high}`;
}

function notes(row, parts, displayYear) {
  const out = [];
  const shownYear = typeof row?.year === "number" ? row.year : displayYear;
  const estimate = (key) =>
    parts.find((part) => part.key === key && part.estimated && part.year !== null);
  const target = typeof shownYear === "number" ? ` for ${shownYear}` : "";
  const hale = estimate("haleYear"),
    income = estimate("gniYear");
  if (hale) {
    const le = typeof row?.leYear === "number" ? ` (${row.leYear})` : "";
    out.push(
      `HALE${target} estimated from WHO's ${hale.year} value, adjusted by life expectancy${le}.`,
    );
  }
  if (income)
    out.push(
      `Income${target} estimated from ${income.year} GNI, adjusted by the change in GDP per person since then.`,
    );
  if (parts.some((part) => part.gdp))
    out.push("Income uses GDP per person because GNI isn't published.");
  for (const part of parts) {
    const age = shownYear - part.year;
    if (part.year !== null && age >= STALE_YEARS)
      out.push(
        `Latest ${DATA_NOUNS[part.key] ?? "source"} data is from ${part.year} (${age} years earlier).`,
      );
  }
  return out;
}

/**
 * Everything a source-year badge shows, or null when there is nothing to flag.
 * Full badges (entry, compare, map) list each input whose year differs from the
 * displayed one: `Life exp. 2024, HALE est. from 2021, GNI est. from 2024`. Compact
 * badges (leaderboard cells and cards) always show a year, a `2021–2024` range for multi-input
 * columns, or `mixed` for groups, keeping their qualifiers: `est. 2021` for
 * estimated HALE or income, `GDP 2005` for plain GDP, and `*` on a range when any
 * input is estimated or GDP. `current` marks a plain year equal to the displayed
 * one (muted styling); `stale` marks inputs STALE_YEARS or more years old.
 * `description` is the full text for tooltips and screen readers.
 */
export function sourceBadge(row, keys, displayYear, { compact = false } = {}) {
  const parts = keys.map((key) => yearPart(row, key)).filter(Boolean);
  const shown = compact ? parts : sourceYearParts(row, keys, displayYear);
  if (!shown.length && !row?.derivedKind) return null;
  const mixed = !parts.length || parts.some((part) => part.year === null);
  const qualified = parts.some((part) => part.estimated || part.gdp);
  const years = parts.map((part) => part.year).filter(Number.isFinite);
  let text;
  if (!compact)
    text = shown.every((part) => part.year === null)
      ? "mixed"
      : shown.map(partText).join(", ");
  else if (mixed) text = "mixed";
  else if (parts.length > 1) text = `${yearRange(years)}${qualified ? "*" : ""}`;
  else
    text = `${parts[0].estimated ? "est. " : parts[0].gdp ? "GDP " : ""}${years[0]}`;
  const stale =
    typeof displayYear === "number" &&
    shown.some(
      (part) =>
        part.year !== null &&
        (row?.year ?? displayYear) - part.year >= STALE_YEARS,
    );
  const description = mixed
    ? GROUP_SOURCES
    : [
        `Source ${parts.length === 1 ? "year" : "years"}: ${parts.map(partText).join(", ")}.`,
        ...notes(row, parts, displayYear),
      ].join(" ");
  return {
    text,
    description,
    current:
      compact &&
      !mixed &&
      !qualified &&
      new Set(years).size === 1 &&
      years[0] === displayYear,
    stale,
  };
}
