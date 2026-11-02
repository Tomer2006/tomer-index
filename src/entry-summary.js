// Pure helpers shared by the server entry pages (metadata, prerendered summary)
// and the client <Entry> component, so both describe a row the same way.
import { dataQualityForRow } from "./data-quality.js";
import { YEAR_MAX, YEAR_MIN } from "./site-years.js";
import { columnFor, kindLabel, tomerRanks } from "./view-model.js";

const tomerColumn = columnFor("tomer");

export function ordinal(n) {
  const suffix = { one: "st", two: "nd", few: "rd" }[
    new Intl.PluralRules("en-US", { type: "ordinal" }).select(n)
  ];
  return `${n}${suffix ?? "th"}`;
}

/** Row, Tomer-index rank among countries and data-quality note, or null for an unknown id. */
export function entrySummary(leaderboard, iso) {
  const countries = leaderboard?.countries ?? [];
  const row = countries.find((item) => item.iso === iso);
  if (!row) return null;
  const { ranks, total } = tomerRanks(countries);
  return {
    row,
    rank: ranks.get(iso) ?? null,
    total,
    quality: dataQualityForRow(row, null, leaderboard.qualityByIso),
  };
}

export function entryKicker(row) {
  return row.derivedKind
    ? `${kindLabel(row)} · ${row.memberCount} countries`
    : [row.region?.name, row.iso].filter(Boolean).join(" · ");
}

/** "7th of 146 countries"; groups are never ranked. */
export function rankLabel({ row, rank, total }) {
  if (row.derivedKind) return `Group of ${row.memberCount} countries`;
  return rank ? `${ordinal(rank)} of ${total} countries` : "Not ranked";
}

export function entryDescription({ row, rank, total }) {
  const score = tomerColumn.format(tomerColumn.value(row));
  const history = `Health, safety, freedom and income history since ${YEAR_MIN}.`;
  if (row.derivedKind) {
    const kind = kindLabel(row);
    // "Income group" reads as "income group" mid-sentence; "World Bank …" keeps its capitals.
    const noun = kind.startsWith("World Bank") ? kind : kind.toLowerCase();
    const about =
      kind === row.name
        ? `${row.memberCount} countries`
        : `${noun} of ${row.memberCount} countries`;
    return `${row.name} (${about}) scores ${score} on the Tomer index (${YEAR_MAX}). ${history}`;
  }
  if (!rank)
    return `${row.name} has no ${YEAR_MAX} Tomer index score. ${history}`;
  const place = `${ordinal(rank)} of ${total} countries, ${YEAR_MAX}`;
  return `${row.name} scores ${score} on the Tomer index (${place}). ${history}`;
}
