"use client";
import { useState } from "react";
import Link from "next/link";
import { useDataset, useQuery } from "./hooks";
import {
  Header,
  DataStatus,
  YearControl,
  MetricCell,
  QualityBadge,
  PillarBars,
} from "./shared";
import HistoryChart, { SERIES_COLORS } from "./history-chart";
import { readYear, rowsForYear, sortedRows, columns } from "../view-model.js";
import { dataQualityForRow } from "../data-quality.js";
import { metricDefs } from "../metric-defs.js";
import { YEAR_MAX } from "../site-years.js";

const PRESETS = {
  G7: ["USA", "GBR", "FRA", "DEU", "ITA", "JPN", "CAN"],
  BRICS: ["BRA", "RUS", "IND", "CHN", "ZAF"],
  Nordics: ["NOR", "SWE", "FIN", "DNK", "ISL"],
};
function Picker({ value, countries, index, onChange, onRemove, removable }) {
  const [search, setSearch] = useState("");
  const options = countries
    .filter(
      (row) =>
        row.iso === value ||
        [row.name, row.iso, row.region?.name, row.incomeLevel?.name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="compare-pick">
      <div className="compare-label">
        <label className="compare-label-head" htmlFor={`pick-${index}`}>
          Entry {index + 1}
        </label>
        <input
          type="search"
          className="compare-pick-search"
          placeholder="Search entries"
          aria-label={`Search entry ${index + 1}`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          id={`pick-${index}`}
          className="compare-select"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">— Select —</option>
          {options.map((row) => (
            <option key={row.iso} value={row.iso}>
              {row.name}
            </option>
          ))}
        </select>
      </div>
      {removable && (
        <button
          className="compare-remove"
          aria-label={`Remove entry ${index + 1}`}
          onClick={onRemove}
        >
          ✕
        </button>
      )}
    </div>
  );
}

export default function Compare() {
  const [params, update] = useQuery();
  const [slotState, setSlotState] = useState(null);
  const [pickerVersion, setPickerVersion] = useState(0);
  const year = readYear(params),
    leaderboard = useDataset("leaderboard"),
    history = useDataset("series");
  const datasets = [leaderboard, history],
    countries = leaderboard.data?.countries ?? [],
    series = history.data?.entrySeries ?? {};
  const picks = (params.get("picks") ?? "")
    .split(",")
    .map((iso) => iso.trim().toUpperCase())
    .filter(Boolean);
  const pickQuery = picks.join(",");
  const slots =
    slotState?.query === pickQuery
      ? slotState.values
      : picks.length
        ? picks
        : [""];
  const setPicks = (next) => {
    const values = next.length ? next : [""];
    const query = values.filter(Boolean).join(",");
    setSlotState({ query, values });
    update({ picks: query });
  };
  const snapshots = rowsForYear(countries, series, year),
    ranked = sortedRows(snapshots).filter((row) =>
      Number.isFinite(row.customIndex),
    );
  const selected = picks
    .map((iso) => snapshots.find((row) => row.iso === iso))
    .filter(Boolean);
  const duplicate = new Set(picks).size !== picks.length;
  const qualityFor = (row) =>
    dataQualityForRow(row, series, leaderboard.data?.qualityByIso);
  const chartSeries = picks.map((iso) => ({
    iso,
    name: countries.find((row) => row.iso === iso)?.name ?? iso,
    points: series[iso]?.points ?? [],
  }));
  function preset(label) {
    setPickerVersion((value) => value + 1);
    const real = sortedRows(
      snapshots.filter(
        (row) => !row.derivedKind && Number.isFinite(row.customIndex),
      ),
    );
    const next =
      PRESETS[label] ??
      (label === "Top 5" ? real.slice(0, 5) : real.slice(-5).reverse()).map(
        (row) => row.iso,
      );
    setPicks(next.filter((iso) => countries.some((row) => row.iso === iso)));
  }
  return (
    <>
      <Header title="Compare countries" />
      <DataStatus datasets={datasets} />
      <main className="compare-panel compare-panel-page">
        <div className="compare-toolbar">
          <YearControl
            id="compare-year-slider"
            year={year}
            onChange={(value) =>
              update({ year: value === YEAR_MAX ? null : value })
            }
          />
          <fieldset className="filter-chips compare-presets">
            <legend className="control-label">Quick add</legend>
            <div className="chips">
              {[...Object.keys(PRESETS), "Top 5", "Bottom 5"].map((label) => (
                <button
                  className="chip compare-preset-chip"
                  key={label}
                  onClick={() => preset(label)}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="compare-selected-chips" aria-label="Selected entries">
          {slots.map(
            (iso, index) =>
              iso && (
                <button
                  className="chip compare-selected-chip"
                  key={`${iso}-${index}`}
                  onClick={() => setPicks(slots.filter((_, i) => i !== index))}
                >
                  {countries.find((row) => row.iso === iso)?.name ?? iso}{" "}
                  <span aria-hidden="true">×</span>
                </button>
              ),
          )}
        </div>
        <div
          className="compare-picks"
          role="group"
          aria-label="Countries to compare"
        >
          {slots.map((iso, index) => (
            <Picker
              key={`${pickerVersion}-${index}-${iso}`}
              value={iso}
              index={index}
              countries={countries}
              removable={slots.length > 1}
              onChange={(value) =>
                setPicks(slots.map((old, i) => (i === index ? value : old)))
              }
              onRemove={() => setPicks(slots.filter((_, i) => i !== index))}
            />
          ))}
        </div>
        <div className="compare-actions">
          <button
            className="btn primary"
            onClick={() => setPicks([...slots, ""])}
          >
            + Add country
          </button>
          <button
            className="btn"
            onClick={() => {
              setPickerVersion((value) => value + 1);
              setPicks([""]);
            }}
          >
            Clear
          </button>
        </div>
        {datasets.every((dataset) => dataset.data) && (
          <div className="compare-out">
            {duplicate ? (
              <p className="compare-hint">
                Duplicate entry selected—pick different entries in each slot.
              </p>
            ) : !selected.length ? (
              <p className="compare-hint">Pick an entry to begin.</p>
            ) : (
              <>
                <p className="compare-summary muted">
                  Comparing {selected.length}{" "}
                  {selected.length === 1 ? "entry" : "entries"} at{" "}
                  <strong>{year}</strong>.
                </p>
                <div className="compare-table-wrap">
                  <table
                    className={`compare-table${selected.length === 1 ? " compare-single" : ""}`}
                  >
                    <thead>
                      <tr>
                        <th scope="col">Metric</th>
                        {selected.map((row, i) => (
                          <th scope="col" key={row.iso}>
                            <Link
                              href={`/entry?iso=${row.iso}`}
                              className="compare-head-name"
                            >
                              {row.name}
                            </Link>
                            <QualityBadge quality={qualityFor(row)} />
                            <span
                              className="compare-head-swatch"
                              style={{
                                "--series-color":
                                  SERIES_COLORS[i % SERIES_COLORS.length],
                              }}
                            />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row">Leaderboard rank</th>
                        {selected.map((row) => {
                          const rank = ranked.findIndex(
                            (item) => item.iso === row.iso,
                          );
                          return (
                            <td key={row.iso}>{rank < 0 ? "—" : rank + 1}</td>
                          );
                        })}
                      </tr>
                      {columns.map((column) => {
                        const values = selected
                          .map((row) => column.value(row))
                          .filter(Number.isFinite);
                        const best = values.length
                          ? column.lower
                            ? Math.min(...values)
                            : Math.max(...values)
                          : NaN;
                        return (
                          <tr
                            key={column.key}
                            className={
                              column.key === "tomer" ? "tomer-row" : undefined
                            }
                          >
                            <th scope="row">{column.label}</th>
                            {selected.map((row) => (
                              <td
                                key={row.iso}
                                className={
                                  selected.length > 1 &&
                                  column.value(row) === best
                                    ? "compare-best"
                                    : undefined
                                }
                              >
                                <MetricCell
                                  row={row}
                                  column={column}
                                  year={year}
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                      <tr className="pillar-bars-row">
                        <th scope="row">Pillar mix</th>
                        {selected.map((row) => (
                          <td key={row.iso}>
                            <PillarBars row={row} />
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <section className="compare-series">
                  <div className="compare-series-head">
                    <h2 className="compare-series-title">Charts over time</h2>
                    <p className="compare-series-sub muted">
                      Annual history for the selected entries, using the same
                      points as each entry page.
                    </p>
                  </div>
                  <div className="compare-series-grid">
                    {metricDefs.map((metric) => (
                      <HistoryChart
                        key={metric.key}
                        series={chartSeries}
                        metric={metric}
                        year={year}
                        onYearChange={(value) =>
                          update({ year: value === YEAR_MAX ? null : value })
                        }
                      />
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        )}
      </main>
    </>
  );
}
