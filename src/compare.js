import { escapeHtml, formatInt } from "./format.js";
<<<<<<< Updated upstream
import {
  formatTomer,
  formatTomerAxis,
  onScaleChange,
  renderScaleControl,
} from "./index-scale.js";
import {
  combinedHealthLei,
  incomeIndexFromGni,
  safetyIndexFromHomicidesPer100k,
} from "./hdi-core.js";
=======
import { dataQualityBadgeHtml, dataQualityForRow } from "./data-quality.js";
>>>>>>> Stashed changes

const $picks = document.getElementById("compare-picks");
const $btnAdd = document.getElementById("btn-add");
const $btnClear = document.getElementById("btn-clear");
const $compareOut = document.getElementById("compare-out");
const $status = document.getElementById("status");
const $scaleControl = document.getElementById("scale-control");
const $yearSlider = document.getElementById("compare-year-slider");
const $yearOutput = document.getElementById("compare-year-output");
const $presetChips = document.getElementById("compare-preset-chips");

const YEAR_MIN = 2000;
const YEAR_MAX = 2023;

let cache = [];
let entrySeries = {};
/** Currently picked ISO3 codes (ordered), `""` for empty pickers. */
let selections = [""];
let slotSeq = 0;
let year = YEAR_MAX;

const PRESETS = [
  { id: "g7", label: "G7", isos: ["USA", "GBR", "FRA", "DEU", "ITA", "JPN", "CAN"] },
  { id: "brics", label: "BRICS", isos: ["BRA", "RUS", "IND", "CHN", "ZAF"] },
  { id: "nordics", label: "Nordics", isos: ["NOR", "SWE", "FIN", "DNK", "ISL"] },
  { id: "top5", label: "Top 5", isos: null },
  { id: "bottom5", label: "Bottom 5", isos: null },
];

