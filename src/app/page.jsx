import { Suspense } from "react";
import Link from "next/link";
import Leaderboard, { LeaderboardPreview } from "../components/leaderboard";
import { scoredCountries } from "../leaderboard-file.js";
import { metricDefs } from "../metric-defs.js";
import { YEAR_MAX, YEAR_MIN } from "../site-years.js";
import { columns, countryRanks, entryHref, sortedRows } from "../view-model.js";

const SNAPSHOT_ROWS = 25;

export const metadata = {
  title: {
    absolute: "Tomer index — health, safety, freedom and abundance by country",
  },
  description: `${scoredCountries().length} countries ranked 0–100 on health, safety, freedom and abundance against fixed goalposts, ${YEAR_MIN}–${YEAR_MAX}. Filter by region or income, or set your own weights.`,
  alternates: { canonical: "/" },
};

/**
 * Prerendered results for the default view's top countries, so crawlers and
 * no-JS visitors get the ranking and country links. The client leaderboard keeps
 * it on screen until its data loads. Values only; per-cell source-year badges
 * would triple the HTML (the cells keep the badge slot, so rows match in height).
 */
function LeaderboardSnapshot() {
  const countries = scoredCountries();
  const sorted = sortedRows(countries);
  const ranks = countryRanks(sorted);
  const tomerColor = metricDefs.find(
    (metric) => metric.key === "customIndex",
  ).color;
  return (
    <>
      <div className="leaderboard-results">
        <p className="leaderboard-results-count">
          Top {SNAPSHOT_ROWS} of {countries.length} countries in {YEAR_MAX}.
        </p>
      </div>
      <div className="table-wrap">
        <table
          className="leaderboard-table"
          style={{ "--tomer-color": tomerColor }}
        >
          <caption className="visually-hidden">
            Tomer index leaderboard, {YEAR_MAX}
          </caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              {[{ key: "name", label: "Place" }, ...columns].map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  data-metric={column.key}
                  aria-sort={column.key === "tomer" ? "descending" : undefined}
                >
                  <span
                    className={`th-sort${column.key === "tomer" ? " is-active" : ""}`}
                    data-sort={column.key}
                    title={column.long}
                  >
                    <span className="th-sort-label">{column.label}</span>
                    <span className="th-sort-icon" aria-hidden="true">
                      {column.key === "tomer" ? "↓" : ""}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, SNAPSHOT_ROWS).map((row) => (
              <tr key={row.iso}>
                <td>{ranks.get(row.iso)}</td>
                <td className="place-cell">
                  <Link
                    className="leaderboard-entry-link"
                    href={entryHref(row.iso)}
                    prefetch={false}
                  >
                    {row.name}
                  </Link>
                </td>
                {columns.map((column) => (
                  <td key={column.key} data-metric={column.key}>
                    <span className="metric-cell">
                      <span className="metric-cell-value">
                        {column.format(column.value(row))}
                      </span>
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function Page() {
  const snapshot = <LeaderboardSnapshot />;
  return (
    <Suspense fallback={<LeaderboardPreview placeholder={snapshot} />}>
      <Leaderboard placeholder={snapshot} />
    </Suspense>
  );
}
