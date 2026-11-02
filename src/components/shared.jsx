"use client";
import { useEffect, useId } from "react";
import {
  normalizedWeightPoints,
  DEFAULT_WEIGHT_POINTS,
  WEIGHT_KEYS,
} from "../index-weights.js";
import { YEAR_MAX, YEAR_MIN } from "../site-years.js";
import { sourceBadge } from "../source-years.js";
import { TOPIC_COLORS } from "../topic-colors.js";

const PILLAR_NAMES = {
  health: "Health",
  safety: "Safety",
  freedom: "Freedom",
  abundance: "Abundance",
};

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
/** Loading and load-failure state for a page's datasets; Retry reloads every failed one. */
export function DataStatus({ datasets }) {
  const failed = datasets.filter((dataset) => dataset.error);
  const errors = failed.map((dataset) => dataset.error).join("\n");
  useEffect(() => {
    if (errors) console.error(`Tomer index data failed to load:\n${errors}`);
  }, [errors]);
  if (failed.length)
    return (
      <div role="alert" className="status error">
        Couldn't load the data. Check your connection and try again.{" "}
        <button
          className="btn"
          onClick={() => failed.forEach((dataset) => dataset.retry())}
        >
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
      <span className="year-control-row">
        <span className="year-control-bound" aria-hidden="true">
          {YEAR_MIN}
        </span>
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
        <span className="year-control-bound" aria-hidden="true">
          {YEAR_MAX}
        </span>
      </span>
      {/* The slider already announces its value; this is the visible readout. */}
      <output className="year-output" htmlFor={id} aria-hidden="true">
        {year}
      </output>
    </label>
  );
}
/** A 0–1 share as a percentage with at most one decimal: 0.4 -> "40", 0.3636 -> "36.4". */
function percent(share) {
  return String(Math.round(share * 1000) / 10);
}
export function Weights({ weights, onChange, label }) {
  const id = useId();
  const effective = normalizedWeightPoints(weights);
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  return (
    <fieldset className="index-weight-controls">
      <legend className="control-label">{label} weights</legend>
      <div className="index-weight-grid">
        {WEIGHT_KEYS.map((key) => {
          const share = percent(effective[key]);
          return (
            <div
              className="index-weight"
              key={key}
              style={{ "--topic-color": TOPIC_COLORS[key] }}
            >
              <span className="index-weight-head">
                <label htmlFor={`${id}-${key}`}>{PILLAR_NAMES[key]}</label>
                <span className="index-weight-value" aria-hidden="true">
                  {share}%
                </span>
              </span>
              <input
                id={`${id}-${key}`}
                type="range"
                min="0"
                max="100"
                step="1"
                value={weights[key]}
                aria-valuetext={`${share} percent`}
                onChange={(event) =>
                  onChange({ ...weights, [key]: Number(event.target.value) })
                }
              />
            </div>
          );
        })}
      </div>
      <div className="index-weight-footer">
        <span className="muted">
          {total
            ? "Weights are rescaled to total 100%."
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

// [data-tip] tooltips are CSS ::after boxes. One set of document listeners places
// them inside the viewport (position: fixed, so table scroll boxes can't clip them)
// and lets Escape dismiss the open one until the pointer or focus leaves.
function placeTip(tip) {
  const rect = tip.getBoundingClientRect();
  const width = window.innerWidth,
    height = window.innerHeight;
  const center = rect.left + rect.width / 2;
  tip.dataset.tipX =
    center < width / 3 ? "start" : center > (width * 2) / 3 ? "end" : "center";
  tip.dataset.tipY =
    rect.bottom > height - 140 && rect.top > 140 ? "above" : "below";
  tip.style.setProperty("--tip-left", `${Math.max(8, rect.left)}px`);
  tip.style.setProperty("--tip-center", `${center}px`);
  tip.style.setProperty("--tip-right", `${Math.max(8, width - rect.right)}px`);
  tip.style.setProperty("--tip-top", `${rect.bottom + 6}px`);
  tip.style.setProperty("--tip-bottom", `${height - rect.top + 6}px`);
}
function openTips() {
  try {
    return [...document.querySelectorAll("[data-tip]:hover, [data-tip]:focus")];
  } catch {
    return [];
  }
}
if (typeof document !== "undefined") {
  const place = (event) => {
    const tip = event.target?.closest?.("[data-tip]");
    if (tip) placeTip(tip);
  };
  document.addEventListener("pointerover", place);
  document.addEventListener("focusin", place);
  let frame = 0;
  document.addEventListener(
    "scroll",
    () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        openTips().forEach(placeTip);
      });
    },
    { capture: true, passive: true },
  );
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const tip of openTips()) {
      tip.setAttribute("data-tip-dismissed", "");
      const reset = () => tip.removeAttribute("data-tip-dismissed");
      tip.addEventListener("pointerleave", reset, { once: true });
      tip.addEventListener("blur", reset, { once: true });
    }
  });
}

/** A focusable badge whose tooltip text is also its accessible description. */
function TipBadge({ className, tip, children }) {
  const id = useId();
  return (
    <span
      className={className}
      tabIndex={0}
      data-tip={tip}
      aria-describedby={id}
    >
      {children}
      <span id={id} hidden>
        {tip}
      </span>
    </span>
  );
}
export function QualityBadge({ quality }) {
  return quality ? (
    <TipBadge className="data-quality-badge" tip={quality.description}>
      {quality.label}
    </TipBadge>
  ) : null;
}
/**
 * Source years for one value; the wording rules live in source-years.js. Compact
 * badges sit in every leaderboard cell, so they stay out of the Tab order: mouse
 * users get the hover tooltip and screen readers read the full description.
 */
export function SourceBadge({ row, sources, year, compact = false }) {
  const badge = sourceBadge(row, sources, year, { compact });
  if (!badge) return null;
  const className = `source-year-badge${badge.current ? " is-current" : ""}${badge.stale ? " is-stale" : ""}`;
  if (!compact)
    return (
      <TipBadge className={className} tip={badge.description}>
        {badge.text}
      </TipBadge>
    );
  return (
    <span className={className} data-tip={badge.description}>
      <span aria-hidden="true">{badge.text}</span>
      <span className="visually-hidden">{badge.description}</span>
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
// A pillar past its goalpost (income above $75,000, say) scores over 100; its bar stays full.
export function PillarBars({ row }) {
  return (
    <div className="pillar-bars">
      {WEIGHT_KEYS.map((key) => {
        const value = row[`${key}Index`];
        const known = Number.isFinite(value);
        return (
          <div className="pillar-bar" key={key}>
            <span className="pillar-bar-label">{PILLAR_NAMES[key]}</span>
            <span className="pillar-bar-track" aria-hidden="true">
              <span
                className="pillar-bar-fill"
                style={{
                  width: `${known ? Math.min(value, 1) * 100 : 0}%`,
                  background: TOPIC_COLORS[key],
                }}
              />
            </span>
            <span className="pillar-bar-value">
              {known ? (
                (value * 100).toFixed(0)
              ) : (
                <>
                  <span aria-hidden="true">—</span>
                  <span className="visually-hidden">no data</span>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
