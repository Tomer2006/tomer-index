"use client";
import { useState } from "react";
import { metricSourceKeys } from "../metric-defs.js";
import { sourceYearSummary } from "../source-years.js";
import { YEAR_MIN, YEAR_MAX } from "../site-years.js";

export const SERIES_COLORS = [
  "#6ee7b7",
  "#60a5fa",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
  "#fb7185",
  "#22d3ee",
  "#c084fc",
];
export default function HistoryChart({
  series,
  metric,
  year = YEAR_MAX,
  onYearChange,
  showMarkers = series.length > 1,
}) {
  const [hoverYear, setHoverYear] = useState(null);
  const seriesColor = (index) =>
    series.length === 1
      ? metric.color ?? SERIES_COLORS[0]
      : SERIES_COLORS[index % SERIES_COLORS.length];
  const points = series
    .flatMap((item) => item.points)
    .filter((point) => Number.isFinite(point[metric.key]));
  if (!points.length)
    return (
      <section className="metric-card">
        <h2 className="metric-title">{metric.label}</h2>
        <p className="muted">No history available.</p>
      </section>
    );
  const values = points.map((point) => point[metric.key]);
  const low = Math.min(...values),
    high = Math.max(...values),
    padding = (high - low) * 0.08 || Math.max(Math.abs(high) * 0.02, 0.02);
  const x = (value) => 58 + ((value - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 638;
  const y = (value) =>
    203 - ((value - low + padding) / (high - low + padding * 2)) * 185;
  const activeYear = hoverYear?.baseYear === year ? hoverYear.value : year;
  function pointer(event) {
    const svg = event.currentTarget;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return activeYear;
    const local = point.matrixTransform(matrix.inverse());
    return Math.max(
      YEAR_MIN,
      Math.min(
        YEAR_MAX,
        Math.round(YEAR_MIN + ((local.x - 58) / 638) * (YEAR_MAX - YEAR_MIN)),
      ),
    );
  }
  return (
    <section className="metric-card">
      <div className="metric-card-head">
        <h2 className="metric-title">
          {metric.label}
          {metric.lowerIsBetter && (
            <span className="metric-direction">↓ Lower is better</span>
          )}
        </h2>
        {series.length === 1 && (
          <p className="metric-latest muted">
            {points[0].year} {metric.value(points[0][metric.key])} →{" "}
            {points.at(-1).year} {metric.value(points.at(-1)[metric.key])}
          </p>
        )}
      </div>
      <div className="compare-series-legend">
        {series.map((item, i) => (
          <span className="compare-series-legend-item" key={item.iso}>
            {series.length > 1 && (
              <i
                className="compare-series-swatch"
                style={{ "--series-color": seriesColor(i) }}
              />
            )}
            {item.name}
          </span>
        ))}
      </div>
      <svg
        viewBox="0 0 720 245"
        className="metric-chart-svg"
        role="img"
        aria-label={`${metric.label}, ${YEAR_MIN}–${YEAR_MAX}. Use left and right arrows to inspect a year.`}
        tabIndex={0}
        onPointerMove={(event) =>
          setHoverYear({ baseYear: year, value: pointer(event) })
        }
        onPointerLeave={() => setHoverYear(null)}
        onBlur={() => setHoverYear(null)}
        onClick={(event) => onYearChange?.(pointer(event))}
        onKeyDown={(event) => {
          if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
            event.preventDefault();
            const next = Math.max(
              YEAR_MIN,
              Math.min(
                YEAR_MAX,
                activeYear + (event.key === "ArrowRight" ? 1 : -1),
              ),
            );
            setHoverYear(onYearChange ? null : { baseYear: year, value: next });
            onYearChange?.(next);
          }
        }}
      >
        <rect x={58} y={18} width={638} height={185} fill="transparent" />
        {[0, 1, 2, 3, 4].map((tick) => {
          const value = low - padding + (tick / 4) * (high - low + 2 * padding);
          return (
            <g key={tick}>
              <line
                x1={58}
                x2={696}
                y1={y(value)}
                y2={y(value)}
                className="global-series-grid"
              />
              <text
                x={50}
                y={y(value) + 4}
                textAnchor="end"
                className="global-series-axis"
              >
                {metric.axis(value)}
              </text>
            </g>
          );
        })}
        {[YEAR_MIN, 2012, YEAR_MAX].map((value) => (
          <text
            key={value}
            x={x(value)}
            y={233}
            textAnchor="middle"
            className="global-series-axis"
          >
            {value}
          </text>
        ))}
        <line
          x1={x(activeYear)}
          x2={x(activeYear)}
          y1={18}
          y2={203}
          className="metric-hover-line"
        />
        {series.map((item, i) => {
          let drawing = false;
          const path = [...item.points]
            .sort((a, b) => a.year - b.year)
            .map((point) => {
              if (!Number.isFinite(point[metric.key])) {
                drawing = false;
                return "";
              }
              const command = drawing ? "L" : "M";
              drawing = true;
              return `${command}${x(point.year)},${y(point[metric.key])}`;
            })
            .join(" ");
          const current = item.points.find(
            (point) => point.year === activeYear,
          );
          const color = seriesColor(i);
          return (
            <g key={item.iso}>
              <path d={path} fill="none" stroke={color} strokeWidth={2.5} />
              {showMarkers && Number.isFinite(current?.[metric.key]) && (
                <circle
                  cx={x(activeYear)}
                  cy={y(current[metric.key])}
                  r={4}
                  fill={color}
                />
              )}
            </g>
          );
        })}
      </svg>
      <div className="grid gap-1 text-sm text-muted" aria-live="polite">
        <strong>{activeYear}</strong>
        {series.map((item, i) => {
          const point = item.points.find((point) => point.year === activeYear);
          const value = point?.[metric.key];
          return (
            <div key={item.iso}>
              <span style={{ color: seriesColor(i) }}>
                {item.name}:{" "}
                {Number.isFinite(value) ? metric.value(value) : "—"}
              </span>
              {point && (
                <small className="block">
                  {sourceYearSummary(
                    point,
                    metricSourceKeys(metric),
                    activeYear,
                  )}
                  {metric.key === "hale" && point.haleEstimated
                    ? " · Estimated from life expectancy"
                    : ""}
                </small>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
