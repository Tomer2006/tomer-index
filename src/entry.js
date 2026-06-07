import { escapeHtml, formatInt } from "./format.js";
import {
  formatTomer,
  formatTomerAxis,
  onScaleChange,
  renderScaleControl,
} from "./index-scale.js";
import { dataQualityBadgeHtml, dataQualityForRow } from "./data-quality.js";
import { loadLeaderboardData, loadSeriesData } from "./data-loader.js";
import { sourceYearBadgeHtml } from "./source-years.js";
import { YEAR_MAX } from "./site-years.js";

const $title = document.getElementById("entry-title");
const $kicker = document.getElementById("entry-kicker");
const $sub = document.getElementById("entry-sub");
const $status = document.getElementById("status");
const $latest = document.getElementById("entry-latest");
const $seriesDef = document.getElementById("entry-series-def");
const $charts = document.getElementById("entry-charts");
const $scaleControl = document.getElementById("scale-control");

const params = new URLSearchParams(window.location.search);
const iso = params.get("iso")?.trim() ?? "";

const state = { row: null, rank: "", series: null };

const metricDefs = [
  {
    key: "customIndex",
    label: "Tomer index",
    axis: (v) => formatTomerAxis(v),
    value: (v) => formatTomer(v),
  },
  {
    key: "le",
    sourceYearKey: "leYear",
    label: "Life expectancy",
    axis: (v) => v.toFixed(0),
    value: (v) => `${v.toFixed(1)} years`,
  },
  {
    key: "hale",
    sourceYearKey: "haleYear",
    label: "HALE",
    axis: (v) => v.toFixed(0),
    value: (v) => `${v.toFixed(1)} years`,
  },
  {
    key: "gni",
    sourceYearKey: "gniYear",
    label: "GNI pc (PPP)",
    axis: (v) => compactNumber(v),
    value: (v) => formatInt(v),
  },
  {
    key: "homicidesPer100k",
    sourceYearKey: "homicideYear",
    label: "Homicides /100k",
    axis: (v) => v.toFixed(1),
    value: (v) => v.toFixed(2),
  },
];

function compactNumber(n) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function setStatus(msg, isError = false) {
  $status.textContent = msg;
  $status.classList.toggle("error", isError);
}

function metricValue(row, key) {
  const v = row?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : NaN;
}

function latestNumericPoint(points, key) {
  for (let i = points.length - 1; i >= 0; i--) {
    if (Number.isFinite(metricValue(points[i], key))) return points[i];
  }
  return null;
}

function clientToSvgPoint(svg, clientX, clientY) {
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  return point.matrixTransform(matrix.inverse());
}

function svgToClientPoint(svg, x, y) {
  const point = svg.createSVGPoint();
  point.x = x;
  point.y = y;
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  return point.matrixTransform(matrix);
}

function sourceYearText(point, metric) {
  const sourceYear = metric.sourceYearKey ? point?.[metric.sourceYearKey] : null;
  return typeof sourceYear === "number" && sourceYear !== point.year
    ? `Source year ${sourceYear}`
    : "";
}

