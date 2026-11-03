"use client";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { metricSourceKeys } from "../metric-defs.js";
import { sourceYearSummary } from "../source-years.js";
import { YEAR_MIN, YEAR_MAX } from "../site-years.js";

/**
 * Line colors for multi-series charts, assigned in this fixed order. They stay clear
 * of the four topic colors and the Tomer purple (OKLab ΔE ≥ 14), keep ≥ 3.3:1 contrast
 * on the card background, and stay apart under protan/deutan simulation for
 * neighboring slots (and for every pair among the first four).
 */
export const SERIES_COLORS = [
  "#e2e8f0",
  "#f97316",
  "#0d9488",
  "#c026d3",
  "#dc2626",
  "#84cc16",
  "#2563eb",
  "#78716c",
];

const SPAN = YEAR_MAX - YEAR_MIN;
const DEFAULT_WIDTH = 400;
// The chart is laid out in CSS pixels (viewBox = rendered size), so 11px axis text
// stays 11px; the y-label gutter is sized from the 11px monospace advance.
const CHAR_WIDTH = 6.8;
const PAD = { top: 10, right: 16, bottom: 26 };
// A touch that moves less than this (CSS px) before lifting is a tap.
const TAP_SLOP = 10;

/**
 * "Nice" y-axis ticks: a step of 1, 2, 2.5 or 5 × 10^n, about `count` intervals,
 * never below `min` (0 by default: only the Tomer index goes negative) or above `max`.
 */
export function niceTicks(low, high, { count = 4, min = 0, max = Infinity } = {}) {
  let lo = Math.max(min, low),
    hi = Math.min(max, high);
  if (!(hi > lo)) {
    const pad = Math.abs(hi) * 0.05 || 1;
    lo = Math.max(min, lo - pad);
    hi = Math.min(max, hi + pad);
  }
  const raw = (hi - lo) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].find((unit) => unit * power >= raw * (1 - 1e-9)) *
    power;
  const first = Math.max(min, Math.floor(lo / step + 1e-9) * step);
  const last = Math.min(max, Math.ceil(hi / step - 1e-9) * step);
  const ticks = [];
  for (let i = 0; first + i * step <= last + step * 1e-6; i++)
    ticks.push(Number((first + i * step).toPrecision(12)));
  return { ticks, step };
}

/** Year labels every 5 years, or every 10 when the plot is too narrow for them. */
export function yearTicks(plotWidth) {
  const step = (plotWidth / SPAN) * 5 >= 34 ? 5 : 10;
  const ticks = [];
  for (
    let value = Math.ceil(YEAR_MIN / step) * step;
    value <= YEAR_MAX;
    value += step
  )
    ticks.push(value);
  return ticks;
}

function linePath(points, key, x, y) {
  let drawing = false;
  return points
    .map((point) => {
      if (!Number.isFinite(point[key])) {
        drawing = false;
        return "";
      }
      const command = drawing ? "L" : "M";
      drawing = true;
      return `${command}${x(point.year).toFixed(1)},${y(point[key]).toFixed(1)}`;
    })
    .join(" ");
}

