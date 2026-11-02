import { LeaderboardCard, TableRow } from "./leaderboard";
import { readLeaderboardFile } from "../leaderboard-file.js";
import { dataQualityForRow } from "../data-quality.js";
import { metricDefs } from "../metric-defs.js";
import { YEAR_MAX } from "../site-years.js";
import {
  columnFor,
  columns,
  countryRanks,
  readWeights,
  sortedRows,
} from "../view-model.js";

const SNAPSHOT_ROWS = 25;

/**
 * Prerendered first rows of the default view, so crawlers and no-JS visitors get
 * the ranking and country links. The client leaderboard keeps it on screen until
 * its data loads, then swaps in its own rows. It uses the same rows (groups
 * included), the same row and card components, and the table's fixed column
 * widths, so the swap changes nothing on screen. The server can't know the screen
 * size, so it carries both the phone cards and the table; CSS shows the one the
 * live view will use.
 */
export default function LeaderboardSnapshot() {
  const { countries: rows, qualityByIso } = readLeaderboardFile();
  const weights = readWeights(new URLSearchParams());
  const sorted = sortedRows(rows);
  const ranks = countryRanks(sorted);
  const top = sorted.slice(0, SNAPSHOT_ROWS);
  const groupCount = rows.filter((row) => row.derivedKind).length;
  const quality = (row) => dataQualityForRow(row, null, qualityByIso);
  const tomerColor = metricDefs.find(
    (metric) => metric.key === "customIndex",
  ).color;
  return (
    <div className="leaderboard-snapshot">
      <div className="leaderboard-results">
        <p className="leaderboard-results-count">
          Top {SNAPSHOT_ROWS} of {rows.length - groupCount} countries and{" "}
          {groupCount} groups in {YEAR_MAX}.
        </p>
      </div>
      <div className="leaderboard-cards" style={{ "--tomer-color": tomerColor }}>
        {top.map((row) => (
          <LeaderboardCard
            key={row.iso}
            row={row}
            rank={ranks.get(row.iso)}
            quality={quality(row)}
            sort="tomer"
            weights={weights}
            scoreLabel={columnFor("tomer").label}
          />
        ))}
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
            {top.map((row) => (
              <TableRow
                key={row.iso}
                row={row}
                rank={ranks.get(row.iso)}
                quality={quality(row)}
                year={YEAR_MAX}
                weights={weights}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
