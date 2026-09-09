"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDataset, useQuery } from "./hooks";
import {
  Header,
  DataStatus,
  YearControl,
  Weights,
  MetricCell,
  QualityBadge,
} from "./shared";
import {
  readYear,
  readWeights,
  weightQuery,
  rowsForYear,
  sortedRows,
  rowType,
  TYPE_FILTERS,
  columns,
} from "../view-model.js";
import { dataQualityForRow } from "../data-quality.js";
import { YEAR_MAX } from "../site-years.js";
import {
  geographicRegionForRow,
  matchesRegions,
  regionOptions,
} from "../regions.js";

export default function Leaderboard() {
  const [params, update] = useQuery();
  const router = useRouter();
  const year = readYear(params),
    weights = readWeights(params);
  const leaderboard = useDataset("leaderboard");
  const history = useDataset("series", year !== YEAR_MAX);
  const datasets = year === YEAR_MAX ? [leaderboard] : [leaderboard, history];
  const countries = leaderboard.data?.countries ?? [];
  const series = history.data?.entrySeries ?? {};
  const qualityFor = (row) =>
    dataQualityForRow(row, series, leaderboard.data?.qualityByIso);
  const csv = (key) => (params.get(key) ?? "").split(",").filter(Boolean);
  const search = params.get("q") ?? "",
    quality = params.get("quality") ?? "all";
  const aggregates = params.get("aggregates") !== "0";
  const sort = ["name", ...columns.map((col) => col.key)].includes(
    params.get("sort"),
  )
    ? params.get("sort")
    : "tomer";
  const bestFirst = params.get("dir") !== "asc";
  const filtered = rowsForYear(countries, series, year).filter((row) => {
    if (!aggregates && row.derivedKind) return false;
    if (!matchesRegions(row, csv("region"))) return false;
    if (
      (quality === "complete" && qualityFor(row)) ||
      (quality === "incomplete" && !qualityFor(row))
    )
      return false;
    for (const [key, value] of [
      ["type", rowType(row)],
      ["income", row.incomeLevel?.id],
    ]) {
      if (csv(key).length && !csv(key).includes(value)) return false;
    }
    return [
      row.name,
      row.iso,
      row.region?.name,
      geographicRegionForRow(row)?.name,
      row.incomeLevel?.name,
      row.derivedKind,
      TYPE_FILTERS.find((type) => type.id === rowType(row))?.name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(search.trim().toLowerCase());
  });
  const rows = sortedRows(filtered, sort, bestFirst, weights);
  const regions = regionOptions(countries);
  const options = (key) =>
    [
      ...new Map(
        countries
          .filter((row) => row[key]?.id)
          .map((row) => [row[key].id, row[key]]),
      ).values(),
    ].sort((a, b) => a.name.localeCompare(b.name));
  function chips(label, key, values) {
    return (
      <fieldset className="filter-chips">
        <legend className="control-label">{label}</legend>
        <div className="chips">
          {values.map(({ id, name }) => (
            <button
              key={id}
              className={`chip${csv(key).includes(id) ? " is-active" : ""}`}
              aria-pressed={csv(key).includes(id)}
              onClick={() =>
                update({
                  [key]: csv(key).includes(id)
                    ? csv(key)
                        .filter((value) => value !== id)
                        .join(",")
                    : [...csv(key), id].join(","),
                })
              }
            >
              {name}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }
  const rank = (row, i) =>
    sort === "name" ||
    Number.isFinite(
      columns.find((col) => col.key === sort)?.value(row, weights),
    )
      ? i + 1
      : "—";
  const href = (row) => `/entry?iso=${encodeURIComponent(row.iso)}`;
  const openRow = (event, row) => {
    if (event.target.closest("a,button,[data-tip]")) return;
    if (event.type === "click" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      router.push(href(row));
    }
  };
  return (
    <>
      <Header title="Tomer index" kicker="Leaderboard">
        <p className="hero-pillars">Abundance · Safety · Health · Freedom</p>
      </Header>
      <DataStatus datasets={datasets} />
      <main>
        <section
          className="leaderboard-controls"
          aria-label="Leaderboard filters"
        >
          <div className="control-row">
            <YearControl
              year={year}
              onChange={(value) =>
                update({ year: value === YEAR_MAX ? null : value })
              }
            />
            <label className="search-control">
              <span className="control-label">Search</span>
              <input
                type="search"
                id="search-input"
                placeholder="Country, region, group…"
                autoComplete="off"
                value={search}
                onChange={(event) => update({ q: event.target.value })}
              />
            </label>
            <label className="toggle-control">
              <input
                type="checkbox"
                checked={aggregates}
                onChange={(event) =>
                  update({ aggregates: event.target.checked ? null : "0" })
                }
              />
              <span>Include aggregates</span>
            </label>
          </div>
          <div className="control-row filter-groups">
            {chips("Type", "type", TYPE_FILTERS)}
            {chips("Region", "region", regions.broad)}
            {chips("Income", "income", options("incomeLevel"))}
            <button
              className="btn filter-reset"
              onClick={() =>
                update({
                  q: null,
                  type: null,
                  region: null,
                  income: null,
                  quality: null,
                  aggregates: null,
                })
              }
            >
              Reset
            </button>
          </div>
          <div className="control-row">
            {chips("Detailed region", "region", regions.detailed)}
          </div>
          <p className="m-0 text-xs text-muted">
            Detailed regions filter countries using{" "}
            <a
              href="https://unstats.un.org/unsd/methodology/m49/"
              target="_blank"
              rel="noreferrer"
            >
              UN geographic groupings
            </a>
            . Select multiple regions to include countries from any of them.
          </p>
          <div className="control-row">
            <fieldset className="filter-chips data-quality-filter">
              <legend className="control-label">Data quality</legend>
              <div className="chips">
                {["all", "complete", "incomplete"].map((value) => (
                  <button
                    key={value}
                    className={`chip capitalize${quality === value ? " is-active" : ""}`}
                    aria-pressed={quality === value}
                    onClick={() =>
                      update({ quality: value === "all" ? null : value })
                    }
                  >
                    {value}
                  </button>
                ))}
              </div>
            </fieldset>
            <p className="data-quality-note">
              <span className="data-quality-badge">Incomplete data</span> means
              at least one yearly point is missing an index input. Hover or tap
              a badge for details.
            </p>
          </div>
          <div className="control-row">
            <Weights
              label="Leaderboard"
              weights={weights}
              onChange={(next) => update(weightQuery(next))}
            />
          </div>
        </section>
        {datasets.every((dataset) => dataset.data) && (
          <>
            <div className="mobile-sort">
              <label className="search-control">
                <span className="control-label">Sort by</span>
                <select
                  value={sort}
                  onChange={(event) =>
                    update({ sort: event.target.value, dir: null })
                  }
                >
                  {[{ key: "name", label: "Place" }, ...columns].map(
                    (column) => (
                      <option key={column.key} value={column.key}>
                        {column.label}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <button
                className="btn"
                onClick={() => update({ dir: bestFirst ? "asc" : null })}
              >
                {sort === "name"
                  ? bestFirst
                    ? "A–Z"
                    : "Z–A"
                  : bestFirst
                    ? "Best first"
                    : "Worst first"}
              </button>
            </div>
            <div className="table-wrap">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    {[{ key: "name", label: "Place" }, ...columns].map(
                      (column) => (
                        <th
                          key={column.key}
                          scope="col"
                          aria-sort={
                            sort === column.key
                              ? (column.key === "name" || !!column.lower) ===
                                bestFirst
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          <button
                            className={`th-sort${sort === column.key ? " is-active" : ""}`}
                            data-sort={column.key}
                            aria-label={`Sort by ${column.label}${sort === column.key ? ": click to reverse" : ""}`}
                            onClick={() =>
                              update({
                                sort:
                                  column.key === "tomer" ? null : column.key,
                                dir:
                                  sort === column.key && bestFirst
                                    ? "asc"
                                    : null,
                              })
                            }
                          >
                            <span className="th-sort-label">
                              {column.label}
                            </span>
                            <span className="th-sort-icon" aria-hidden="true">
                              {sort === column.key
                                ? bestFirst
                                  ? "↓"
                                  : "↑"
                                : ""}
                            </span>
                          </button>
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={row.iso}
                      className="leaderboard-row-link"
                      tabIndex={0}
                      aria-label={`Open ${row.name} history`}
                      onClick={(event) => openRow(event, row)}
                      onKeyDown={(event) => openRow(event, row)}
                    >
                      <td>{rank(row, i)}</td>
                      <td className="place-cell">
                        <Link
                          className="leaderboard-entry-link"
                          href={href(row)}
                          prefetch={false}
                        >
                          {row.name}
                        </Link>
                        <QualityBadge quality={qualityFor(row)} />
                      </td>
                      {columns.map((column) => (
                        <td key={column.key}>
                          <MetricCell
                            compact
                            row={row}
                            column={column}
                            year={year}
                            weights={weights}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td className="empty" colSpan={9}>
                        No matches.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="leaderboard-cards">
              {rows.map((row, i) => (
                <article className="leaderboard-card" key={row.iso}>
                  <div className="leaderboard-card-head">
                    <span className="leaderboard-card-rank">
                      #{rank(row, i)}
                    </span>
                    <div>
                      <h2 className="leaderboard-card-title">
                        <Link href={href(row)} prefetch={false}>
                          {row.name}
                        </Link>
                        <QualityBadge quality={qualityFor(row)} />
                      </h2>
                      <p className="leaderboard-card-meta">
                        {
                          TYPE_FILTERS.find((type) => type.id === rowType(row))
                            ?.name
                        }
                      </p>
                    </div>
                  </div>
                  <dl className="leaderboard-card-grid">
                    {[columns.at(-1), ...columns.slice(0, -1)].map((column) => (
                      <div key={column.key}>
                        <dt>{column.label}</dt>
                        <dd>
                          <MetricCell
                            compact
                            row={row}
                            column={column}
                            year={year}
                            weights={weights}
                          />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
              {!rows.length && <p className="compare-hint">No matches.</p>}
            </div>
          </>
        )}
      </main>
    </>
  );
}
