"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useDataset, useDatasets, useQuery } from "./hooks";
import {
  Header,
  DataStatus,
  YearControl,
  MetricCell,
  PillarBars,
} from "./shared";
import HistoryChart, { SERIES_COLORS } from "./history-chart";
import {
  columns,
  contextColumns,
  entryHref,
  kindLabel,
  matchesSearch,
  readPicks,
  readYear,
  rowsForSnapshot,
  tomerRanks,
} from "../view-model.js";
import { geographicRegionForRow } from "../regions.js";
import { metricDefs } from "../metric-defs.js";
import { STALE_YEARS } from "../source-years.js";
import { YEAR_MAX, YEAR_MIN } from "../site-years.js";

const PRESETS = {
  G7: ["USA", "GBR", "FRA", "DEU", "ITA", "JPN", "CAN"],
  BRICS: ["BRA", "RUS", "IND", "CHN", "ZAF"],
  Nordics: ["NOR", "SWE", "FIN", "DNK", "ISL"],
};
const RANKED_PRESETS = ["Top 5", "Bottom 5"];
const tomerColor = metricDefs.find(
  (metric) => metric.key === "customIndex",
).color;
const seriesColor = (index) => SERIES_COLORS[index % SERIES_COLORS.length];

function listText(items) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}
function countText(rows) {
  const groups = rows.filter((row) => row.derivedKind).length,
    nations = rows.length - groups;
  return listText(
    [
      nations && `${nations} ${nations === 1 ? "country" : "countries"}`,
      groups && `${groups} ${groups === 1 ? "group" : "groups"}`,
    ].filter(Boolean),
  );
}

/** Shared with the route's server-rendered fallback, so the heading never jumps. */
export function CompareHeader() {
  return (
    <Header title="Compare countries" kicker="Side by side">
      <p className="lede">
        Put countries and groups side by side: their Tomer index, the
        indicators behind it, and how each has changed since {YEAR_MIN}.
      </p>
    </Header>
  );
}

/**
 * One "type to add" field. Picking from the list adds at once; Enter adds an exact
 * name or ISO code, or the only row matching the text (same matching as every search).
 */
function AddPicker({ countries, selected, onAdd, disabled }) {
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const taken = new Set(selected);
  const available = countries
    .filter((row) => !taken.has(row.iso))
    .sort(
      (a, b) =>
        Boolean(a.derivedKind) - Boolean(b.derivedKind) ||
        a.name.localeCompare(b.name),
    );
  const exact = (query) => {
    const needle = query.trim().toLowerCase();
    return countries.find((row) =>
      [row.name.toLowerCase(), row.iso.toLowerCase()].includes(needle),
    );
  };
  // Nothing left to add matches: say so, or that the matches are already picked.
  const noMatch = (query) => {
    const picked = countries.filter(
      (row) => taken.has(row.iso) && matchesSearch(row, query),
    );
    if (!picked.length) return `No country or group matches “${query}”.`;
    return picked.length === 1
      ? `${picked[0].name} is already selected.`
      : `Every match for “${query}” is already selected.`;
  };
  function add(row) {
    onAdd(row.iso);
    setValue("");
    setMessage(`Added ${row.name}.`);
  }
  return (
    <div className="search-control compare-add">
      <label className="control-label" htmlFor="compare-add">
        Add a country or group
      </label>
      <input
        type="search"
        id="compare-add"
        list="compare-add-list"
        placeholder="Name or ISO code…"
        autoComplete="off"
        disabled={disabled}
        aria-describedby="compare-add-message"
        value={value}
        onChange={(event) => {
          const next = event.target.value,
            query = next.trim(),
            match = exact(next);
          // Picking from the list replaces the text; typing "Niger" must not add it
          // on the way to "Nigeria", so typed exact matches wait for Enter.
          const typed = event.nativeEvent?.inputType;
          const picked = !typed || typed === "insertReplacementText";
          if (match && !taken.has(match.iso) && picked) return add(match);
          setValue(next);
          setMessage(
            !query
              ? ""
              : match && taken.has(match.iso)
                ? `${match.name} is already selected.`
                : available.some((row) => matchesSearch(row, query))
                  ? ""
                  : noMatch(query),
          );
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          const query = value.trim();
          if (!query) return;
          const match = exact(query);
          if (match)
            return taken.has(match.iso)
              ? setMessage(`${match.name} is already selected.`)
              : add(match);
          const matches = available.filter((row) =>
            matchesSearch(row, query),
          );
          if (matches.length === 1) return add(matches[0]);
          setMessage(
            matches.length
              ? `${matches.length} countries and groups match “${query}”. Keep typing or choose one from the list.`
              : noMatch(query),
          );
        }}
      />
      <datalist id="compare-add-list">
        {available.map((row) => (
          <option key={row.iso} value={row.name}>
            {row.derivedKind
              ? kindLabel(row)
              : [row.iso, geographicRegionForRow(row)?.name]
                  .filter(Boolean)
                  .join(" · ")}
          </option>
        ))}
      </datalist>
      <p
        id="compare-add-message"
        className="compare-add-message"
        role="status"
      >
        {message}
      </p>
    </div>
  );
}

