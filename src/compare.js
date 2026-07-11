import { escapeHtml, formatInt } from "./format.js";
import { formatTomer } from "./index-scale.js";
import {
  combinedHealthLei,
  incomeIndexFromGni,
  safetyIndexFromHomicidesPer100k,
  freedomIndexFromScore,
} from "./hdi-core.js";
import { dataQualityBadgeHtml, dataQualityForRow } from "./data-quality.js";
import { loadLeaderboardData, loadSeriesData } from "./data-loader.js";
import { sourceYearBadgeHtml, sourceYearSummary } from "./source-years.js";
import { YEAR_MAX, YEAR_MIN } from "./site-years.js";
import { finishInitialLoad } from "./page-ready.js";
import { metricDefs, metricSourceKeys, metricValue } from "./metric-defs.js";
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

const $picks = document.getElementById("compare-picks");
const $btnAdd = document.getElementById("btn-add");
const $btnClear = document.getElementById("btn-clear");
const $compareOut = document.getElementById("compare-out");
const $status = document.getElementById("status");
const $yearSlider = document.getElementById("compare-year-slider");
const $yearOutput = document.getElementById("compare-year-output");
const $presetChips = document.getElementById("compare-preset-chips");
const $selectedChips = document.getElementById("compare-selected-chips");

let cache = [];
let entrySeries = {};
let qualityByIso = {};
/** Currently picked ISO3 codes (ordered), `""` for empty pickers. */
let selections = [""];
let pickSearches = [""];
let slotSeq = 0;
let year = YEAR_MAX;

const PRESETS = [
  { id: "g7", label: "G7", isos: ["USA", "GBR", "FRA", "DEU", "ITA", "JPN", "CAN"] },
  { id: "brics", label: "BRICS", isos: ["BRA", "RUS", "IND", "CHN", "ZAF"] },
  { id: "nordics", label: "Nordics", isos: ["NOR", "SWE", "FIN", "DNK", "ISL"] },
  { id: "top5", label: "Top 5", isos: null },
  { id: "bottom5", label: "Bottom 5", isos: null },
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
    haleEstimated: point.haleEstimated,
    gni: point.gni,
    gniYear: point.gniYear,
    incomeSource: point.incomeSource,
    homicidesPer100k: point.homicidesPer100k,
    homicideYear: point.homicideYear,
    freedom: point.freedom,
    freedomYear: point.freedomYear,
    abundanceIndex: point.abundanceIndex,
    safetyIndex: point.safetyIndex,
    healthIndex: point.healthIndex,
    freedomIndex: point.freedomIndex,
    customIndex: point.customIndex,
  };
}

function indexValue(row) {
  const v = row?.customIndex ?? row?.customHdi;
  return typeof v === "number" && Number.isFinite(v) ? v : NaN;
}

function rankedRowsForYear() {
  return cache
    .map((row) => snapshotForYear(row.iso))
    .filter((row) => row && Number.isFinite(indexValue(row)))
    .sort((a, b) => indexValue(b) - indexValue(a) || a.name.localeCompare(b.name));
}

function rankForCountryInRows(iso, rankedRows) {
  const i = rankedRows.findIndex((row) => row.iso === iso);
  return i < 0 ? "-" : String(i + 1);
}

function pillarValues(row) {
  const health = Number.isFinite(row.healthIndex)
    ? row.healthIndex
    :
    typeof row.le === "number" && typeof row.hale === "number"
      ? combinedHealthLei(row.le, row.hale)
      : NaN;
  const income = Number.isFinite(row.abundanceIndex)
    ? row.abundanceIndex
    :
    typeof row.gni === "number" && Number.isFinite(row.gni)
      ? incomeIndexFromGni(row.gni)
      : NaN;
  const safety = Number.isFinite(row.safetyIndex)
    ? row.safetyIndex
    :
    typeof row.homicidesPer100k === "number" && Number.isFinite(row.homicidesPer100k)
      ? safetyIndexFromHomicidesPer100k(row.homicidesPer100k)
      : NaN;
  const freedom = Number.isFinite(row.freedomIndex)
    ? row.freedomIndex
    :
    typeof row.freedom === "number" && Number.isFinite(row.freedom)
      ? freedomIndexFromScore(row.freedom)
      : NaN;
  return { health, abundance: income, safety, freedom };
}