function renderLatest(row, rank, series) {
  const h =
    typeof row.homicidesPer100k === "number" && !Number.isNaN(row.homicidesPer100k)
      ? row.homicidesPer100k.toFixed(1)
      : "-";
  const hale =
    typeof row.hale === "number" && !Number.isNaN(row.hale) ? row.hale.toFixed(1) : "-";
  const idx = row.customIndex ?? row.customHdi ?? 0;
  const latest = series.points[series.points.length - 1];
  const latestBits = latest
    ? [
        `Series through ${latest.year}`,
        typeof latest.n === "number" ? `${latest.n} members` : "",
        typeof latest.population === "number" ? `pop. ${latest.population.toLocaleString()}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  $latest.innerHTML = `
    <section class="entry-summary" aria-labelledby="latest-heading">
      <div>
        <h2 id="latest-heading" class="entry-summary-title">Latest leaderboard values</h2>
        <p class="entry-summary-sub muted">${escapeHtml(latestBits)}</p>
      </div>
      <div class="entry-stats" role="list">
        ${statHtml("Rank", rank)}
        ${statHtml("Life exp.", row.le.toFixed(1), sourceYearBadgeHtml(row, "leYear", YEAR_MAX))}
        ${statHtml("HALE", hale, sourceYearBadgeHtml(row, "haleYear", YEAR_MAX))}
        ${statHtml("GNI pc", formatInt(row.gni), sourceYearBadgeHtml(row, "gniYear", YEAR_MAX))}
        ${statHtml("Homicides", h, sourceYearBadgeHtml(row, "homicideYear", YEAR_MAX))}
        ${statHtml(
          "Tomer",
          formatTomer(idx),
          sourceYearBadgeHtml(row, ["leYear", "haleYear", "gniYear", "homicideYear"], YEAR_MAX)
        )}
      </div>
    </section>
  `;
}

function statHtml(label, value, badge = "") {
  return `
    <div class="entry-stat" role="listitem">
      <span class="entry-stat-label">${escapeHtml(label)}${badge}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderMetricChart(card, points, metric) {
  const series = points
    .filter((p) => Number.isFinite(metricValue(p, metric.key)))
    .sort((a, b) => a.year - b.year);
  if (!series.length) {
    card.innerHTML = `<p class="compare-hint">No ${escapeHtml(metric.label)} history.</p>`;
    return;
  }

  const first = series[0];
  const last = series[series.length - 1];
  const values = series.map((p) => metricValue(p, metric.key));
  const valLo = Math.min(...values);
  const valHi = Math.max(...values);
  const padV = (valHi - valLo) * 0.08 || Math.max(Math.abs(valHi) * 0.02, 0.02);
  const y0 = valLo - padV;
  const y1 = valHi + padV;
  const yearLo = first.year;
  const yearHi = last.year;

  const w = 720;
  const h = 245;
  const padL = 58;
  const padR = 24;
  const padT = 18;
  const padB = 42;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const xAt = (year) => padL + ((year - yearLo) / (yearHi - yearLo || 1)) * innerW;
  const yAt = (value) => padT + innerH - ((value - y0) / (y1 - y0 || 1)) * innerH;
  const d = series
    .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(p.year)},${yAt(metricValue(p, metric.key))}`)
    .join(" ");

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("class", "metric-chart-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${metric.label} from ${first.year} to ${last.year}`);

  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const value = y0 + (1 - t) * (y1 - y0);
    const gy = padT + t * innerH;
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", String(padL));
    line.setAttribute("x2", String(padL + innerW));
    line.setAttribute("y1", String(gy));
    line.setAttribute("y2", String(gy));
    line.setAttribute("class", "global-series-grid");
    svg.appendChild(line);

    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", String(padL - 8));
    label.setAttribute("y", String(gy + 4));
    label.setAttribute("text-anchor", "end");
    label.setAttribute("class", "global-series-axis");
    label.textContent = metric.axis(value);
    svg.appendChild(label);
  }

  for (let i = 0; i <= 2; i++) {
    const t = i / 2;
    const year = Math.round(yearLo + t * (yearHi - yearLo));
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", String(xAt(year)));
    label.setAttribute("y", String(h - 12));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("class", "global-series-axis");
    label.textContent = String(year);
    svg.appendChild(label);
  }

  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  path.setAttribute("class", "global-series-line");
  path.setAttribute("fill", "none");
  svg.appendChild(path);

  for (const p of [first, last]) {
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", String(xAt(p.year)));
    dot.setAttribute("cy", String(yAt(metricValue(p, metric.key))));
    dot.setAttribute("r", p === last ? "4" : "3");
    dot.setAttribute("class", p === last ? "global-series-dot" : "global-series-dot global-series-dot-start");
    svg.appendChild(dot);
  }

  const chart = document.createElement("div");
  chart.className = "metric-chart";

  const hoverLine = document.createElementNS(ns, "line");
  hoverLine.setAttribute("y1", String(padT));
  hoverLine.setAttribute("y2", String(padT + innerH));
  hoverLine.setAttribute("class", "metric-hover-line");
  hoverLine.style.display = "none";
  svg.appendChild(hoverLine);

  const hoverDot = document.createElementNS(ns, "circle");
  hoverDot.setAttribute("r", "4.5");
  hoverDot.setAttribute("class", "metric-hover-dot");
  hoverDot.style.display = "none";
  svg.appendChild(hoverDot);

  const hit = document.createElementNS(ns, "rect");
  hit.setAttribute("x", String(padL));
  hit.setAttribute("y", String(padT));
  hit.setAttribute("width", String(innerW));
  hit.setAttribute("height", String(innerH));
  hit.setAttribute("class", "metric-chart-hit");
  svg.appendChild(hit);

  const tooltip = document.createElement("div");
  tooltip.className = "metric-tooltip";
  tooltip.hidden = true;
  tooltip.setAttribute("role", "status");
  chart.appendChild(tooltip);

  function showPoint(point) {
    document.querySelectorAll(".metric-tooltip").forEach((el) => {
      if (el !== tooltip) el.hidden = true;
    });
    document.querySelectorAll(".metric-hover-line, .metric-hover-dot").forEach((el) => {
      if (el !== hoverLine && el !== hoverDot) el.style.display = "none";
    });

    const value = metricValue(point, metric.key);
    const x = xAt(point.year);
    const y = yAt(value);
    hoverLine.style.display = "";
    hoverDot.style.display = "";
    hoverLine.setAttribute("x1", String(x));
    hoverLine.setAttribute("x2", String(x));
    hoverDot.setAttribute("cx", String(x));
    hoverDot.setAttribute("cy", String(y));

    const source = sourceYearText(point, metric);
    tooltip.innerHTML = `
      <strong>${point.year}</strong>
      <span>${escapeHtml(metric.label)}: ${escapeHtml(metric.value(value))}</span>
      ${source ? `<small>${escapeHtml(source)}</small>` : ""}
    `;
    tooltip.hidden = false;

    const chartRect = chart.getBoundingClientRect();
    const screenPoint = svgToClientPoint(svg, x, y);
    const left = Math.max(72, Math.min(screenPoint.x - chartRect.left, chartRect.width - 72));
    const top = Math.max(28, screenPoint.y - chartRect.top);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hidePoint() {
    hoverLine.style.display = "none";
    hoverDot.style.display = "none";
    tooltip.hidden = true;
  }

  svg.addEventListener("pointermove", (e) => {
    const svgPoint = clientToSvgPoint(svg, e.clientX, e.clientY);
    const clampedX = Math.max(padL, Math.min(svgPoint.x, padL + innerW));
    const yearAtPointer = yearLo + ((clampedX - padL) / innerW) * (yearHi - yearLo || 1);
    let closest = series[0];
    let best = Infinity;
    for (const point of series) {
      const delta = Math.abs(point.year - yearAtPointer);
      if (delta < best) {
        closest = point;
        best = delta;
      }
    }
    showPoint(closest);
  });

  svg.addEventListener("pointerleave", hidePoint);
  svg.addEventListener("blur", hidePoint);

  chart.appendChild(svg);
  card.appendChild(chart);
}

