import { escapeHtml, formatInt } from "./format.js";
import { formatTomer } from "./index-scale.js";
import { dataQualityBadgeHtml, dataQualityForRow } from "./data-quality.js";
import { loadLeaderboardData, loadSeriesData } from "./data-loader.js";
import { sourceYearBadgeHtml } from "./source-years.js";
import { YEAR_MAX } from "./site-years.js";
import { finishInitialLoad } from "./page-ready.js";
import { metricDefs, metricValue } from "./metric-defs.js";
import {
  bindPointerYear,
  chartFrame,
  createTooltip,
  hitRectEl,
  hoverDotEl,
  hoverLineEl,
  linePath,
  nearestByYear,
  positionTooltip,
  svgEl,
} from "./line-chart.js";

const $title = document.getElementById("entry-title");
const $kicker = document.getElementById("entry-kicker");
const $sub = document.getElementById("entry-sub");
const $status = document.getElementById("status");
const $latest = document.getElementById("entry-latest");
const $seriesDef = document.getElementById("entry-series-def");
const $charts = document.getElementById("entry-charts");

const params = new URLSearchParams(window.location.search);
const iso = params.get("iso")?.trim() ?? "";

const state = { row: null, rank: "", series: null };

function setStatus(msg, isError = false) {
  $status.textContent = msg;
  $status.classList.toggle("error", isError);
}

function latestNumericPoint(points, key) {
  for (let i = points.length - 1; i >= 0; i--) {
    if (Number.isFinite(metricValue(points[i], key))) return points[i];
  }
  return null;
}

function sourceYearText(point, metric) {
  const sourceYear = metric.sourceYearKey ? point?.[metric.sourceYearKey] : null;
  if (metric.key === "hale" && point?.haleEstimated) {
    return typeof sourceYear === "number"
      ? `Estimated from life expectancy; latest reported HALE is ${sourceYear}`
      : "Estimated from life expectancy";
  }
  if (metric.key === "gni" && point?.incomeSource === "GDP") {
    return typeof sourceYear === "number" ? `GDP fallback, source year ${sourceYear}` : "GDP fallback";
  }
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
        ${statHtml("Income pc", formatInt(row.gni), sourceYearBadgeHtml(row, "gniYear", YEAR_MAX))}
        ${statHtml("Homicides", h, sourceYearBadgeHtml(row, "homicideYear", YEAR_MAX))}
        ${statHtml("Tomer", formatTomer(idx))}
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

  const { svg, xAt, yAt, innerW, innerH, padL, padT } = chartFrame({
    w: 720,
    h: 245,
    padL: 58,
    padR: 24,
    padT: 18,
    padB: 42,
    y0: valLo - padV,
    y1: valHi + padV,
    yearLo: first.year,
    yearHi: last.year,
    yLabel: metric.axis,
    className: "metric-chart-svg",
    ariaLabel: `${metric.label} from ${first.year} to ${last.year}`,
  });

  const path = svgEl("path", {
    d: linePath(series, xAt, yAt, (p) => p.year, (p) => metricValue(p, metric.key)),
    class: "global-series-line",
    fill: "none",
  });
  svg.appendChild(path);

  for (const p of [first, last]) {
    svg.appendChild(
      svgEl("circle", {
        cx: xAt(p.year),
        cy: yAt(metricValue(p, metric.key)),
        r: p === last ? "4" : "3",
        class: p === last ? "global-series-dot" : "global-series-dot global-series-dot-start",
      })
    );
  }

  const chart = document.createElement("div");
  chart.className = "metric-chart";

  const hoverLine = hoverLineEl(svg, padT, innerH);
  const hoverDot = hoverDotEl(svg);
  hitRectEl(svg, padL, padT, innerW, innerH);
  const tooltip = createTooltip(chart);

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
    positionTooltip(tooltip, chart, svg, x, y);
  }

  function hidePoint() {
    hoverLine.style.display = "none";
    hoverDot.style.display = "none";
    tooltip.hidden = true;
  }

  bindPointerYear(
    svg,
    { padL, innerW, yearLo: first.year, yearHi: last.year },
    {
      onMove: (year) => showPoint(nearestByYear(series, year)),
      onLeave: hidePoint,
    }
  );

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

load()
  .catch((e) => {
    console.error(e);
    $title.textContent = "Entry history";
    setStatus(e instanceof Error ? e.message : "Could not load entry history.", true);
  })
  .finally(finishInitialLoad);
