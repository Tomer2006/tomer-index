import { escapeHtml, formatInt } from "./format.js";
import {
  formatTomer,
  formatTomerAxis,
  onScaleChange,
  renderScaleControl,
} from "./index-scale.js";

const $picks = document.getElementById("compare-picks");
const $btnAdd = document.getElementById("btn-add");
const $compareOut = document.getElementById("compare-out");
const $status = document.getElementById("status");
const $scaleControl = document.getElementById("scale-control");

let cache = [];
let entrySeries = {};
/** Currently picked ISO3 codes (ordered), `""` for empty pickers. */
let selections = [""];
let slotSeq = 0;

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

function sortedOptionsHtml() {
  const sorted = [...cache].sort((a, b) => a.name.localeCompare(b.name));
  return [
    `<option value="">— Select —</option>`,
    ...sorted.map(
      (r) => `<option value="${r.iso}">${escapeHtml(r.name)}</option>`
    ),
  ].join("");
}

/** Keep `selections` aligned with the pickers in the DOM (order = columns). */
function syncSelectionsFromDom() {
  const selects = $picks.querySelectorAll("select.compare-select");
  selections = Array.from(selects, (el) => el.value);
}

function refreshCompare() {
  syncSelectionsFromDom();
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
    .map((iso) => (iso ? cache.find((c) => c.iso === iso) : null))
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

  const hStr = (r) =>
    typeof r.homicidesPer100k === "number" && !Number.isNaN(r.homicidesPer100k)
      ? r.homicidesPer100k.toFixed(1)
      : "—";
  const haleStr = (r) =>
    typeof r.hale === "number" && !Number.isNaN(r.hale)
      ? r.hale.toFixed(1)
      : "—";

  const rankNums = filled.map((r) => {
    const i = cache.findIndex((c) => c.iso === r.iso);
    return i < 0 ? NaN : i + 1;
  });
  const bestRank = bestCols(rankNums, true);
  const bestLe = bestCols(
    filled.map((r) => r.le),
    false
  );
  const bestHale = bestCols(
    filled.map((r) =>
      typeof r.hale === "number" && !Number.isNaN(r.hale) ? r.hale : NaN
    ),
    false
  );
  const bestGni = bestCols(
    filled.map((r) =>
      typeof r.gni === "number" && Number.isFinite(r.gni) ? r.gni : NaN
    ),
    false
  );
  const bestHom = bestCols(
    filled.map((r) =>
      typeof r.homicidesPer100k === "number" && !Number.isNaN(r.homicidesPer100k)
        ? r.homicidesPer100k
        : NaN
    ),
    true
  );
  const bestTomer = bestCols(
    filled.map((r) => {
      const v = r.customIndex ?? r.customHdi;
      return typeof v === "number" && Number.isFinite(v) ? v : NaN;
    }),
    false
  );

  const multi = filled.length >= 2;
  const green = (cols) => (multi ? cols : new Set());

  const headCells = filled
    .map((r) => `<th scope="col">${escapeHtml(r.name)}</th>`)
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
            filled.map((r) => r.le.toFixed(1)),
            green(bestLe)
          )}
          ${row("HALE (years)", filled.map((r) => haleStr(r)), green(bestHale))}
          ${row(
            "GNI pc (PPP)",
            filled.map((r) => formatInt(r.gni)),
            green(bestGni)
          )}
          ${row(
            "Homicides /100k",
            filled.map((r) => hStr(r)),
            green(bestHom)
          )}
          ${row(
            "Tomer index",
            filled.map((r) => formatTomer(r.customIndex ?? r.customHdi ?? 0)),
            green(bestTomer)
          )}
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