const compareMetricDefs = [
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

const compareSeriesColors = [
  "#6ee7b7",
  "#60a5fa",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
  "#fb7185",
  "#22d3ee",
  "#c084fc",
];

function rankForCountry(iso) {
  const i = cache.findIndex((c) => c.iso === iso);
  return i < 0 ? "—" : String(i + 1);
}

/**
 * Returns a row-shaped snapshot of `iso` at the currently picked year.
 * For year=YEAR_MAX we use the latest leaderboard row (so the rank field
 * stays accurate); for any other year we read entrySeries[iso].points.
 */
function snapshotForYear(iso) {
  const base = cache.find((c) => c.iso === iso);
  if (!base) return null;
  if (year === YEAR_MAX) return base;
  const point = entrySeries[iso]?.points?.find((p) => p.year === year);
  if (!point) return null;
  return {
    ...base,
    le: point.le,
    leYear: point.leYear,
    hale: point.hale,
    haleYear: point.haleYear,
    gni: point.gni,
    gniYear: point.gniYear,
    homicidesPer100k: point.homicidesPer100k,
    homicideYear: point.homicideYear,
    customIndex: point.customIndex,
  };
}

function pillarValues(row) {
  const health =
    typeof row.le === "number" && typeof row.hale === "number"
      ? combinedHealthLei(row.le, row.hale)
      : NaN;
  const income =
    typeof row.gni === "number" && Number.isFinite(row.gni)
      ? incomeIndexFromGni(row.gni)
      : NaN;
  const safety =
    typeof row.homicidesPer100k === "number" && Number.isFinite(row.homicidesPer100k)
      ? safetyIndexFromHomicidesPer100k(row.homicidesPer100k)
      : NaN;
  return { health, income, safety };
}

function pillarBarsHtml(row) {
  const { health, income, safety } = pillarValues(row);
  const bar = (label, v, accent) =>
    Number.isFinite(v)
      ? `<div class="pillar-bar"><span class="pillar-bar-label">${label}</span>
           <span class="pillar-bar-track"><span class="pillar-bar-fill" style="width:${(
             v * 100
           ).toFixed(1)}%; background:${accent};"></span></span>
           <span class="pillar-bar-value">${(v * 100).toFixed(0)}</span></div>`
      : `<div class="pillar-bar"><span class="pillar-bar-label">${label}</span>
           <span class="pillar-bar-track"></span>
           <span class="pillar-bar-value muted">—</span></div>`;
  return `
    <div class="pillar-bars">
      ${bar("Health", health, "#6ee7b7")}
      ${bar("Income", income, "#fbbf24")}
      ${bar("Safety", safety, "#f472b6")}
    </div>
  `;
}

function sortedOptionsHtml() {
  const sorted = [...cache].sort((a, b) => a.name.localeCompare(b.name));
  return [
    `<option value="">— Select —</option>`,
    ...sorted.map(
      (r) => `<option value="${r.iso}">${escapeHtml(optionLabel(r))}</option>`
    ),
  ].join("");
}

function optionLabel(row) {
  const quality = dataQualityForRow(row, entrySeries);
  return quality ? `${row.name} (${quality.label.toLowerCase()})` : row.name;
}

function qualityForIso(iso) {
  const row = cache.find((r) => r.iso === iso);
  return row ? dataQualityForRow(row, entrySeries) : null;
}

function createDataQualityBadge(quality) {
  const badge = document.createElement("span");
  badge.className = "data-quality-badge";
  badge.textContent = quality.label;
  badge.title = quality.description;
  badge.setAttribute("aria-label", quality.description);
  return badge;
}

function updatePickDataLabels() {
  $picks.querySelectorAll(".compare-pick").forEach((wrap) => {
    const label = wrap.querySelector(".compare-label");
    const select = wrap.querySelector("select.compare-select");
    label?.querySelector(".data-quality-badge")?.remove();
    const quality = qualityForIso(select?.value ?? "");
    if (label && quality) label.appendChild(createDataQualityBadge(quality));
  });
}

/** Keep `selections` aligned with the pickers in the DOM (order = columns). */
function syncSelectionsFromDom() {
  const selects = $picks.querySelectorAll("select.compare-select");
  selections = Array.from(selects, (el) => el.value);
}

function refreshCompare() {
  syncSelectionsFromDom();
  updatePickDataLabels();
  renderCompareOut();
}

function compactNumber(n) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function metricValue(row, key) {
  const v = row?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : NaN;
}

function sourceYearText(point, metric) {
  const sourceYear = metric.sourceYearKey ? point?.[metric.sourceYearKey] : null;
  return typeof sourceYear === "number" && sourceYear !== point.year
    ? `Source year ${sourceYear}`
    : "";
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

function renderPicks() {
  const options = sortedOptionsHtml();
  $picks.replaceChildren();

  selections.forEach((iso, i) => {
    const id = `compare-pick-${slotSeq++}`;
    const wrap = document.createElement("div");
    wrap.className = "compare-pick";

    const label = document.createElement("label");
    label.className = "compare-label";
    label.setAttribute("for", id);
    label.textContent = `Entry ${i + 1}`;

    const select = document.createElement("select");
    select.className = "compare-select";
    select.id = id;
    select.innerHTML = options;
    select.value = iso;

    label.appendChild(select);
    wrap.appendChild(label);

    if (selections.length > 1) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "compare-remove";
      remove.setAttribute("aria-label", `Remove entry ${i + 1}`);
      remove.textContent = "✕";
      remove.addEventListener("click", () => {
        selections.splice(i, 1);
        renderPicks();
        refreshCompare();
      });
      wrap.appendChild(remove);
    }

    $picks.appendChild(wrap);
  });

  updatePickDataLabels();
}

$picks.addEventListener("change", (e) => {
  if (!(e.target instanceof HTMLSelectElement) || !e.target.matches(".compare-select"))
    return;
  refreshCompare();
});

$picks.addEventListener("input", (e) => {
  if (!(e.target instanceof HTMLSelectElement) || !e.target.matches(".compare-select"))
    return;
  refreshCompare();
});

/** Which columns have the best value (ties all get green). `lower` = rank, homicides. */
function bestCols(nums, lower) {
  const ok = nums
    .map((n, i) => (Number.isFinite(n) ? { i, n } : null))
    .filter(Boolean);
  if (!ok.length) return new Set();
  const edge = lower
    ? Math.min(...ok.map((x) => x.n))
    : Math.max(...ok.map((x) => x.n));
  return new Set(ok.filter((x) => x.n === edge).map((x) => x.i));
}

function renderCompareOut() {
  const filled = selections
    .map((iso) => (iso ? snapshotForYear(iso) : null))
    .filter((x) => x != null);

  if (!filled.length) {
    $compareOut.innerHTML =
      '<p class="compare-hint">Pick an entry to begin.</p>';
    return;
  }

  if (hasDuplicateIsos(selections)) {
    $compareOut.innerHTML =
      '<p class="compare-hint">Duplicate entry selected—pick different entries in each slot.</p>';
    return;
  }

  const num = (v, digits = 1) =>
    typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";
  const intOrDash = (v) =>
    typeof v === "number" && Number.isFinite(v) ? formatInt(v) : "—";

  const rankNums = filled.map((r) => {
    const i = cache.findIndex((c) => c.iso === r.iso);
    return i < 0 ? NaN : i + 1;
  });
  const healthVals = filled.map((r) => pillarValues(r).health);
  const bestRank = bestCols(rankNums, true);
  const bestLe = bestCols(filled.map((r) => r.le), false);
  const bestHale = bestCols(filled.map((r) => r.hale), false);
  const bestHealth = bestCols(healthVals, false);
  const bestGni = bestCols(filled.map((r) => r.gni), false);
  const bestHom = bestCols(filled.map((r) => r.homicidesPer100k), true);
  const bestTomer = bestCols(
    filled.map((r) => r.customIndex ?? r.customHdi),
    false
  );

  const multi = filled.length >= 2;
  const green = (cols) => (multi ? cols : new Set());

  const headCells = filled
    .map(
<<<<<<< Updated upstream
      (r, i) =>
        `<th scope="col">
          <span class="compare-head-name">${escapeHtml(r.name)}</span>
          <span class="compare-head-swatch" style="--series-color: ${
            compareSeriesColors[i % compareSeriesColors.length]
          }"></span>
        </th>`
=======
      (r) =>
        `<th scope="col"><span class="compare-country-heading">${escapeHtml(
          r.name
        )}</span>${dataQualityBadgeHtml(dataQualityForRow(r, entrySeries))}</th>`
>>>>>>> Stashed changes
    )
    .join("");

  const row = (label, texts, cols) => `
    <tr>
      <th scope="row">${label}</th>
      ${texts
        .map((v, i) => {
          const cls = cols.has(i) ? ' class="compare-best"' : "";
          return `<td${cls}>${v}</td>`;
        })
        .join("")}
    </tr>
  `;

  const tableClass =
    filled.length === 1 ? "compare-table compare-single" : "compare-table";

  $compareOut.innerHTML = `
    <div class="compare-summary muted">Comparing ${filled.length} ${
      filled.length === 1 ? "entry" : "entries"
    } at <strong>${year}</strong>.</div>
    <div class="compare-table-wrap">
      <table class="${tableClass}">
        <thead>
          <tr>
            <th scope="col">Metric</th>
            ${headCells}
          </tr>
        </thead>
        <tbody>
          ${row(
            "Leaderboard rank",
            filled.map((r) => rankForCountry(r.iso)),
            green(bestRank)
          )}
          ${row(
            "Life exp. (years)",
            filled.map((r) => num(r.le, 1)),
            green(bestLe)
          )}
          ${row(
            "HALE (years)",
            filled.map((r) => num(r.hale, 1)),
            green(bestHale)
          )}
          ${row(
            "Health pillar",
            healthVals.map((v) => (Number.isFinite(v) ? formatTomer(v) : "—")),
            green(bestHealth)
          )}
          ${row(
            "GNI pc (PPP)",
            filled.map((r) => intOrDash(r.gni)),
            green(bestGni)
          )}
          ${row(
            "Homicides /100k",
            filled.map((r) => num(r.homicidesPer100k, 1)),
            green(bestHom)
          )}
          ${row(
            "Tomer index",
            filled.map((r) => formatTomer(r.customIndex ?? r.customHdi ?? 0)),
            green(bestTomer)
          )}
          <tr class="pillar-bars-row">
            <th scope="row">Pillar mix</th>
            ${filled.map((r) => `<td>${pillarBarsHtml(r)}</td>`).join("")}
          </tr>
        </tbody>
      </table>
    </div>
    <section class="compare-series" aria-labelledby="compare-series-heading">
      <div class="compare-series-head">
        <h2 id="compare-series-heading" class="compare-series-title">Charts over time</h2>
        <p class="compare-series-sub muted">Annual history for the selected entries, using the same points as each entry page.</p>
      </div>
      <div id="compare-series-grid" class="compare-series-grid"></div>
    </section>
  `;
  renderCompareCharts(filled);
}

function seriesForMetric(selected, metric) {
  return selected
    .map((serie) => ({
      ...serie,
      points: serie.points
        .filter((point) => Number.isFinite(metricValue(point, metric.key)))
        .sort((a, b) => a.year - b.year),
    }))
    .filter((serie) => serie.points.length);
}

function compareLegendHtml(series) {
  return series
    .map(
      (serie) => `
        <span class="compare-series-legend-item">
          <i class="compare-series-swatch" style="--series-color: ${serie.color}"></i>
          ${escapeHtml(serie.row.name)}
        </span>
      `
    )
    .join("");
}

function renderCompareCharts(filled) {
  const grid = document.getElementById("compare-series-grid");
  if (!grid) return;

  const selected = filled.map((row, i) => {
    const points = entrySeries?.[row.iso]?.points;
    return {
      row,
      color: compareSeriesColors[i % compareSeriesColors.length],
      points: Array.isArray(points) ? points : [],
    };
  });

  if (!selected.some((serie) => serie.points.length)) {
    grid.innerHTML =
      '<p class="compare-hint">No over-time history is available for the current selection.</p>';
    return;
  }

  grid.replaceChildren();
  for (const metric of compareMetricDefs) {
    const plotted = seriesForMetric(selected, metric);
    const years = plotted.flatMap((serie) => serie.points.map((point) => point.year));
    const rangeText = years.length
      ? `${Math.min(...years)}-${Math.max(...years)} / ${plotted.length} series`
      : "";
    const card = document.createElement("section");
    const id = `compare-metric-${metric.key}`;
    card.className = "compare-series-card";
    card.setAttribute("aria-labelledby", id);
    card.innerHTML = `
      <div class="compare-series-card-head">
        <h3 id="${id}" class="metric-title">${escapeHtml(metric.label)}</h3>
        <p class="metric-latest muted">${escapeHtml(rangeText)}</p>
      </div>
      ${
        plotted.length
          ? `<div class="compare-series-legend" aria-label="Chart legend">${compareLegendHtml(plotted)}</div>`
          : ""
      }
    `;
    renderCompareMetricChart(card, plotted, metric);
    grid.appendChild(card);
  }
}

function renderCompareMetricChart(card, plotted, metric) {
  if (!plotted.length) {
    const empty = document.createElement("p");
    empty.className = "compare-hint";
    empty.textContent = `No ${metric.label} history for the current selection.`;
    card.appendChild(empty);
    return;
  }

  const allPoints = plotted.flatMap((serie) => serie.points);
  const allYears = [...new Set(allPoints.map((point) => point.year))].sort(
    (a, b) => a - b
  );
  const values = allPoints.map((point) => metricValue(point, metric.key));
  const valLo = Math.min(...values);
  const valHi = Math.max(...values);
  const padV = (valHi - valLo) * 0.08 || Math.max(Math.abs(valHi) * 0.02, 0.02);
  const rawY0 = valLo - padV;
  const y0 = values.every((value) => value >= 0) ? Math.max(0, rawY0) : rawY0;
  const y1 = valHi + padV;
  const yearLo = Math.min(...allYears);
  const yearHi = Math.max(...allYears);

  const w = 720;
  const h = 260;
  const padL = 58;
  const padR = 24;
  const padT = 18;
  const padB = 44;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const xAt = (year) => padL + ((year - yearLo) / (yearHi - yearLo || 1)) * innerW;
  const yAt = (value) => padT + innerH - ((value - y0) / (y1 - y0 || 1)) * innerH;

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("class", "compare-series-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${metric.label} history comparison`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

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

  for (const serie of plotted) {
    const d = serie.points
      .map((point, i) => {
        const x = xAt(point.year);
        const y = yAt(metricValue(point, metric.key));
        return `${i === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    path.setAttribute("class", "compare-series-line");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", serie.color);
    svg.appendChild(path);

    for (const point of [serie.points[0], serie.points[serie.points.length - 1]]) {
      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute("cx", String(xAt(point.year)));
      dot.setAttribute("cy", String(yAt(metricValue(point, metric.key))));
      dot.setAttribute("r", point === serie.points[serie.points.length - 1] ? "4" : "3");
      dot.setAttribute("class", "compare-series-dot");
      dot.setAttribute("fill", serie.color);
      svg.appendChild(dot);
    }
  }

  const chart = document.createElement("div");
  chart.className = "compare-series-chart";

  const hoverLine = document.createElementNS(ns, "line");
  hoverLine.setAttribute("y1", String(padT));
  hoverLine.setAttribute("y2", String(padT + innerH));
  hoverLine.setAttribute("class", "compare-series-hover-line");
  hoverLine.style.display = "none";
  svg.appendChild(hoverLine);

  const pointsByIso = new Map(
    plotted.map((serie) => [
      serie.row.iso,
      new Map(serie.points.map((point) => [point.year, point])),
    ])
  );
  const hoverDots = new Map();
  for (const serie of plotted) {
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("r", "4.5");
    dot.setAttribute("class", "compare-series-hover-dot");
    dot.setAttribute("fill", serie.color);
    dot.style.display = "none";
    hoverDots.set(serie.row.iso, dot);
    svg.appendChild(dot);
  }

  const hit = document.createElementNS(ns, "rect");
  hit.setAttribute("x", String(padL));
  hit.setAttribute("y", String(padT));
  hit.setAttribute("width", String(innerW));
  hit.setAttribute("height", String(innerH));
  hit.setAttribute("class", "metric-chart-hit");
  svg.appendChild(hit);

  const tooltip = document.createElement("div");
  tooltip.className = "metric-tooltip compare-series-tooltip";
  tooltip.hidden = true;
  tooltip.setAttribute("role", "status");
  chart.appendChild(tooltip);

  function showYear(year) {
    document.querySelectorAll(".compare-series-tooltip").forEach((el) => {
      if (el !== tooltip) el.hidden = true;
    });
    document.querySelectorAll(".compare-series-hover-line").forEach((el) => {
      if (el !== hoverLine) el.style.display = "none";
    });
    document.querySelectorAll(".compare-series-hover-dot").forEach((el) => {
      el.style.display = "none";
    });

    const x = xAt(year);
    let topY = padT + innerH;
    const rows = [];
    for (const serie of plotted) {
      const point = pointsByIso.get(serie.row.iso)?.get(year);
      const dot = hoverDots.get(serie.row.iso);
      if (!point || !dot) continue;

      const value = metricValue(point, metric.key);
      const y = yAt(value);
      topY = Math.min(topY, y);
      dot.style.display = "";
      dot.setAttribute("cx", String(xAt(point.year)));
      dot.setAttribute("cy", String(y));

      const source = sourceYearText(point, metric);
      rows.push(`
        <div class="compare-series-tooltip-row">
          <span class="compare-series-tooltip-name">
            <i class="compare-series-swatch" style="--series-color: ${serie.color}"></i>
            ${escapeHtml(serie.row.name)}
          </span>
          <span class="compare-series-tooltip-value">${escapeHtml(metric.value(value))}</span>
          ${source ? `<small>${escapeHtml(source)}</small>` : ""}
        </div>
      `);
    }

    if (!rows.length) return;

    hoverLine.style.display = "";
    hoverLine.setAttribute("x1", String(x));
    hoverLine.setAttribute("x2", String(x));
    tooltip.innerHTML = `
      <strong>${year}</strong>
      <div class="compare-series-tooltip-list">${rows.join("")}</div>
    `;
    tooltip.hidden = false;

    const chartRect = chart.getBoundingClientRect();
    const screenPoint = svgToClientPoint(svg, x, topY);
    const left = Math.max(92, Math.min(screenPoint.x - chartRect.left, chartRect.width - 92));
    const top = Math.max(36, screenPoint.y - chartRect.top);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hidePoint() {
    hoverLine.style.display = "none";
    hoverDots.forEach((dot) => {
      dot.style.display = "none";
    });
    tooltip.hidden = true;
  }

  svg.addEventListener("pointermove", (e) => {
    const svgPoint = clientToSvgPoint(svg, e.clientX, e.clientY);
    const clampedX = Math.max(padL, Math.min(svgPoint.x, padL + innerW));
    const yearAtPointer =
      yearLo + ((clampedX - padL) / innerW) * (yearHi - yearLo || 1);
    let closest = allYears[0];
    let best = Infinity;
    for (const year of allYears) {
      const delta = Math.abs(year - yearAtPointer);
      if (delta < best) {
        closest = year;
        best = delta;
      }
    }
    showYear(closest);
  });

  svg.addEventListener("pointerleave", hidePoint);
  svg.addEventListener("blur", hidePoint);

  chart.appendChild(svg);
  card.appendChild(chart);
}

function hasDuplicateIsos(list) {
  const seen = new Set();
  for (const iso of list) {
    if (!iso) continue;
    if (seen.has(iso)) return true;
    seen.add(iso);
  }
  return false;
}

$btnAdd.addEventListener("click", () => {
  selections.push("");
  renderPicks();
  refreshCompare();
  const selects = $picks.querySelectorAll("select.compare-select");
  selects[selects.length - 1]?.focus();
});

$btnClear?.addEventListener("click", () => {
  selections = [""];
  renderPicks();
  refreshCompare();
});

$yearSlider?.addEventListener("input", (e) => {
  year = Math.max(YEAR_MIN, Math.min(YEAR_MAX, parseInt(e.target.value, 10) || YEAR_MAX));
  if ($yearOutput) $yearOutput.textContent = String(year);
  refreshCompare();
});

function presetIsos(preset) {
  if (preset.isos) {
    return preset.isos.filter((iso) => cache.find((c) => c.iso === iso));
  }
  if (preset.id === "top5" || preset.id === "bottom5") {
    const real = cache.filter((r) => !r.derivedKind);
    if (preset.id === "top5") return real.slice(0, 5).map((r) => r.iso);
    return real.slice(-5).reverse().map((r) => r.iso);
  }
  return [];
}

function applyPreset(preset) {
  const isos = presetIsos(preset);
  if (!isos.length) return;
  selections = isos;
  renderPicks();
  refreshCompare();
}

function renderPresetChips() {
  if (!$presetChips) return;
  $presetChips.innerHTML = PRESETS.map(
    (p) =>
      `<button type="button" class="chip compare-preset-chip" data-preset="${p.id}">${escapeHtml(p.label)}</button>`
  ).join("");
  $presetChips.querySelectorAll(".compare-preset-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = PRESETS.find((p) => p.id === btn.dataset.preset);
      if (preset) applyPreset(preset);
    });
  });
}

async function load() {
  const res = await fetch(
    `${import.meta.env.BASE_URL}data/countries.json?v=${__DATA_VERSION__}`,
    { cache: "no-cache" }
  );
  if (!res.ok) {
    throw new Error(
      `Missing public/data/countries.json (${res.status}). Run: npm run build-data`
    );
  }
  const payload = await res.json();
  cache = payload.countries ?? [];
  entrySeries = payload.entrySeries ?? {};
  $status.textContent = cache.length ? "" : "No countries in data file.";
  renderPresetChips();
  renderPicks();
  refreshCompare();
}

renderScaleControl($scaleControl);
onScaleChange(() => {
  renderCompareOut();
});

load().catch((e) => {
  console.error(e);
  $status.textContent = e instanceof Error ? e.message : "Could not load data.";
  $status.classList.add("error");
});