export default function HistoryChart({
  series,
  metric,
  year = YEAR_MAX,
  onYearChange,
  showMarkers = series.length > 1,
}) {
  const id = useId();
  const frame = useRef(null);
  const pointerType = useRef("mouse");
  // The touch or pen press in progress: { x, y, scrub }, or null once it turns
  // into a vertical page scroll.
  const press = useRef(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  // { baseYear, value, announce }: the year inspected while the page shows baseYear.
  const [inspect, setInspect] = useState(null);
  const multi = series.length > 1;
  const lines = series.map((item, i) => ({
    ...item,
    color: multi
      ? SERIES_COLORS[i % SERIES_COLORS.length]
      : (metric.color ?? SERIES_COLORS[0]),
    points: [...item.points].sort((a, b) => a.year - b.year),
  }));
  const values = lines.flatMap((line) =>
    line.points.map((point) => point[metric.key]).filter(Number.isFinite),
  );
  const hasData = values.length > 0;
  useLayoutEffect(() => {
    const node = frame.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const next = Math.round(node.clientWidth);
      if (next > 0) setWidth(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasData]);
  if (!hasData)
    return (
      <section className="metric-card">
        <h2 className="metric-title">{metric.label}</h2>
        <p className="muted">No history available.</p>
      </section>
    );

  const { ticks, step } = niceTicks(Math.min(...values), Math.max(...values), {
    min: metric.min,
    max: metric.max,
  });
  const labels = ticks.map((value) => metric.axis(value, step));
  const left =
    Math.ceil(Math.max(...labels.map((label) => label.length)) * CHAR_WIDTH) + 12;
  const height = Math.round(
    Math.min(240, Math.max(multi ? 190 : 160, width * 0.5)),
  );
  const plotWidth = Math.max(40, width - left - PAD.right),
    plotHeight = height - PAD.top - PAD.bottom;
  const low = ticks[0],
    high = ticks.at(-1);
  const x = (value) => left + ((value - YEAR_MIN) / SPAN) * plotWidth;
  const y = (value) => PAD.top + ((high - value) / (high - low)) * plotHeight;

  const inspecting = inspect?.baseYear === year ? inspect : null;
  const activeYear = inspecting?.value ?? year;
  const clampYear = (value) => Math.max(YEAR_MIN, Math.min(YEAR_MAX, value));
  function yearAt(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = rect.width
      ? ((event.clientX - rect.left) * width) / rect.width
      : event.clientX;
    return clampYear(Math.round(YEAR_MIN + ((px - left) / plotWidth) * SPAN));
  }
  function show(value, announce) {
    if (inspecting?.value === value && inspecting.announce === announce) return;
    setInspect({ baseYear: year, value, announce });
  }

  const sourceKeys = metricSourceKeys(metric);
  const readings = lines.map((line) => {
    const point = line.points.find((point) => point.year === activeYear);
    const value = point?.[metric.key];
    return {
      line,
      known: Number.isFinite(value),
      text: Number.isFinite(value) ? metric.value(value) : "—",
      sources: point ? sourceYearSummary(point, sourceKeys, activeYear) : "",
    };
  });
  // Only keyboard and touch inspection speak; hover and the year slider stay quiet.
  const announcement = inspecting?.announce
    ? `${activeYear}: ${readings
        .map(
          (reading) =>
            `${multi ? `${reading.line.name} ` : ""}${reading.known ? reading.text : "no data"}`,
        )
        .join(", ")}`
    : "";
  const summary = lines
    .map((line) => {
      const known = line.points.filter((point) =>
        Number.isFinite(point[metric.key]),
      );
      if (!known.length) return `${line.name}: no data`;
      const [first, last] = [known[0], known.at(-1)].map(
        (point) => `${metric.value(point[metric.key])} in ${point.year}`,
      );
      return `${line.name}: ${first}, ${last}`;
    })
    .join("; ");
  const hint = onYearChange
    ? "Use the left and right arrow keys to change the year."
    : "Use the left and right arrow keys to inspect a year.";
  const single = lines[0].points.filter((point) =>
    Number.isFinite(point[metric.key]),
  );
  const markers = showMarkers || Boolean(inspecting);

  return (
    <section className="metric-card">
      <div className="metric-card-head">
        <h2 className="metric-title">
          {metric.label}
          {metric.context && (
            <span className="metric-direction">Not in the index</span>
          )}
          {metric.lowerIsBetter && (
            <span className="metric-direction">↓ Lower is better</span>
          )}
        </h2>
        {!multi && (
          <p className="metric-latest muted">
            {single[0].year} {metric.value(single[0][metric.key])} →{" "}
            {single.at(-1).year} {metric.value(single.at(-1)[metric.key])}
          </p>
        )}
      </div>
      {multi && (
        <div className="compare-series-legend">
          {lines.map((line, i) => (
            <span className="compare-series-legend-item" key={`${line.iso}-${i}`}>
              <i
                className="compare-series-swatch"
                aria-hidden="true"
                style={{ "--series-color": line.color }}
              />
              {line.name}
            </span>
          ))}
        </div>
      )}
      <div className="metric-chart" ref={frame}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="metric-chart-svg"
          role="img"
          aria-label={`${metric.label}, ${YEAR_MIN}–${YEAR_MAX}`}
          aria-describedby={`${id}-summary`}
          tabIndex={0}
          onPointerDown={(event) => {
            pointerType.current = event.pointerType || "mouse";
            // Touch and pen wait to see a tap or a horizontal drag: a press that
            // starts a vertical page scroll must not inspect anything.
            press.current =
              pointerType.current === "mouse"
                ? null
                : { x: event.clientX, y: event.clientY, scrub: false };
          }}
          onPointerMove={(event) => {
            if (event.pointerType === "mouse")
              return show(yearAt(event), false);
            const gesture = press.current;
            if (!gesture) return;
            if (!gesture.scrub) {
              const dx = Math.abs(event.clientX - gesture.x),
                dy = Math.abs(event.clientY - gesture.y);
              if (Math.max(dx, dy) < TAP_SLOP) return;
              if (dy >= dx) {
                press.current = null;
                return;
              }
              gesture.scrub = true;
            }
            show(yearAt(event), true);
          }}
          onPointerUp={(event) => {
            const gesture = press.current;
            press.current = null;
            if (!gesture || gesture.scrub) return;
            // A tap changes the page year where the chart can, as a click does;
            // otherwise it reads that year.
            if (onYearChange) {
              setInspect(null);
              onYearChange(yearAt(event));
            } else show(yearAt(event), true);
          }}
          // pan-y hands vertical drags to the browser, which cancels the pointer.
          onPointerCancel={() => {
            press.current = null;
            setInspect(null);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") setInspect(null);
          }}
          onBlur={() => setInspect(null)}
          onClick={(event) => {
            if (pointerType.current === "mouse") onYearChange?.(yearAt(event));
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && inspecting) {
              setInspect(null);
              return;
            }
            const next = {
              ArrowLeft: activeYear - 1,
              ArrowRight: activeYear + 1,
              Home: YEAR_MIN,
              End: YEAR_MAX,
            }[event.key];
            if (next === undefined) return;
            event.preventDefault();
            const value = clampYear(next);
            if (onYearChange) {
              // The page year follows; announce once it arrives.
              setInspect({ baseYear: value, value, announce: true });
              onYearChange(value);
            } else show(value, true);
          }}
        >
          <rect
            className="metric-chart-hit"
            x={left}
            y={PAD.top}
            width={plotWidth}
            height={plotHeight}
          />
          {ticks.map((value, i) => (
            <g key={value}>
              <line
                x1={left}
                x2={left + plotWidth}
                y1={y(value)}
                y2={y(value)}
                className="global-series-grid"
              />
              <text
                x={left - 8}
                y={y(value)}
                dy="0.32em"
                textAnchor="end"
                className="global-series-axis"
              >
                {labels[i]}
              </text>
            </g>
          ))}
          {yearTicks(plotWidth).map((value) => (
            <text
              key={value}
              x={x(value)}
              y={height - 8}
              textAnchor="middle"
              className="global-series-axis"
            >
              {value}
            </text>
          ))}
          <line
            x1={x(activeYear)}
            x2={x(activeYear)}
            y1={PAD.top}
            y2={PAD.top + plotHeight}
            className="metric-hover-line"
          />
          {lines.map((line, i) => {
            const current = line.points.find(
              (point) => point.year === activeYear,
            );
            return (
              <g key={`${line.iso}-${i}`}>
                <path
                  d={linePath(line.points, metric.key, x, y)}
                  fill="none"
                  stroke={line.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {markers && Number.isFinite(current?.[metric.key]) && (
                  <circle
                    className="metric-chart-marker"
                    cx={x(activeYear)}
                    cy={y(current[metric.key])}
                    r={4}
                    fill={line.color}
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="metric-chart-readout">
        <strong>{activeYear}</strong>
        {multi ? (
          <ul className="metric-chart-readout-list">
            {readings.map((reading, i) => (
              <li
                key={`${reading.line.iso}-${i}`}
                title={reading.sources || undefined}
              >
                <i
                  className="compare-series-swatch"
                  aria-hidden="true"
                  style={{ "--series-color": reading.line.color }}
                />
                <span className="metric-chart-readout-name">
                  {reading.line.name}
                </span>
                <span className="metric-chart-readout-value">
                  {reading.text}
                </span>
                {reading.sources && (
                  <span className="visually-hidden">
                    {" "}
                    (source years: {reading.sources})
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <>
            <span className="metric-chart-readout-value">
              {readings[0].text}
            </span>
            {readings[0].sources && (
              <span className="metric-chart-readout-sources">
                {readings[0].sources}
              </span>
            )}
          </>
        )}
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      <p id={`${id}-summary`} hidden>
        {summary}. {hint}
      </p>
    </section>
  );
}
