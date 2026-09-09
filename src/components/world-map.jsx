"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { geoEquirectangular, geoPath } from "d3-geo";
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
  columns,
} from "../view-model.js";
import { weightedIndexFromPillars } from "../index-weights.js";
import { formatTomer } from "../index-scale.js";
import { dataQualityForRow } from "../data-quality.js";
import { YEAR_MAX } from "../site-years.js";

const COLORS = [
  "#3b0f70",
  "#5c01a6",
  "#8b0aa5",
  "#b83289",
  "#db5c68",
  "#f48849",
  "#febd2a",
  "#f0f921",
];
const path = geoPath(
  geoEquirectangular()
    .scale(960 / (2 * Math.PI))
    .translate([480, 250]),
);
const quantile = (sorted, probability) => {
  const position = (sorted.length - 1) * probability,
    lower = Math.floor(position);
  return (
    sorted[lower] +
    (position - lower) * ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower])
  );
};

export default function WorldMap() {
  const [params, update] = useQuery();
  const year = readYear(params),
    weights = readWeights(params),
    iso = (params.get("iso") ?? "").trim().toUpperCase();
  const [search, setSearch] = useState(null),
    [hover, setHover] = useState(null);
  const leaderboard = useDataset("leaderboard"),
    history = useDataset("series", year !== YEAR_MAX),
    world = useDataset("world");
  const datasets =
    year === YEAR_MAX ? [leaderboard, world] : [leaderboard, history, world];
  const countries = leaderboard.data?.countries ?? [],
    series = history.data?.entrySeries ?? {};
  const rows = rowsForYear(countries, series, year).filter(
    (row) => !row.derivedKind,
  );
  const byIso = new Map(rows.map((row) => [row.iso, row]));
  const qualityFor = (row) =>
    dataQualityForRow(row, series, leaderboard.data?.qualityByIso);
  const shapes = useMemo(
    () =>
      (world.data?.features ?? [])
        .filter((feature) => feature.id !== "ATA")
        .map((feature, i) => ({
          iso: feature.id,
          name: feature.properties?.name ?? feature.id ?? "Unknown",
          key: `${feature.id}-${i}`,
          d: path(feature),
          center: path.centroid(feature),
        })),
    [world.data],
  );
  const values = rows
    .map((row) => weightedIndexFromPillars(row, weights))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const breaks = COLORS.slice(1).map((_, i) =>
    values.length ? quantile(values, (i + 1) / COLORS.length) : 0,
  );
  const min = values[0] ?? 0,
    max = values.at(-1) ?? 1;
  const color = (row) => {
    const value = weightedIndexFromPillars(row, weights);
    if (!Number.isFinite(value)) return "#2a3142";
    const band = breaks.findIndex((limit) => value <= limit);
    return COLORS[band === -1 ? COLORS.length - 1 : band];
  };
  const selected = byIso.get(iso),
    selectedShape = shapes.find((shape) => shape.iso === iso);
  const select = (value) => {
    update({ iso: value });
    setSearch(null);
  };
  const hovered = hover ? byIso.get(hover.iso) : null;
  return (
    <>
      <Header title="Tomer index by country" kicker="World map" />
      <DataStatus datasets={datasets} />
      <main className="map-page">
        <section className="map-controls" aria-label="Map controls">
          <YearControl
            id="map-year-slider"
            year={year}
            onChange={(value) =>
              update({ year: value === YEAR_MAX ? null : value })
            }
          />
          <label className="search-control map-search-control">
            <span className="control-label">Find a country</span>
            <input
              type="search"
              id="map-search"
              list="map-search-list"
              placeholder="Country or ISO code…"
              autoComplete="off"
              value={search ?? selected?.name ?? selectedShape?.name ?? iso}
              onChange={(event) => {
                const value = event.target.value;
                setSearch(value);
                const row = countries.find(
                  (row) =>
                    !row.derivedKind &&
                    [row.iso.toLowerCase(), row.name.toLowerCase()].includes(
                      value.trim().toLowerCase(),
                    ),
                );
                if (row) select(row.iso);
                else if (!value) select("");
              }}
            />
            <datalist id="map-search-list">
              {countries
                .filter((row) => !row.derivedKind)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((row) => (
                  <option key={row.iso} value={row.name}>
                    {row.iso}
                  </option>
                ))}
            </datalist>
          </label>
          <div className="map-legend" aria-label="Color legend">
            <span className="map-legend-scale">
              <span className="map-legend-label">Lower {formatTomer(min)}</span>
              <span className="map-legend-bar">
                {COLORS.map((value, i) => (
                  <i
                    className="map-legend-stop"
                    key={value}
                    style={{ background: value }}
                    title={`${formatTomer(i === 0 ? min : breaks[i - 1])} to ${formatTomer(i === 7 ? max : breaks[i])}`}
                  />
                ))}
              </span>
              <span className="map-legend-label">
                Higher {formatTomer(max)}
              </span>
            </span>
            <span className="map-legend-note">
              8 relative groups for {year}
            </span>
            <span className="map-legend-key map-legend-key-incomplete">
              Incomplete
            </span>
            <span className="map-legend-key map-legend-key-empty">No data</span>
          </div>
          <Weights
            label="Map"
            weights={weights}
            onChange={(next) => update(weightQuery(next))}
          />
        </section>
        {datasets.every((dataset) => dataset.data) && (
          <>
            <div className="map-wrap">
              <svg
                viewBox="0 0 960 500"
                className="map-svg-root"
                aria-label="Choropleth world map of Tomer index"
                onPointerLeave={() => setHover(null)}
              >
                <rect
                  width="960"
                  height="500"
                  className="map-ocean"
                  onClick={() => select("")}
                />
                {[
                  ...shapes.filter((shape) => shape.iso !== iso),
                  ...shapes.filter((shape) => shape.iso === iso),
                ].map((shape) => {
                  const row = byIso.get(shape.iso),
                    score = weightedIndexFromPillars(row, weights);
                  return (
                    <path
                      key={shape.key}
                      d={shape.d}
                      fill={color(row)}
                      className={`map-country${!Number.isFinite(score) ? " is-no-data" : ""}${qualityFor(row) ? " is-incomplete" : ""}${shape.iso === iso ? " is-selected" : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`${row?.name ?? shape.name}: ${Number.isFinite(score) ? formatTomer(score) : "No data"}`}
                      aria-pressed={shape.iso === iso}
                      onClick={() => select(shape.iso)}
                      onKeyDown={(event) => {
                        if (["Enter", " "].includes(event.key)) {
                          event.preventDefault();
                          select(shape.iso);
                        }
                      }}
                      onPointerMove={(event) => {
                        const rect =
                          event.currentTarget.ownerSVGElement.getBoundingClientRect();
                        setHover({
                          iso: shape.iso,
                          name: shape.name,
                          left: Math.max(
                            8,
                            Math.min(
                              event.clientX - rect.left + 14,
                              rect.width - 240,
                            ),
                          ),
                          top: event.clientY - rect.top + 16,
                        });
                      }}
                    >
                      <title>
                        {row?.name ?? shape.name}: {formatTomer(score)}
                      </title>
                    </path>
                  );
                })}
                {selectedShape?.center.every(Number.isFinite) && (
                  <circle
                    cx={selectedShape.center[0]}
                    cy={selectedShape.center[1]}
                    r={5}
                    className="map-selected-marker"
                    pointerEvents="none"
                  />
                )}
              </svg>
              {hover && (
                <div
                  className="map-tooltip pointer-events-none"
                  style={{ left: hover.left, top: hover.top }}
                >
                  <strong>{hovered?.name ?? hover.name}</strong>
                  <span>
                    Tomer index:{" "}
                    {formatTomer(weightedIndexFromPillars(hovered, weights))}
                  </span>
                  <QualityBadge quality={qualityFor(hovered)} />
                </div>
              )}
            </div>
            <aside className="map-detail-panel" aria-live="polite">
              {!iso ? (
                <p className="map-detail-empty">Select a country on the map.</p>
              ) : !selected ? (
                <p className="map-detail-empty">
                  {selectedShape?.name ?? iso}: no data for {year}.
                </p>
              ) : (
                <>
                  <div className="map-detail-head">
                    <div>
                      <h2 className="map-detail-title">
                        {selected.name}
                        <QualityBadge quality={qualityFor(selected)} />
                      </h2>
                      <p className="map-detail-sub">
                        {selected.region?.name} · {year}
                      </p>
                    </div>
                    <span className="map-detail-pill">
                      Tomer{" "}
                      {formatTomer(weightedIndexFromPillars(selected, weights))}
                    </span>
                  </div>
                  <dl className="map-detail-grid">
                    {columns.slice(0, -1).map((column) => (
                      <div key={column.key}>
                        <dt>{column.label}</dt>
                        <dd>
                          <MetricCell
                            row={selected}
                            column={column}
                            year={year}
                          />
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="map-detail-actions">
                    <Link
                      className="map-detail-link"
                      href={`/entry?iso=${encodeURIComponent(iso)}`}
                    >
                      View history →
                    </Link>
                    <Link
                      className="map-detail-link"
                      href={`/compare?picks=${encodeURIComponent(iso)}&year=${year}`}
                    >
                      Compare country →
                    </Link>
                  </div>
                </>
              )}
            </aside>
          </>
        )}
      </main>
    </>
  );
}
