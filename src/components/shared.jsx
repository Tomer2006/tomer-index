"use client";
import {
  normalizedWeightPoints,
  DEFAULT_WEIGHT_POINTS,
} from "../index-weights.js";
import { YEAR_MAX, YEAR_MIN } from "../site-years.js";
import { sourceYearParts } from "../source-years.js";

export function Header({ title, kicker = "Tomer index", children }) {
  return (
    <header className="hero">
      <div className="hero-row">
        <div className="hero-titles">
          <p className="kicker">{kicker}</p>
          <h1>{title}</h1>
          {children}
        </div>
      </div>
    </header>
  );
}
export function DataStatus({ datasets }) {
  const failed = datasets.find((dataset) => dataset.error);
  if (failed)
    return (
      <div role="alert" className="status error">
        {failed.error}{" "}
        <button className="btn" onClick={failed.retry}>
          Retry
        </button>
      </div>
    );
  if (datasets.some((dataset) => !dataset.data))
    return (
      <p role="status" className="status flex items-center gap-3">
        <span className="page-loader-mark" aria-hidden="true" />
        Loading data…
      </p>
    );
  return null;
}
export function YearControl({ year, onChange, id = "year-slider" }) {
  return (
    <label className="year-control">
      <span className="control-label">Year</span>
      <input
        type="range"
        id={id}
        aria-label="Year"
        min={YEAR_MIN}
        max={YEAR_MAX}
        step="1"
        value={year}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output className="year-output" htmlFor={id}>
        {year}
      </output>
    </label>
  );
}
export function Weights({ weights, onChange, label }) {
  const effective = normalizedWeightPoints(weights);
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  return (
    <fieldset className="index-weight-controls">
      <legend className="control-label">{label} weights</legend>
      <div className="index-weight-grid">
        {Object.entries(weights).map(([key, value]) => (
          <label key={key}>
            <span className="capitalize">
              {key} <output>{(effective[key] * 100).toFixed(1)}%</output>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={value}
              aria-label={`${key[0].toUpperCase()}${key.slice(1)} weight`}
              onChange={(event) =>
                onChange({ ...weights, [key]: Number(event.target.value) })
              }
            />
          </label>
        ))}
      </div>
      <div className="index-weight-footer">
        <span className="muted">
          {total
            ? `Normalized to 100% from ${total} slider points`
            : "All-zero selection uses the default weights"}
        </span>
        <button
          className="btn"
          onClick={() => onChange({ ...DEFAULT_WEIGHT_POINTS })}
        >
          Reset weights
        </button>
      </div>
    </fieldset>
  );
}
export function QualityBadge({ quality }) {
  return quality ? (
    <span
      className="data-quality-badge"
      tabIndex={0}
      data-tip={quality.description}
      aria-label={quality.description}
    >
      {quality.label}
    </span>
  ) : null;
}
export function SourceBadge({ row, sources, year, compact = false }) {
  const parts = sourceYearParts(row, sources, compact ? undefined : year);
  if (!parts.length && !row.derivedKind) return null;
  const years = [
    ...new Set(parts.map((part) => part.year).filter(Number.isFinite)),
  ];
  const mixed = !parts.length || parts.some((part) => part.year === null);
  const text =
    !compact && parts.length
      ? parts.map((part) => `${part.label} ${part.value}`).join(", ")
      : mixed
        ? "mixed"
        : years.length === 1
          ? years[0]
          : `${Math.min(...years)}–${Math.max(...years)}`;
  const tip = parts.length
    ? `Source years: ${parts.map((part) => `${part.label} ${part.value}`).join(", ")}`
    : "Source years: mixed (population-weighted aggregate of member countries)";
  return (
    <span
      className={`source-year-badge${!mixed && years.length === 1 && years[0] === year ? " is-current" : ""}`}
      tabIndex={0}
      data-tip={tip}
      aria-label={tip}
    >
      {text}
    </span>
  );
}
export function MetricCell({ row, column, year, weights, compact = false }) {
  return (
    <span className="metric-cell">
      <span className="metric-cell-value">
        {column.format(column.value(row, weights))}
      </span>
      <SourceBadge
        row={row}
        sources={column.sources}
        year={year}
        compact={compact}
      />
    </span>
  );
}
export function PillarBars({ row }) {
  return (
    <div className="pillar-bars">
      {[
        ["Abundance", "#fbbf24"],
        ["Safety", "#f472b6"],
        ["Health", "#6ee7b7"],
        ["Freedom", "#60a5fa"],
      ].map(([label, color]) => {
        const value = row[`${label.toLowerCase()}Index`];
        return (
          <div className="pillar-bar" key={label}>
            <span className="pillar-bar-label">{label}</span>
            <span className="pillar-bar-track">
              <span
                className="pillar-bar-fill"
                style={{
                  width: `${Number.isFinite(value) ? value * 100 : 0}%`,
                  background: color,
                }}
              />
            </span>
            <span className="pillar-bar-value">
              {Number.isFinite(value) ? (value * 100).toFixed(0) : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
