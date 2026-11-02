"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
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
  readList,
  readQuality,
  readSort,
  weightQuery,
  isCustomWeights,
  rowsForSnapshot,
  sortedRows,
  countryRanks,
  rowType,
  kindLabel,
  matchesIncome,
  matchesSearch,
  entryHref,
  QUALITY_FILTERS,
  TYPE_FILTERS,
  columns,
  columnFor,
} from "../view-model.js";
import { dataQualityForRow } from "../data-quality.js";
import {
  DEFAULT_WEIGHT_POINTS,
  WEIGHT_KEYS,
  normalizedWeightPoints,
} from "../index-weights.js";
import { YEAR_MAX } from "../site-years.js";
import { metricDefs } from "../metric-defs.js";
import { TOPIC_COLORS } from "../topic-colors.js";
import { matchesRegions, regionOptions } from "../regions.js";

const tomerColor = metricDefs.find((metric) => metric.key === "customIndex").color;
const PILLARS = WEIGHT_KEYS.map((key) => [
  key,
  `${key[0].toUpperCase()}${key.slice(1)}`,
]);
const QUALITY_LABELS = {
  all: "All",
  complete: "Complete history",
  incomplete: "History gaps",
};
const RESET_FILTERS = {
  q: null,
  type: null,
  region: null,
  income: null,
  quality: null,
  aggregates: null,
};
// Phones get compact cards, paged so the first screen renders quickly.
const PHONE_QUERY = "(max-width: 560px)";
const CARD_PAGE = 40;

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const percent = (share) => `${+(share * 100).toFixed(1)}%`;
const weightsKey = (weights) =>
  WEIGHT_KEYS.map((key) => weights[key]).join(",");
const DEFAULT_SPLIT = Object.values(DEFAULT_WEIGHT_POINTS).join("/");
const DEFAULT_MIX = PILLARS.map(
  ([key, name]) => `${name.toLowerCase()} ${DEFAULT_WEIGHT_POINTS[key]}%`,
)
  .join(", ")
  .replace(/, ([^,]*)$/, " and $1");
const groupMeta = (row) =>
  [
    kindLabel(row),
    row.memberCount && plural(row.memberCount, "country", "countries"),
  ]
    .filter(Boolean)
    .join(" · ");
const pillarScore = (value) =>
  Number.isFinite(value) ? Math.round(value * 100) : "—";

function subscribePhone(notify) {
  const list = window.matchMedia?.(PHONE_QUERY);
  list?.addEventListener("change", notify);
  return () => list?.removeEventListener("change", notify);
}
/** True on phone-sized viewports; the server (and jsdom) render the table. */
function usePhoneLayout() {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia?.(PHONE_QUERY).matches ?? false,
    () => false,
  );
}

/**
 * Local state for a URL-backed control, so edits render at once (Next applies
 * replaceState in a transition, which would move the caret and lag sliders). It
 * re-syncs when the URL changes from elsewhere (Reset, Back) and ignores late
 * echoes of earlier writes, which no longer match the current URL.
 */
function useUrlDraft(value, read, key = String) {
  const [draft, setDraft] = useState(value);
  const id = key(value);
  useEffect(() => {
    if (key(read(new URLSearchParams(window.location.search))) !== id) return;
    setDraft((prev) => (key(prev) === id ? prev : value));
  }, [id]);
  return [draft, setDraft];
}

// The prerendered snapshot shows the same lede, so the page keeps its height when
// the client view takes over.
function LeaderboardLede() {
  return (
    <p className="leaderboard-lede">
      A score against fixed goalposts, weighting {DEFAULT_MIX}. 100 means
      every goalpost is met; it isn’t a ceiling.{" "}
      <span className="leaderboard-lede-years">
        Small numbers under each value are the years its data comes from
        (“est.” = estimated from an earlier year’s value, “GDP” = GDP used
        before a country’s GNI starts).
      </span>{" "}
      <Link href="/methodology">How it’s calculated</Link>
    </p>
  );
}