function renderCharts(series) {
  $charts.replaceChildren();
  for (const metric of metricDefs) {
    const latest = latestNumericPoint(series.points, metric.key);
    const first = series.points.find((p) => Number.isFinite(metricValue(p, metric.key)));
    const card = document.createElement("section");
    card.className = "metric-card";
    card.setAttribute("aria-labelledby", `metric-${metric.key}`);
    card.innerHTML = `
      <div class="metric-card-head">
        <h2 id="metric-${metric.key}" class="metric-title">${escapeHtml(metric.label)}</h2>
        <p class="metric-latest muted">${
          first && latest
            ? `${first.year} ${escapeHtml(metric.value(metricValue(first, metric.key)))} -> ${latest.year} ${escapeHtml(metric.value(metricValue(latest, metric.key)))}`
            : ""
        }</p>
      </div>
    `;
    renderMetricChart(card, series.points, metric);
    $charts.appendChild(card);
  }
}

async function load() {
  if (!iso) {
    throw new Error("Missing entry id.");
  }
  const [leaderboardPayload, seriesPayload] = await Promise.all([
    loadLeaderboardData(),
    loadSeriesData(),
  ]);
  const countries = leaderboardPayload.countries ?? [];
  const row = countries.find((r) => r.iso === iso);
  if (!row) throw new Error(`No leaderboard entry found for ${iso}.`);

  const series = seriesPayload.entrySeries?.[iso];
  if (!series?.points?.length) {
    throw new Error(`No history stored for ${row.name}. Run: npm run build-data`);
  }
  const rank = String(countries.findIndex((r) => r.iso === iso) + 1);
  const quality = dataQualityForRow(
    row,
    seriesPayload.entrySeries ?? {},
    leaderboardPayload.qualityByIso ?? {}
  );
  document.title = `${row.name} history - Tomer index`;
  $title.innerHTML = `${escapeHtml(row.name)}${dataQualityBadgeHtml(quality)}`;
  $kicker.textContent = row.derivedKind ? `${row.derivedKind} history` : `${row.iso} history`;
  if ($sub) $sub.textContent = "";
  if ($seriesDef) $seriesDef.textContent = "";
  setStatus("");
  state.row = row;
  state.rank = rank;
  state.series = series;
  renderLatest(row, rank, series);
  renderCharts(series);
}

renderScaleControl($scaleControl);
onScaleChange(() => {
  if (state.row && state.series) {
    renderLatest(state.row, state.rank, state.series);
    renderCharts(state.series);
  }
});

load().catch((e) => {
  console.error(e);
  $title.textContent = "Entry history";
  setStatus(e instanceof Error ? e.message : "Could not load entry history.", true);
});