function pillarBarsHtml(row) {
  const { health, abundance, safety, freedom } = pillarValues(row);
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
      ${bar("Abundance", abundance, "#fbbf24")}
      ${bar("Safety", safety, "#f472b6")}
      ${bar("Health", health, "#6ee7b7")}
      ${bar("Freedom", freedom, "#60a5fa")}
    </div>
  `;
}

function sortedOptionsHtml(query = "") {
  const q = query.trim().toLowerCase();
  const sorted = [...cache]
    .filter((row) => {
      if (!q) return true;
      return [row.name, row.iso, row.region?.name, row.incomeLevel?.name, row.derivedKind]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return [
    `<option value="">— Select —</option>`,
    ...sorted.map(
      (r) => `<option value="${r.iso}">${escapeHtml(optionLabel(r))}</option>`
    ),
  ].join("");
}

function optionLabel(row) {
  const quality = dataQualityForRow(row, entrySeries, qualityByIso);
  return quality ? `${row.name} (${quality.label.toLowerCase()})` : row.name;
}

function qualityForIso(iso) {
  const row = cache.find((r) => r.iso === iso);
  return row ? dataQualityForRow(row, entrySeries, qualityByIso) : null;
}

function createDataQualityBadge(quality) {
  const badge = document.createElement("span");
  badge.className = "data-quality-badge";
  badge.textContent = quality.label;
  badge.tabIndex = 0;
  badge.dataset.tip = quality.description;
  badge.setAttribute("aria-label", quality.description);
  return badge;
}

function updatePickDataLabels() {
  $picks.querySelectorAll(".compare-pick").forEach((wrap) => {
    const label = wrap.querySelector(".compare-label-head");
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
  renderSelectedChips();
  updatePickDataLabels();
  renderCompareOut();
  syncUrl();
}

function sourceYearText(point, metric) {
  const keys = metricSourceKeys(metric);
  const summary = sourceYearSummary(point, keys, point.year);
  if (!summary) return "";
  return `Source ${keys.length === 1 ? "year" : "years"}: ${summary}`;
}

function compareValueHtml(row, metric, text) {
  return `${escapeHtml(text)}${sourceYearBadgeHtml(row, metricSourceKeys(metric), year)}`;
}

function displayYearBadgeHtml(displayYear) {
  const tip = escapeHtml(`Display year: ${displayYear}`);
  return ` <span class="source-year-badge" tabindex="0" data-tip="${tip}" aria-label="${tip}">${escapeHtml(
    String(displayYear)
  )}</span>`;
}

function renderPicks() {
  $picks.replaceChildren();

  selections.forEach((iso, i) => {
    const id = `compare-pick-${slotSeq++}`;
    const wrap = document.createElement("div");
    wrap.className = "compare-pick";

    const label = document.createElement("label");
    label.className = "compare-label";
    label.setAttribute("for", id);

    const labelHead = document.createElement("span");
    labelHead.className = "compare-label-head";
    labelHead.textContent = `Entry ${i + 1}`;

    const search = document.createElement("input");
    search.type = "search";
    search.className = "compare-pick-search";
    search.placeholder = "Search entries";
    search.autocomplete = "off";
    search.value = pickSearches[i] ?? "";

    const select = document.createElement("select");
    select.className = "compare-select";
    select.id = id;
    select.innerHTML = sortedOptionsHtml(search.value);
    if (iso && !select.querySelector(`option[value="${CSS.escape(iso)}"]`)) {
      const row = cache.find((entry) => entry.iso === iso);
      if (row) select.insertAdjacentHTML(
        "beforeend",
        `<option value="${row.iso}">${escapeHtml(optionLabel(row))}</option>`
      );
    }
    select.value = iso;

    search.addEventListener("input", () => {
      pickSearches[i] = search.value;
      const current = select.value;
      select.innerHTML = sortedOptionsHtml(search.value);
      if (current && select.querySelector(`option[value="${CSS.escape(current)}"]`)) {
        select.value = current;
      }
    });

    label.append(labelHead, search, select);
    wrap.appendChild(label);

    if (selections.length > 1) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "compare-remove";
      remove.setAttribute("aria-label", `Remove entry ${i + 1}`);
      remove.textContent = "✕";
      remove.addEventListener("click", () => {
        selections.splice(i, 1);
        pickSearches.splice(i, 1);
        renderPicks();
        refreshCompare();
      });
      wrap.appendChild(remove);
    }

    $picks.appendChild(wrap);
  });

  updatePickDataLabels();
  renderSelectedChips();
}

function renderSelectedChips() {
  if (!$selectedChips) return;
  const filled = selections
    .map((iso, i) => ({ iso, i, row: cache.find((r) => r.iso === iso) }))
    .filter((item) => item.iso && item.row);
  if (!filled.length) {
    $selectedChips.innerHTML = "";
    return;
  }
  $selectedChips.innerHTML = filled
    .map(
      ({ i, row }) => `
        <button type="button" class="chip compare-selected-chip" data-remove-index="${i}">
          ${escapeHtml(row.name)}
          <span aria-hidden="true">x</span>
        </button>
      `
    )
    .join("");
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

  const rankedRows = rankedRowsForYear();
  const rankNums = filled.map((r) => {
    const i = rankedRows.findIndex((c) => c.iso === r.iso);
    return i < 0 ? NaN : i + 1;
  });
  const healthVals = filled.map((r) => pillarValues(r).health);
  const bestRank = bestCols(rankNums, true);
  const bestLe = bestCols(filled.map((r) => r.le), false);
  const bestHale = bestCols(filled.map((r) => r.hale), false);
  const bestHealth = bestCols(healthVals, false);
  const bestGni = bestCols(filled.map((r) => r.gni), false);
  const bestHom = bestCols(filled.map((r) => r.homicidesPer100k), true);
  const bestFreedom = bestCols(filled.map((r) => r.freedom), false);
  const bestTomer = bestCols(
    filled.map((r) => r.customIndex ?? r.customHdi),
    false
  );

  const multi = filled.length >= 2;
  const green = (cols) => (multi ? cols : new Set());
  const leTexts = filled.map((r) => compareValueHtml(r, metricDefs[1], num(r.le, 1)));
  const haleTexts = filled.map((r) => compareValueHtml(r, metricDefs[2], num(r.hale, 1)));
  const healthTexts = filled.map((r, i) => {
    const value = Number.isFinite(healthVals[i]) ? formatTomer(healthVals[i]) : "-";
    return `${value}${sourceYearBadgeHtml(r, ["leYear", "haleYear"], year)}`;
  });
  const gniTexts = filled.map((r) => compareValueHtml(r, metricDefs[3], intOrDash(r.gni)));
  const homicideTexts = filled.map((r) =>
    compareValueHtml(r, metricDefs[4], num(r.homicidesPer100k, 1))
  );
  const freedomTexts = filled.map((r) =>
    compareValueHtml(r, metricDefs[5], num(r.freedom, 1))
  );
  const tomerTexts = filled.map((r) =>
    compareValueHtml(r, metricDefs[0], formatTomer(r.customIndex ?? r.customHdi))
  );
  const rankTexts = filled.map((r) =>
    `${escapeHtml(rankForCountryInRows(r.iso, rankedRows))}${displayYearBadgeHtml(year)}`
  );

  const headCells = filled
    .map(
      (r, i) =>
        `<th scope="col">
          <span class="compare-head-name">${escapeHtml(r.name)}${dataQualityBadgeHtml(
            dataQualityForRow(r, entrySeries, qualityByIso)
          )}</span>
          <span class="compare-head-swatch" style="--series-color: ${
            compareSeriesColors[i % compareSeriesColors.length]
          }"></span>
        </th>`
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
            rankTexts,
            green(bestRank)
          )}
          ${row(
            "Life exp. (years)",
            leTexts,
            green(bestLe)
          )}
          ${row(
            "HALE (years)",
            haleTexts,
            green(bestHale)
          )}
          ${row(
            "Health pillar",
            healthTexts,
            green(bestHealth)
          )}
          ${row(
            "Abundance (income pc, PPP)",
            gniTexts,
            green(bestGni)
          )}
          ${row(
            "Homicides /100k",
            homicideTexts,
            green(bestHom)
          )}
          ${row(
            "Personal freedom (0–100)",
            freedomTexts,
            green(bestFreedom)
          )}
          ${row(
            "Tomer index",
            tomerTexts,
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
  for (const metric of metricDefs) {
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

  const { svg, xAt, yAt, innerW, innerH, padL, padT } = chartFrame({
    w: 720,
    h: 260,
    padL: 58,
    padR: 24,
    padT: 18,
    padB: 44,
    y0,
    y1,
    yearLo,
    yearHi,
    yLabel: metric.axis,
    className: "compare-series-svg",
    ariaLabel: `${metric.label} history comparison`,
  });

  for (const serie of plotted) {
    const path = svgEl("path", {
      d: linePath(serie.points, xAt, yAt, (p) => p.year, (p) => metricValue(p, metric.key)),
      class: "compare-series-line",
      fill: "none",
      stroke: serie.color,
    });
    svg.appendChild(path);

    for (const point of [serie.points[0], serie.points[serie.points.length - 1]]) {
      svg.appendChild(
        svgEl("circle", {
          cx: xAt(point.year),
          cy: yAt(metricValue(point, metric.key)),
          r: point === serie.points[serie.points.length - 1] ? "4" : "3",
          class: "compare-series-dot",
          fill: serie.color,
        })
      );
    }
  }

  const chart = document.createElement("div");
  chart.className = "compare-series-chart";

  const hoverLine = hoverLineEl(svg, padT, innerH, "compare-series-hover-line");

  const pointsByIso = new Map(
    plotted.map((serie) => [
      serie.row.iso,
      new Map(serie.points.map((point) => [point.year, point])),
    ])
  );
  const hoverDots = new Map();
  for (const serie of plotted) {
    hoverDots.set(
      serie.row.iso,
      hoverDotEl(svg, { className: "compare-series-hover-dot", fill: serie.color })
    );
  }

  hitRectEl(svg, padL, padT, innerW, innerH);
  const tooltip = createTooltip(chart, "metric-tooltip compare-series-tooltip");

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
    positionTooltip(tooltip, chart, svg, x, topY, { xMargin: 92, yMin: 36 });
  }

  function hidePoint() {
    hoverLine.style.display = "none";
    hoverDots.forEach((dot) => {
      dot.style.display = "none";
    });
    tooltip.hidden = true;
  }

  bindPointerYear(
    svg,
    { padL, innerW, yearLo, yearHi },
    {
      onMove: (pointerYear) => showYear(nearestByYear(allYears, pointerYear, (y) => y)),
      onLeave: hidePoint,
    }
  );

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
  pickSearches.push("");
  renderPicks();
  refreshCompare();
  const selects = $picks.querySelectorAll("select.compare-select");
  selects[selects.length - 1]?.focus();
});

$btnClear?.addEventListener("click", () => {
  selections = [""];
  pickSearches = [""];
  renderPicks();
  refreshCompare();
});

$selectedChips?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-remove-index]");
  if (!btn) return;
  const i = parseInt(btn.dataset.removeIndex, 10);
  if (Number.isNaN(i)) return;
  selections.splice(i, 1);
  pickSearches.splice(i, 1);
  if (!selections.length) selections = [""];
  if (!pickSearches.length) pickSearches = [""];
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
  pickSearches = isos.map(() => "");
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

function applyUrlState() {
  const params = new URLSearchParams(window.location.search);
  year = Math.max(YEAR_MIN, Math.min(YEAR_MAX, parseInt(params.get("year"), 10) || YEAR_MAX));
  const picked = (params.get("picks") ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  if (picked.length) {
    selections = picked;
    pickSearches = picked.map(() => "");
  }
}

function syncUrl() {
  if (!cache.length) return;
  const params = new URLSearchParams();
  if (year !== YEAR_MAX) params.set("year", String(year));
  const picked = selections.filter(Boolean);
  if (picked.length) params.set("picks", picked.join(","));
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", next);
}

async function load() {
  const [leaderboardPayload, seriesPayload] = await Promise.all([
    loadLeaderboardData(),
    loadSeriesData(),
  ]);
  cache = leaderboardPayload.countries ?? [];
  qualityByIso = leaderboardPayload.qualityByIso ?? {};
  entrySeries = seriesPayload.entrySeries ?? {};
  applyUrlState();
  if ($yearSlider) $yearSlider.value = String(year);
  if ($yearOutput) $yearOutput.textContent = String(year);
  $status.textContent = cache.length ? "" : "No countries in data file.";
  renderPresetChips();
  renderPicks();
  refreshCompare();
}

load()
  .catch((e) => {
    console.error(e);
    $status.textContent = e instanceof Error ? e.message : "Could not load data.";
    $status.classList.add("error");
  })
  .finally(finishInitialLoad);