function RankText({ row, rank }) {
  if (rank) return rank;
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="visually-hidden">
        {row.derivedKind ? "Group, not ranked" : "Not ranked"}
      </span>
    </>
  );
}

// Memoized rows and cards: a filter or rank change only touches rows it moves.
// The page's prerendered snapshot renders these too, so the two views match.
export const TableRow = memo(function TableRow({ row, rank, quality, year, weights }) {
  return (
    <tr
      data-iso={row.iso}
      className={`leaderboard-row-link${row.derivedKind ? " is-group" : ""}`}
    >
      <td>
        <RankText row={row} rank={rank} />
      </td>
      <td className="place-cell">
        <Link
          className="leaderboard-entry-link"
          href={entryHref(row.iso)}
          prefetch={false}
        >
          {row.name}
        </Link>
        <QualityBadge quality={quality} />
        {row.derivedKind && (
          <span className="leaderboard-group-meta">{groupMeta(row)}</span>
        )}
      </td>
      {columns.map((column) => (
        <td key={column.key} data-metric={column.key}>
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
  );
});

export const LeaderboardCard = memo(function LeaderboardCard({
  row,
  rank,
  quality,
  sort,
  weights,
  scoreLabel,
}) {
  const tomer = columnFor("tomer");
  const sorted = ["name", "tomer"].includes(sort) ? null : columnFor(sort);
  return (
    <article
      className={`leaderboard-card${row.derivedKind ? " is-group" : ""}`}
    >
      <div className="leaderboard-card-head">
        <p className="leaderboard-card-rank">
          {rank ? (
            `#${rank}`
          ) : row.derivedKind ? (
            groupMeta(row)
          ) : (
            <RankText row={row} />
          )}
        </p>
        <h2 className="leaderboard-card-title">
          <Link href={entryHref(row.iso)} prefetch={false}>
            {row.name}
          </Link>
          <QualityBadge quality={quality} />
        </h2>
        <p className="leaderboard-card-score">
          <span className="leaderboard-card-score-value">
            {tomer.format(tomer.value(row, weights))}
          </span>
          <span className="leaderboard-card-score-label">{scoreLabel}</span>
        </p>
      </div>
      <p className="leaderboard-card-pillars">
        {PILLARS.map(([key, name], i) => (
          <span key={key} style={{ "--topic-color": TOPIC_COLORS[key] }}>
            {i ? " · " : ""}
            {name} <b>{pillarScore(row[`${key}Index`])}</b>
          </span>
        ))}
      </p>
      {sorted && (
        <p className="leaderboard-card-sorted">
          {sorted.label}: <b>{sorted.format(sorted.value(row, weights))}</b>
        </p>
      )}
    </article>
  );
});

function EmptyResults({ onReset }) {
  return (
    <>
      No countries or groups match these filters.{" "}
      <button className="btn" onClick={onReset}>
        Reset filters
      </button>
    </>
  );
}

/**
 * `placeholder` (the page's prerendered top-25 table) stays in place of the results
 * until the data loads, so the first client render never blanks the table.
 */
export default function Leaderboard({ placeholder }) {
  const [params, update] = useQuery();
  return (
    <LeaderboardView params={params} update={update} placeholder={placeholder} />
  );
}

const DEFAULT_PARAMS = new URLSearchParams();
/**
 * The Suspense fallback the page prerenders (the client view reads the URL, so it
 * renders only in the browser): the default view with inert controls around the
 * placeholder, laid out exactly like the client view that replaces it.
 */
export function LeaderboardPreview({ placeholder }) {
  return (
    <LeaderboardView
      params={DEFAULT_PARAMS}
      update={() => {}}
      placeholder={placeholder}
      preview
    />
  );
}

function LeaderboardView({ params, update, placeholder, preview = false }) {
  const router = useRouter();
  const phone = usePhoneLayout();
  // Year, search and weights keep local drafts; results follow deferred copies
  // so typing and dragging stay responsive while the rows re-render.
  const [year, setYear] = useUrlDraft(readYear(params), readYear);
  const [search, setSearch] = useUrlDraft(
    params.get("q") ?? "",
    (query) => query.get("q") ?? "",
  );
  const [draftWeights, setDraftWeights] = useUrlDraft(
    readWeights(params),
    readWeights,
    weightsKey,
  );
  const deferredSearch = useDeferredValue(search);
  const weights = useDeferredValue(draftWeights);
  const custom = isCustomWeights(weights);
  const scoreLabel = custom ? "Custom index" : columnFor("tomer").label;
  const quality = readQuality(params),
    sort = readSort(params);
  const bestFirst = params.get("dir") !== "asc";
  const aggregates = params.get("aggregates") !== "0";
  const typeParam = params.get("type"),
    regionParam = params.get("region"),
    incomeParam = params.get("income");
  const selected = useMemo(
    () => ({
      type: readList(params, "type"),
      region: readList(params, "region"),
      income: readList(params, "income"),
    }),
    [typeParam, regionParam, incomeParam],
  );
  const activeFilters =
    selected.type.length +
    selected.region.length +
    selected.income.length +
    (quality === "all" ? 0 : 1);
  const [filtersOpen, setFiltersOpen] = useState(activeFilters > 0);
  const [weightsOpen, setWeightsOpen] = useState(() =>
    isCustomWeights(draftWeights),
  );
  const [cardLimit, setCardLimit] = useState(CARD_PAGE);

  const leaderboard = useDataset("leaderboard", !preview);
  const snapshot = useDataset(`year:${year}`, !preview && year !== YEAR_MAX);
  const countries = leaderboard.data?.countries;
  const qualityByIso = leaderboard.data?.qualityByIso;
  // While another year's snapshot loads, keep the last year on screen.
  const loaded =
    year === YEAR_MAX
      ? { year, points: null }
      : snapshot.data && { year, points: snapshot.data };
  const [shown, setShown] = useState(loaded);
  if (
    loaded &&
    (loaded.year !== shown?.year || loaded.points !== shown?.points)
  )
    setShown(loaded);
  const view = loaded || shown;
  const ready = Boolean(countries && view);
  const pending = ready && view.year !== year && !snapshot.error;
  const blocking = year === YEAR_MAX ? [leaderboard] : [leaderboard, snapshot];

  const yearRows = useMemo(
    () => (ready ? rowsForSnapshot(countries, view.points, view.year) : []),
    [ready, countries, view?.points, view?.year],
  );
  const filtered = useMemo(
    () =>
      yearRows.filter(
        (row) =>
          (aggregates || !row.derivedKind) &&
          (!selected.type.length || selected.type.includes(rowType(row))) &&
          matchesRegions(row, selected.region) &&
          matchesIncome(row, selected.income) &&
          (quality === "all" ||
            (quality === "incomplete") ===
              Boolean(dataQualityForRow(row, null, qualityByIso))) &&
          matchesSearch(row, deferredSearch),
      ),
    [yearRows, aggregates, selected, quality, qualityByIso, deferredSearch],
  );
  const rows = useMemo(
    () => sortedRows(filtered, sort, bestFirst, weights),
    [filtered, sort, bestFirst, weights],
  );
  // Countries only, numbered in best-first order so reversing keeps each rank.
  const ranks = useMemo(
    () =>
      countryRanks(
        bestFirst ? rows : sortedRows(filtered, sort, true, weights),
        sort,
        weights,
      ),
    [rows, filtered, sort, bestFirst, weights],
  );
  const regions = useMemo(() => regionOptions(countries ?? []), [countries]);
  const incomeOptions = useMemo(
    () =>
      [
        ...new Map(
          (countries ?? [])
            .filter((row) => row.incomeLevel?.id)
            .map((row) => [row.incomeLevel.id, row.incomeLevel]),
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name)),
    [countries],
  );
  const groupCount = rows.filter((row) => row.derivedKind).length;
  const countryCount = rows.length - groupCount;
  const qualityFor = (row) => dataQualityForRow(row, null, qualityByIso);

  function changeYear(value) {
    setYear(value);
    update({ year: value === YEAR_MAX ? null : value });
  }
  function changeSearch(value) {
    setSearch(value);
    update({ q: value });
  }
  function changeWeights(next) {
    setDraftWeights(next);
    update(weightQuery(next));
  }
  function resetFilters() {
    setSearch("");
    update(RESET_FILTERS);
  }
  // A mouse click anywhere on a row opens it; the name link is the keyboard path.
  function openRow(event) {
    if (event.target.closest("a,button,[data-tip]")) return;
    const iso = event.target.closest("tr[data-iso]")?.dataset.iso;
    if (iso) router.push(entryHref(iso));
  }
  function chips(label, key, values) {
    const active = selected[key];
    return (
      <fieldset className="filter-chips">
        <legend className="control-label">{label}</legend>
        <div className="chips">
          {values.map(({ id, name }) => (
            <button
              key={id}
              className={`chip${active.includes(id) ? " is-active" : ""}`}
              aria-pressed={active.includes(id)}
              onClick={() =>
                update({
                  [key]: (active.includes(id)
                    ? active.filter((value) => value !== id)
                    : [...active, id]
                  ).join(","),
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
  const labelFor = (column) =>
    column.key === "tomer" ? scoreLabel : column.label;
  const sortColumns = [{ key: "name", label: "Place" }, ...columns];

  return (
    <main id="main">
      <Header title="Tomer index" kicker="Leaderboard">
        <p className="hero-pillars">Abundance · Safety · Health · Freedom</p>
        <LeaderboardLede />
      </Header>
      {preview && (
        <noscript>
          <p className="status">
            Filters, search, custom weights and earlier years need JavaScript.
            Each country’s page has its full history.
          </p>
        </noscript>
      )}
      {/* The placeholder covers loading; a failure still shows the error and Retry. */}
      <DataStatus
        datasets={
          ready || placeholder
            ? blocking.filter((dataset) => dataset.error)
            : blocking
        }
      />
      <section
        className="leaderboard-controls"
        aria-label="Leaderboard controls"
        inert={preview || undefined}
      >
        <div className="control-row">
          <YearControl year={year} onChange={changeYear} />
          <label className="search-control">
            <span className="control-label">Search</span>
            <input
              type="search"
              id="search-input"
              placeholder="Country, region, group…"
              autoComplete="off"
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
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
            <span>Show regions &amp; groups</span>
          </label>
          <button className="btn filter-reset" onClick={resetFilters}>
            Reset filters
          </button>
        </div>
        <div className="leaderboard-disclosures">
          <details
            className="leaderboard-filters"
            open={filtersOpen}
            onToggle={(event) => setFiltersOpen(event.currentTarget.open)}
          >
            <summary>
              Filters
              {activeFilters > 0 && (
                <span className="leaderboard-filter-count">
                  {activeFilters}
                  <span className="visually-hidden"> active</span>
                </span>
              )}
            </summary>
            <div className="leaderboard-filters-body">
              <div className="control-row filter-groups">
                {chips("Type", "type", TYPE_FILTERS)}
                {chips("Region", "region", regions.broad)}
                {chips("Income", "income", incomeOptions)}
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
                . Select multiple regions to include countries from any of
                them.
              </p>
              <div className="control-row">
                <fieldset className="filter-chips data-quality-filter">
                  <legend className="control-label">Data quality</legend>
                  <div className="chips">
                    {QUALITY_FILTERS.map((value) => (
                      <button
                        key={value}
                        className={`chip${quality === value ? " is-active" : ""}`}
                        aria-pressed={quality === value}
                        onClick={() =>
                          update({ quality: value === "all" ? null : value })
                        }
                      >
                        {QUALITY_LABELS[value]}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <p className="data-quality-note">
                  <span className="data-quality-badge">History gaps</span>{" "}
                  means at least one year is missing an index input. Hover or
                  tap a badge for details.
                </p>
              </div>
            </div>
          </details>
          <details
            className="leaderboard-filters"
            open={weightsOpen}
            onToggle={(event) => setWeightsOpen(event.currentTarget.open)}
          >
            <summary>Custom weights</summary>
            <Weights
              label="Pillar"
              weights={draftWeights}
              onChange={changeWeights}
            />
          </details>
        </div>
      </section>
      <div className="mobile-sort" inert={preview || undefined}>
        <label className="search-control">
          <span className="control-label">Sort by</span>
          <select
            value={sort}
            onChange={(event) =>
              update({ sort: event.target.value, dir: null })
            }
          >
            {sortColumns.map((column) => (
              <option key={column.key} value={column.key}>
                {labelFor(column)}
              </option>
            ))}
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
      {!ready && placeholder}
      {ready && (
        <>
          <div className="leaderboard-results">
            <p className="leaderboard-results-count" role="status">
              {pending && `Loading ${year}… `}
              {rows.length
                ? `Showing ${[
                    countryCount &&
                      plural(countryCount, "country", "countries"),
                    groupCount && plural(groupCount, "group", "groups"),
                  ]
                    .filter(Boolean)
                    .join(" and ")}${
                    view.year === YEAR_MAX ? "" : ` in ${view.year}`
                  }${custom ? ", with custom weights" : ""}.`
                : "No countries or groups match these filters."}
            </p>
            {custom && (
              <p className="leaderboard-custom-note">
                Scores use a custom index (
                {PILLARS.map(
                  ([key, name]) =>
                    `${name} ${percent(normalizedWeightPoints(weights)[key])}`,
                ).join(" · ")}
                ). The published Tomer index uses {DEFAULT_SPLIT}.{" "}
                <button
                  className="btn"
                  onClick={() => changeWeights({ ...DEFAULT_WEIGHT_POINTS })}
                >
                  Reset weights
                </button>
              </p>
            )}
          </div>
          {phone ? (
            <div
              className="leaderboard-cards"
              style={{ "--tomer-color": tomerColor }}
            >
              {rows.slice(0, cardLimit).map((row) => (
                <LeaderboardCard
                  key={row.iso}
                  row={row}
                  rank={ranks.get(row.iso)}
                  quality={qualityFor(row)}
                  sort={sort}
                  weights={weights}
                  scoreLabel={scoreLabel}
                />
              ))}
              {rows.length > cardLimit && (
                <button
                  className="btn leaderboard-more"
                  onClick={() => setCardLimit((limit) => limit + CARD_PAGE)}
                >
                  Show more{" "}
                  <span className="muted">
                    ({rows.length - cardLimit} left)
                  </span>
                </button>
              )}
              {!rows.length && (
                <p className="empty">
                  <EmptyResults onReset={resetFilters} />
                </p>
              )}
            </div>
          ) : (
            <div className="table-wrap">
              <table
                className="leaderboard-table"
                style={{ "--tomer-color": tomerColor }}
                aria-busy={pending || undefined}
              >
                <caption className="visually-hidden">
                  {scoreLabel} leaderboard, {view.year}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Rank</th>
                    {sortColumns.map((column) => (
                      <th
                        key={column.key}
                        scope="col"
                        data-metric={column.key}
                        aria-sort={
                          sort !== column.key
                            ? undefined
                            : (column.key === "name" || !!column.lower) ===
                                bestFirst
                              ? "ascending"
                              : "descending"
                        }
                      >
                        <button
                          className={`th-sort${sort === column.key ? " is-active" : ""}`}
                          data-sort={column.key}
                          title={column.long}
                          onClick={() =>
                            update({
                              sort: column.key === "tomer" ? null : column.key,
                              dir:
                                sort === column.key && bestFirst
                                  ? "asc"
                                  : null,
                            })
                          }
                        >
                          <span className="th-sort-label">
                            {labelFor(column)}
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
                    ))}
                  </tr>
                </thead>
                <tbody onClick={openRow}>
                  {rows.map((row) => (
                    <TableRow
                      key={row.iso}
                      row={row}
                      rank={ranks.get(row.iso)}
                      quality={qualityFor(row)}
                      year={view.year}
                      weights={weights}
                    />
                  ))}
                  {!rows.length && (
                    <tr>
                      <td className="empty" colSpan={columns.length + 2}>
                        <EmptyResults onReset={resetFilters} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