/** Whether the table overflows its scroller, and whether it is scrolled to the end. */
function useScrollCue() {
  const [cue, setCue] = useState({ overflow: false, end: true });
  const ref = useCallback((node) => {
    if (!node) return;
    const check = () => {
      const overflow = node.scrollWidth > node.clientWidth + 1,
        end = node.scrollLeft + node.clientWidth >= node.scrollWidth - 1;
      setCue((prev) =>
        prev.overflow === overflow && prev.end === end
          ? prev
          : { overflow, end },
      );
    };
    check();
    node.addEventListener("scroll", check, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    observer?.observe(node);
    if (node.firstElementChild) observer?.observe(node.firstElementChild);
    return () => {
      node.removeEventListener("scroll", check);
      observer?.disconnect();
    };
  }, []);
  return [ref, cue];
}

export default function Compare() {
  const [params, update] = useQuery();
  const year = readYear(params),
    pastYear = year !== YEAR_MAX,
    picks = readPicks(params);
  const leaderboard = useDataset("leaderboard"),
    snapshot = useDataset(`year:${year}`, pastYear);
  const loaded = Boolean(leaderboard.data),
    countries = leaderboard.data?.countries ?? [];
  const byIso = new Map(countries.map((row) => [row.iso, row]));
  const unique = [...new Set(picks)];
  // Picks the data doesn't know are reported once and left out everywhere else,
  // so chips, table swatches and chart lines share one color per country.
  const selection = loaded
    ? unique.flatMap((iso) => byIso.get(iso) ?? [])
    : [];
  const unknown = loaded ? unique.filter((iso) => !byIso.has(iso)) : [];
  const repeated = selection.filter(
    (row) => picks.indexOf(row.iso) !== picks.lastIndexOf(row.iso),
  );
  const isos = selection.map((row) => row.iso);
  const colorOf = new Map(isos.map((iso, i) => [iso, seriesColor(i)]));
  const multi = selection.length > 1;

  // Keep the last year on screen until the next year's snapshot arrives.
  const current =
    loaded && (!pastYear || snapshot.data)
      ? { year, rows: rowsForSnapshot(countries, snapshot.data, year) }
      : null;
  const [previous, setPrevious] = useState(null);
  if (current && previous?.year !== current.year) setPrevious(current);
  const view = current ?? previous;
  const rows = view?.rows ?? [];
  const rowsByIso = new Map(rows.map((row) => [row.iso, row]));
  const { ranks, total } = tomerRanks(rows);
  const shown = selection.flatMap((row) => rowsByIso.get(row.iso) ?? []);
  const missing = view
    ? selection.filter((row) => !rowsByIso.has(row.iso))
    : [];

  const entries = useDatasets(
    isos.map((iso) => `entry:${iso}`),
    isos.length > 0,
  );
  const [lastHistories, setLastHistories] = useState(null);
  if (entries.data && entries.data !== lastHistories)
    setLastHistories(entries.data);
  const histories = entries.data ?? lastHistories;
  const chartSeries = selection.map((row) => ({
    iso: row.iso,
    name: row.name,
    points: histories?.[`entry:${row.iso}`]?.points ?? [],
  }));

  const datasets = [
    leaderboard,
    ...(pastYear ? [snapshot] : []),
    ...(isos.length ? [entries] : []),
  ];
  const setYear = (value) =>
    update({ year: value === YEAR_MAX ? null : value });
  const setPicks = (next) => update({ picks: next.join(",") || null });

  // After a chip is removed (or Clear), move focus to its neighbour, or to the add
  // field, once the new list renders.
  const chipsRef = useRef(null);
  const [pendingFocus, setPendingFocus] = useState(null);
  const pickQuery = isos.join(",");
  useEffect(() => {
    if (!pendingFocus || pendingFocus.query !== pickQuery) return;
    const buttons = chipsRef.current?.querySelectorAll("button") ?? [];
    const target =
      buttons[Math.min(pendingFocus.index, buttons.length - 1)] ??
      document.getElementById("compare-add");
    target?.focus();
    setPendingFocus(null);
  }, [pendingFocus, pickQuery]);
  function remove(index) {
    const next = isos.filter((_, i) => i !== index);
    setPendingFocus({ index, query: next.join(",") });
    setPicks(next);
  }
  function preset(label) {
    // Ranked presets are disabled until the current year has loaded (view === current).
    const ranked = [...ranks.keys()];
    const next =
      label === "Top 5"
        ? ranked.slice(0, 5)
        : label === "Bottom 5"
          ? ranked.slice(-5).reverse()
          : PRESETS[label].filter((iso) => byIso.has(iso));
    // Never replace a shared selection with nothing.
    if (next.length) setPicks(next);
  }

  const [scrollRef, cue] = useScrollCue();
  const showTable = view && shown.length > 0;
  return (
    <main id="main">
      <CompareHeader />
      <div className="compare-panel compare-panel-page">
        <div className="compare-toolbar">
          <AddPicker
            countries={countries}
            selected={isos}
            disabled={!loaded}
            onAdd={(iso) => setPicks([...isos, iso])}
          />
          <YearControl
            id="compare-year-slider"
            year={year}
            onChange={setYear}
          />
          <fieldset className="filter-chips compare-presets">
            <legend className="control-label">
              Presets{" "}
              <span className="compare-presets-note">
                · replace the selection
              </span>
            </legend>
            <div className="chips">
              {[...Object.keys(PRESETS), ...RANKED_PRESETS].map((label) => (
                <button
                  className="chip compare-preset-chip"
                  key={label}
                  disabled={
                    RANKED_PRESETS.includes(label) ? !current : !loaded
                  }
                  onClick={() => preset(label)}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        {selection.length > 0 && (
          <div className="compare-selection">
            <ul
              className="compare-chips"
              aria-label="Selected countries and groups"
              ref={chipsRef}
            >
              {selection.map((row, index) => (
                <li className="compare-chip" key={row.iso}>
                  {multi && (
                    <i
                      className="compare-chip-swatch"
                      aria-hidden="true"
                      style={{ "--series-color": colorOf.get(row.iso) }}
                    />
                  )}
                  <span className="compare-chip-name">{row.name}</span>
                  <button
                    type="button"
                    className="compare-chip-remove"
                    aria-label={`Remove ${row.name}`}
                    onClick={() => remove(index)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn compare-clear"
              onClick={() => {
                // With no chips left, focus falls back to the add field.
                setPendingFocus({ index: 0, query: "" });
                setPicks([]);
              }}
            >
              Clear
            </button>
          </div>
        )}
        {(unknown.length > 0 || repeated.length > 0) && (
          <div className="compare-notes">
            {unknown.length > 0 && (
              <p className="compare-note">
                Unknown country {unknown.length === 1 ? "code" : "codes"}{" "}
                {listText(unknown)} ignored.
              </p>
            )}
            {repeated.length > 0 && (
              <p className="compare-note">
                {listText(repeated.map((row) => row.name))}{" "}
                {repeated.length === 1 ? "was" : "were"} picked more than
                once, so {repeated.length === 1 ? "it is" : "they are"} shown
                once.
              </p>
            )}
          </div>
        )}
        <DataStatus
          datasets={
            view ? datasets.filter((dataset) => dataset.error) : datasets
          }
        />
        {view && (
          <div className="compare-out">
            {!selection.length ? (
              <p className="compare-hint">
                Add a country or group above, or choose a preset, to start
                comparing.
              </p>
            ) : (
              <>
                <p className="compare-summary muted" aria-live="polite">
                  {!shown.length ? (
                    <>
                      No data for <strong>{view.year}</strong>.
                    </>
                  ) : shown.length === 1 ? (
                    <>
                      Showing {shown[0].name} in <strong>{view.year}</strong>.
                      Add another country or group to compare.
                    </>
                  ) : (
                    <>
                      Comparing {countText(shown)} in{" "}
                      <strong>{view.year}</strong>.
                    </>
                  )}
                  {view.year !== year && (
                    <span className="compare-loading"> Loading {year}…</span>
                  )}
                </p>
                {missing.length > 0 && (
                  <p className="compare-note">
                    No {view.year} data for{" "}
                    {listText(missing.map((row) => row.name))}.
                  </p>
                )}
                {showTable && cue.overflow && (
                  <p className="compare-scroll-hint">
                    Scroll sideways to see every column{" "}
                    <span aria-hidden="true">→</span>
                  </p>
                )}
                {showTable && (
                  <div
                    className={`compare-table-frame${cue.overflow && !cue.end ? " has-more" : ""}`}
                  >
                    <div
                      className="compare-table-wrap"
                      ref={scrollRef}
                      role="region"
                      aria-label="Comparison table"
                      tabIndex={cue.overflow ? 0 : undefined}
                    >
                      <table
                        className={`compare-table${shown.length === 1 ? " compare-single" : ""}`}
                        style={{
                          "--tomer-color": tomerColor,
                          "--compare-count": shown.length,
                        }}
                      >
                        <thead>
                          <tr>
                            <th scope="col">Metric</th>
                            {shown.map((row) => (
                              <th scope="col" key={row.iso}>
                                <span className="compare-head-title">
                                  {multi && (
                                    <i
                                      className="compare-head-swatch"
                                      aria-hidden="true"
                                      style={{
                                        "--series-color": colorOf.get(row.iso),
                                      }}
                                    />
                                  )}
                                  <Link
                                    href={entryHref(row.iso)}
                                    className="compare-head-name"
                                  >
                                    {row.name}
                                  </Link>
                                </span>
                                {row.derivedKind && (
                                  <span className="compare-head-kind">
                                    {kindLabel(row)}
                                  </span>
                                )}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="compare-rank-row">
                            <th scope="row">Rank (of {total} countries)</th>
                            {shown.map((row) => (
                              <td key={row.iso}>
                                {row.derivedKind ? (
                                  <span className="compare-unranked">
                                    Group
                                    <span className="visually-hidden">
                                      , not ranked
                                    </span>
                                  </span>
                                ) : ranks.has(row.iso) ? (
                                  ranks.get(row.iso)
                                ) : (
                                  <span className="compare-unranked">
                                    <span aria-hidden="true">—</span>
                                    <span className="visually-hidden">
                                      Not ranked
                                    </span>
                                  </span>
                                )}
                              </td>
                            ))}
                          </tr>
                          {[...columns, ...contextColumns].map((column) => {
                            const values = shown
                              .map((row) => column.value(row))
                              .filter(Number.isFinite);
                            const best =
                              values.length > 1
                                ? column.lower
                                  ? Math.min(...values)
                                  : Math.max(...values)
                                : NaN;
                            return (
                              <tr
                                key={column.key}
                                data-metric={column.key}
                                className={
                                  column.key === "tomer"
                                    ? "tomer-row"
                                    : undefined
                                }
                              >
                                <th scope="row" title={column.long}>
                                  {column.label}
                                  {column.context && (
                                    <span className="compare-row-note">
                                      Not in the index
                                    </span>
                                  )}
                                  {column.lower && (
                                    <span className="compare-row-note">
                                      Lower is better
                                    </span>
                                  )}
                                </th>
                                {shown.map((row) => {
                                  const isBest = column.value(row) === best;
                                  return (
                                    <td
                                      key={row.iso}
                                      className={
                                        isBest ? "compare-best" : undefined
                                      }
                                    >
                                      <MetricCell
                                        row={row}
                                        column={column}
                                        year={view.year}
                                        compact
                                      />
                                      {isBest && (
                                        <span className="visually-hidden">
                                          {" "}
                                          (best)
                                        </span>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                          <tr className="pillar-bars-row">
                            <th scope="row">Pillar mix</th>
                            {shown.map((row) => (
                              <td key={row.iso}>
                                <PillarBars row={row} />
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {showTable && (
                  // The compact badges aren't focusable, so their key is spelled out here.
                  <p className="compare-table-note muted">
                    {shown.length > 1 && (
                      <>
                        <span aria-hidden="true">★</span> marks the best value
                        in each row.{" "}
                      </>
                    )}
                    The small year under a value is its source year (“est.” =
                    estimated from an earlier year’s value, “GDP” = GDP used
                    before a country’s GNI starts, “*” = at least one input
                    estimated or GDP).{" "}
                    <span className="compare-table-note-stale">Amber</span>{" "}
                    years are {STALE_YEARS}+ years older than {view.year}.
                  </p>
                )}
                <section className="compare-series">
                  <div className="compare-series-head">
                    <h2 className="compare-series-title">Charts over time</h2>
                    <p className="compare-series-sub muted">
                      {multi && "Each line is one country or group. "}
                      Click or tap a chart to change the year.
                      {selection.length > SERIES_COLORS.length &&
                        ` Line colors repeat after ${SERIES_COLORS.length} picks.`}
                    </p>
                  </div>
                  {histories ? (
                    <div className="compare-series-grid">
                      {metricDefs.map((metric) => (
                        <HistoryChart
                          key={metric.key}
                          series={chartSeries}
                          metric={metric}
                          year={year}
                          onYearChange={setYear}
                        />
                      ))}
                    </div>
                  ) : (
                    !entries.error && (
                      <p className="compare-hint" role="status">
                        Loading histories…
                      </p>
                    )
                  )}
                </section>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
