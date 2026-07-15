import { escapeHtml, formatInt } from "./format.js";
import { formatTomer, formatTomerAxis } from "./index-scale.js";
import { combinedHealthLei } from "./hdi-core.js";
import { dataQualityBadgeHtml, dataQualityForRow } from "./data-quality.js";
import { loadLeaderboardData, loadSeriesData } from "./data-loader.js";
import { sourceYearCellHtml } from "./source-years.js";
import { YEAR_MAX, YEAR_MIN } from "./site-years.js";
import { TOMER_SOURCE_KEYS } from "./metric-defs.js";
import { finishInitialLoad } from "./page-ready.js";
import {
  DEFAULT_WEIGHT_POINTS,
  normalizedWeightPoints,
  weightedIndexFromPillars,
} from "./index-weights.js";
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

const $status = document.getElementById("status");
const $tbody = document.getElementById("tbody");
const $globalChart = document.getElementById("global-series-chart");
const $globalDefinition = document.getElementById("global-series-def");
const $yearSlider = document.getElementById("year-slider");
const $yearOutput = document.getElementById("year-output");
const $searchInput = document.getElementById("search-input");
const $typeChips = document.querySelector("#type-filter .chips");
const $regionChips = document.querySelector("#region-filter .chips");
const $incomeChips = document.querySelector("#income-filter .chips");
const $filterReset = document.getElementById("filter-reset");
const $includeAggregates = document.getElementById("include-aggregates");
const $qualityFilter = document.getElementById("quality-filter");
const $cards = document.getElementById("leaderboard-cards");
const $weightInputs = [...document.querySelectorAll("[data-index-weight]")];
const $weightOutputs = [...document.querySelectorAll("[data-index-weight-output]")];
const $weightNote = document.getElementById("leaderboard-weight-note");
const $weightReset = document.getElementById("leaderboard-weight-reset");

const COLS = 9;
const TYPE_FILTERS = [
  { id: "country", name: "Country" },
  { id: "region", name: "Region" },
  { id: "income", name: "Income group" },
  { id: "derived", name: "Derived group" },
];

function healthValue(r) {
  if (Number.isFinite(r?.healthIndex)) return r.healthIndex;
  if (typeof r.le !== "number" || !Number.isFinite(r.le)) return NaN;
  if (typeof r.hale !== "number" || !Number.isFinite(r.hale)) return NaN;
  return combinedHealthLei(r.le, r.hale);
}
const state = {
  year: YEAR_MAX,
  search: "",
  types: new Set(),
  regions: new Set(),
  incomes: new Set(),
  quality: "all",
  includeAggregates: true,
  sortKey: "tomer",
  bestFirst: true,
  weights: { ...DEFAULT_WEIGHT_POINTS },
};

let payload = null;
let latestRows = [];
let entrySeries = {};
let seriesPromise = null;
let qualityByIso = {};
let regionsList = [];
let incomesList = [];
/** ISO → Tomer rank for the current year, over the full unfiltered row set. */
let rankByIso = new Map();
let lastChartKey = "";

function indexValue(row) {
  return weightedIndexFromPillars(row, state.weights);
}

function updateWeightUi() {
  const effective = normalizedWeightPoints(state.weights);
  for (const input of $weightInputs) input.value = String(state.weights[input.dataset.indexWeight]);
  for (const output of $weightOutputs) {
    output.textContent = `${(effective[output.dataset.indexWeightOutput] * 100).toFixed(1)}%`;
  }
  if ($weightNote) {
    const rawTotal = Object.values(state.weights).reduce((sum, value) => sum + value, 0);
    $weightNote.textContent = rawTotal > 0
      ? `Normalized to 100% from ${rawTotal} slider points`
      : "All-zero selection uses the default weights";
  }
}

/**
 * series.json is ~1.4 MB and only needed for years before YEAR_MAX, so it is
 * fetched on demand instead of with the initial page load.
 */
function ensureSeries() {
  if (!seriesPromise) {
    seriesPromise = loadSeriesData().then((seriesPayload) => {
      entrySeries = seriesPayload.entrySeries ?? {};
    });
    seriesPromise.catch(() => {
      seriesPromise = null;
    });
  }
  return seriesPromise;
}

function sortValue(r, key) {
  switch (key) {
    case "tomer": {
      const v = indexValue(r);
      return typeof v === "number" && Number.isFinite(v) ? v : NaN;
    }
    case "le":
      return typeof r.le === "number" && Number.isFinite(r.le) ? r.le : NaN;
    case "hale":
      return typeof r.hale === "number" && Number.isFinite(r.hale) ? r.hale : NaN;
    case "health":
      return healthValue(r);
    case "gni":
      return typeof r.gni === "number" && Number.isFinite(r.gni) ? r.gni : NaN;
    case "homicides":
      return typeof r.homicidesPer100k === "number" && Number.isFinite(r.homicidesPer100k)
        ? r.homicidesPer100k
        : NaN;
    case "freedom":
      return typeof r.freedom === "number" && Number.isFinite(r.freedom) ? r.freedom : NaN;
    default:
      return NaN;
  }
}

function sortedRows(rows, key, bestFirst) {
  const copy = [...rows];
  if (key === "name") {
    copy.sort((a, b) => {
      const c = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      return bestFirst ? c : -c;
    });
    return copy;
  }
  const lowerIsBetter = key === "homicides";
  copy.sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    const aBad = !Number.isFinite(va);
    const bBad = !Number.isFinite(vb);
    if (aBad && bBad) return a.name.localeCompare(b.name);
    if (aBad) return 1;
    if (bBad) return -1;
    let cmp = va - vb;
    if (!lowerIsBetter) cmp = -cmp;
    if (!bestFirst) cmp = -cmp;
    if (cmp !== 0) return cmp > 0 ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  return copy;
}

/**
 * Build the row set for a given year. For YEAR_MAX we use the latest values
 * from `payload.countries` (these include `region`/`incomeLevel` metadata and
 * potentially newer source years than entrySeries' timeline). For other years
 * we read each entry's point at that year and merge in metadata from the
 * latest row.
 */
function rowsForYear(year) {
  if (!payload) return [];
  if (year === YEAR_MAX) return latestRows;

  const out = [];
  const meta = new Map(latestRows.map((r) => [r.iso, r]));
  for (const iso of Object.keys(entrySeries)) {
    const point = entrySeries[iso].points.find((p) => p.year === year);
    if (!point) continue;
    const base = meta.get(iso);
    if (!base) continue;
    out.push({
      iso,
      name: base.name,
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
      derivedKind: base.derivedKind,
      memberCount: base.memberCount,
      region: base.region,
      incomeLevel: base.incomeLevel,
    });
  }
  return out;
}

function rowType(row) {
  if (!row.derivedKind) return "country";
  if (row.derivedKind === "region" || row.derivedKind === "adminregion") return "region";
  if (row.derivedKind === "incomeLevel") return "income";
  return "derived";
}

function rowTypeLabel(row) {
  return TYPE_FILTERS.find((type) => type.id === rowType(row))?.name ?? "Derived group";
}

function rowQuality(row) {
  return dataQualityForRow(row, entrySeries, qualityByIso);
}

function filterRows(rows) {
  const q = state.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (!state.includeAggregates && r.derivedKind) return false;
    if (state.types.size && !state.types.has(rowType(r))) return false;
    const quality = rowQuality(r);
    if (state.quality === "complete" && quality) return false;
    if (state.quality === "incomplete" && !quality) return false;
    if (q) {
      const hay = [
        r.name,
        r.iso,
        r.region?.name,
        r.incomeLevel?.name,
        r.derivedKind,
        rowTypeLabel(r),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (state.regions.size) {
      const id = r.region?.id;
      if (!id || !state.regions.has(id)) return false;
    }
    if (state.incomes.size) {
      const id = r.incomeLevel?.id;
      if (!id || !state.incomes.has(id)) return false;
    }
    return true;
  });
}

function getDisplayRows() {
  const rows = filterRows(rowsForYear(state.year));
  return sortedRows(rows, state.sortKey, state.bestFirst);
}

function updateHeaderSortUI() {
  document.querySelectorAll(".leaderboard-table .th-sort").forEach((btn) => {
    const key = btn.dataset.sort;
    const active = key === state.sortKey;
    const label = btn.querySelector(".th-sort-label")?.textContent?.trim() ?? key;
    const icon = btn.querySelector(".th-sort-icon");
    btn.classList.toggle("is-active", active);
    if (icon) icon.textContent = active ? (state.bestFirst ? "↑" : "↓") : "";
    if (active) {
      const hint = state.bestFirst
        ? "Best first — click to reverse"
        : "Worst first — click to reverse";
      btn.setAttribute("aria-label", `${label}: ${hint}`);
    } else {
      btn.setAttribute("aria-label", `Sort by ${label}`);
    }
  });
}

function fmtNum(v, digits = 1) {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";
}

/**
 * One uniform structure for every metric cell: the value on its own line and
 * the source-year badge in a fixed slot below it (see .metric-cell), so cells
 * never differ between inline and wrapped layouts as badge widths vary.
 */
function metricCell(row, html, sourceKeys = []) {
  return `<span class="metric-cell"><span class="metric-cell-value">${html}</span>${sourceYearCellHtml(
    row,
    sourceKeys,
    state.year
  )}</span>`;
}

function renderTable(rows) {
  $tbody.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = COLS;
    td.className = "empty";
    td.textContent = "No matches.";
    tr.appendChild(td);
    $tbody.appendChild(tr);
    return;
  }

  const frag = document.createDocumentFragment();
  rows.forEach((r) => {
    const rank = rankByIso.get(r.iso) ?? "—";
    const tr = document.createElement("tr");
    const href = `./entry.html?iso=${encodeURIComponent(r.iso)}`;
    const quality = rowQuality(r);
    tr.className = "leaderboard-row-link";
    tr.dataset.href = href;
    tr.tabIndex = 0;
    tr.setAttribute(
      "aria-label",
      quality ? `Open ${r.name} history. ${quality.description}` : `Open ${r.name} history`
    );
    const idx = indexValue(r);
    const health = healthValue(r);
    const healthText = Number.isFinite(health) ? formatTomer(health) : "—";
    const gniText =
      typeof r.gni === "number" && Number.isFinite(r.gni) ? formatInt(r.gni) : "—";
    tr.innerHTML = `
      <td>${rank}</td>
      <td class="place-cell"><a class="leaderboard-entry-link" href="${href}">${escapeHtml(
        r.name
      )}</a>${dataQualityBadgeHtml(quality)}</td>
      <td>${metricCell(r, fmtNum(r.le, 1), "leYear")}</td>
      <td>${metricCell(r, fmtNum(r.hale, 1), "haleYear")}</td>
      <td>${metricCell(r, healthText, ["leYear", "haleYear"])}</td>
      <td>${metricCell(r, gniText, "gniYear")}</td>
      <td>${metricCell(r, fmtNum(r.homicidesPer100k, 1), "homicideYear")}</td>
      <td>${metricCell(r, fmtNum(r.freedom, 1), "freedomYear")}</td>
      <td>${metricCell(r, formatTomer(idx), TOMER_SOURCE_KEYS)}</td>
    `;
    frag.appendChild(tr);
  });
  $tbody.appendChild(frag);
}

function renderCards(rows) {
  if (!$cards) return;
  if (!rows.length) {
    $cards.innerHTML = '<p class="compare-hint">No matches.</p>';
    return;
  }
  $cards.innerHTML = rows
    .map((r) => {
      const href = `./entry.html?iso=${encodeURIComponent(r.iso)}`;
      const rank = rankByIso.get(r.iso) ?? "—";
      const quality = rowQuality(r);
      const idx = indexValue(r);
      const health = healthValue(r);
      const healthText = Number.isFinite(health) ? formatTomer(health) : "—";
      const gniText =
        typeof r.gni === "number" && Number.isFinite(r.gni) ? formatInt(r.gni) : "—";
      return `
        <article class="leaderboard-card" data-href="${href}" tabindex="0" aria-label="Open ${escapeHtml(
          r.name
        )} history">
          <div class="leaderboard-card-head">
            <span class="leaderboard-card-rank">#${rank}</span>
            <div>
              <h2 class="leaderboard-card-title">${escapeHtml(r.name)}${dataQualityBadgeHtml(
                quality
              )}</h2>
              <p class="leaderboard-card-meta">${escapeHtml(rowTypeLabel(r))}</p>
            </div>
          </div>
          <dl class="leaderboard-card-grid">
            <div><dt>Tomer</dt><dd>${metricCell(r, formatTomer(idx), TOMER_SOURCE_KEYS)}</dd></div>
            <div><dt>Life exp.</dt><dd>${metricCell(r, fmtNum(r.le, 1), "leYear")}</dd></div>
            <div><dt>HALE</dt><dd>${metricCell(r, fmtNum(r.hale, 1), "haleYear")}</dd></div>
            <div><dt>Health</dt><dd>${metricCell(r, healthText, ["leYear", "haleYear"])}</dd></div>
            <div><dt>Abundance</dt><dd>${metricCell(r, gniText, "gniYear")}</dd></div>
            <div><dt>Homicides</dt><dd>${metricCell(
              r,
              fmtNum(r.homicidesPer100k, 1),
              "homicideYear"
            )}</dd></div>
            <div><dt>Freedom</dt><dd>${metricCell(r, fmtNum(r.freedom, 1), "freedomYear")}</dd></div>
          </dl>
        </article>
      `;
    })
    .join("");
}

function globalSourceYearText(point) {
  const parts = [
    ["LE", point.leYear],
    [point.haleEstimated ? "HALE est." : "HALE", point.haleYear],
    [point.incomeSource === "GDP" ? "GDP" : "GNI", point.gniYear],
    ["Homicides", point.homicideYear],
    ["Freedom", point.freedomYear],
  ]
    .filter(([label, year]) =>
      typeof year === "number" && (label === "GDP" || year !== point.year)
    )
    .map(([label, year]) => `${label} ${year}`);
  return parts.length ? `Source years: ${parts.join(", ")}` : "";
}

function renderGlobalAverageChart(container, series, highlightYear) {
  container.replaceChildren();
  const pts = series?.points;
  if (!Array.isArray(pts) || !pts.length) {
    const p = document.createElement("p");
    p.className = "global-series-empty muted";
    p.textContent =
      "No time series in data. Run npm run build-data to refresh public/data/leaderboard.json.";
    container.appendChild(p);
    return;
  }

  const yearLo = Math.min(...pts.map((p) => p.year));
  const yearHi = Math.max(...pts.map((p) => p.year));
  const { svg, xAt, yAt, innerW, innerH, padL, padT } = chartFrame({
    w: 880,
    h: 300,
    padL: 52,
    padR: 28,
    padT: 20,
    padB: 48,
    y0: 0,
    y1: 1,
    yearLo,
    yearHi,
    yLabel: formatTomerAxis,
    className: "global-series-svg",
  });

  const last = pts[pts.length - 1];
  const first = pts[0];

  svg.appendChild(
    svgEl("path", {
      d: linePath(pts, xAt, yAt, (p) => p.year, (p) => p.value),
      class: "global-series-line",
      fill: "none",
    })
  );
  svg.appendChild(
    svgEl("circle", {
      cx: xAt(last.year),
      cy: yAt(last.value),
      r: 4,
      class: "global-series-dot",
    })
  );
  svg.appendChild(
    svgEl("circle", {
      cx: xAt(first.year),
      cy: yAt(first.value),
      r: 3,
      class: "global-series-dot global-series-dot-start",
    })
  );

  if (typeof highlightYear === "number") {
    const hp = pts.find((p) => p.year === highlightYear);
    if (hp) {
      const hx = xAt(hp.year);
      svg.appendChild(
        svgEl("line", {
          x1: hx,
          x2: hx,
          y1: padT,
          y2: padT + innerH,
          class: "global-series-highlight-line",
        })
      );
      svg.appendChild(
        svgEl("circle", {
          cx: hx,
          cy: yAt(hp.value),
          r: 5,
          class: "global-series-highlight-dot",
        })
      );
    }
  }

  const hoverLine = hoverLineEl(svg, padT, innerH);
  const hoverDot = hoverDotEl(svg);
  hitRectEl(svg, padL, padT, innerW, innerH);

  const chart = document.createElement("div");
  chart.className = "global-series-chart-inner";
  const tooltip = createTooltip(chart);
  chart.appendChild(svg);
  container.appendChild(chart);

  function showPoint(point) {
    const x = xAt(point.year);
    const y = yAt(point.value);
    hoverLine.style.display = "";
    hoverDot.style.display = "";
    hoverLine.setAttribute("x1", String(x));
    hoverLine.setAttribute("x2", String(x));
    hoverDot.setAttribute("cx", String(x));
    hoverDot.setAttribute("cy", String(y));
    const source = globalSourceYearText(point);
    const coverage =
      Number.isFinite(point.n) && Number.isFinite(point.population)
        ? `${point.n} countries · ${(point.population / 1e9).toFixed(2)}B people`
        : "";
    tooltip.innerHTML = `
      <strong>${point.year}</strong>
      <span>Tomer index: ${formatTomer(point.value)}</span>
      ${coverage ? `<small>${escapeHtml(coverage)}</small>` : ""}
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
    { padL, innerW, yearLo, yearHi },
    {
      onMove: (year) => showPoint(nearestByYear(pts, year)),
      onClick: (year) => setYear(nearestByYear(pts, year).year),
      onLeave: hidePoint,
    }
  );
}

function weightedGlobalSeries(series) {
  if (!Array.isArray(series?.points)) return series;
  return {
    ...series,
    points: series.points.map((point) => ({
      ...point,
      value: indexValue(point),
    })),
  };
}

function setYear(year) {
  const y = Math.max(YEAR_MIN, Math.min(YEAR_MAX, parseInt(year, 10) || YEAR_MAX));
  state.year = y;
  if ($yearSlider) $yearSlider.value = String(y);
  if ($yearOutput) $yearOutput.textContent = String(y);
  if (y !== YEAR_MAX && !Object.keys(entrySeries).length) {
    setStatus("Loading yearly history…");
    ensureSeries()
      .then(() => {
        setStatus("");
        refresh();
      })
      .catch((e) => {
        console.error(e);
        setStatus(e instanceof Error ? e.message : "Could not load yearly history.", true);
      });
  }
  refresh();
}

function chipsHtml(list, key) {
  return list
    .map(
      ({ id, name }) => `
        <button type="button" class="chip" data-key="${key}" data-id="${escapeHtml(id)}">
          ${escapeHtml(name)}
        </button>
      `
    )
    .join("");
}

function renderFilterChips() {
  if ($typeChips) $typeChips.innerHTML = chipsHtml(TYPE_FILTERS, "type");
  if ($regionChips) $regionChips.innerHTML = chipsHtml(regionsList, "region");
  if ($incomeChips) $incomeChips.innerHTML = chipsHtml(incomesList, "income");
  syncChipState();
}

function syncChipState() {
  document.querySelectorAll(".chip").forEach((chip) => {
    const key = chip.dataset.key;
    const id = chip.dataset.id;
    const quality = chip.dataset.quality;
    const active =
      (key === "type" && state.types.has(id)) ||
      (key === "region" && state.regions.has(id)) ||
      (key === "income" && state.incomes.has(id)) ||
      (quality && quality === state.quality);
    chip.classList.toggle("is-active", !!active);
  });
  if ($includeAggregates) $includeAggregates.checked = state.includeAggregates;
}

function readCsvSet(params, key) {
  return new Set(
    (params.get(key) ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function applyUrlState() {
  const params = new URLSearchParams(window.location.search);
  state.year = Math.max(YEAR_MIN, Math.min(YEAR_MAX, parseInt(params.get("year"), 10) || YEAR_MAX));
  state.search = params.get("q") ?? "";
  state.types = readCsvSet(params, "type");
  state.regions = readCsvSet(params, "region");
  state.incomes = readCsvSet(params, "income");
  state.quality = ["all", "complete", "incomplete"].includes(params.get("quality"))
    ? params.get("quality")
    : "all";
  state.includeAggregates = params.get("aggregates") !== "0";
  const sort = params.get("sort");
  if (sort) state.sortKey = sort;
  state.bestFirst = params.get("dir") !== "asc";
  for (const key of Object.keys(DEFAULT_WEIGHT_POINTS)) {
    const raw = params.get(`w_${key}`);
    if (raw == null) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0 && value <= 100) state.weights[key] = value;
  }
}

function syncUrl() {
  if (!payload) return;
  const params = new URLSearchParams();
  if (state.year !== YEAR_MAX) params.set("year", String(state.year));
  if (state.search.trim()) params.set("q", state.search.trim());
  if (state.types.size) params.set("type", [...state.types].join(","));
  if (state.regions.size) params.set("region", [...state.regions].join(","));
  if (state.incomes.size) params.set("income", [...state.incomes].join(","));
  if (state.quality !== "all") params.set("quality", state.quality);
  if (!state.includeAggregates) params.set("aggregates", "0");
  if (state.sortKey !== "tomer") params.set("sort", state.sortKey);
  if (!state.bestFirst) params.set("dir", "asc");
  for (const [key, value] of Object.entries(state.weights)) {
    if (value !== DEFAULT_WEIGHT_POINTS[key]) params.set(`w_${key}`, String(value));
  }
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", next);
}

function computeRanks(ranked) {
  rankByIso = new Map();
  ranked.forEach((r, i) => {
    if (state.sortKey === "name" || Number.isFinite(sortValue(r, state.sortKey))) {
      rankByIso.set(r.iso, i + 1);
    }
  });
}

function refresh() {
  syncUrl();
  const rows = getDisplayRows();
  computeRanks(rows);
  updateHeaderSortUI();
  renderTable(rows);
  renderCards(rows);
  // The world chart depends on the year and custom weights, so skip the SVG
  // rebuild when only a search/filter keystroke triggered the refresh.
  const chartKey = `${state.year}:${Object.values(state.weights).join(",")}`;
  if ($globalChart && chartKey !== lastChartKey) {
    if ($globalDefinition && payload?.globalAverageSeries?.definition) {
      $globalDefinition.textContent = payload.globalAverageSeries.definition;
    }
    renderGlobalAverageChart(
      $globalChart,
      weightedGlobalSeries(payload?.globalAverageSeries),
      state.year
    );
    lastChartKey = chartKey;
  }
  syncChipState();
}

function setStatus(msg, isError = false) {
  $status.textContent = msg;
  $status.classList.toggle("error", isError);
}

document.querySelector(".leaderboard-table thead")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".th-sort");
  if (!(btn instanceof HTMLButtonElement)) return;
  const key = btn.dataset.sort;
  if (!key) return;
  if (state.sortKey === key) state.bestFirst = !state.bestFirst;
  else {
    state.sortKey = key;
    state.bestFirst = true;
  }
  refresh();
});

$tbody.addEventListener("click", (e) => {
  if (e.target.closest("a, button")) return;
  const row = e.target.closest("tr[data-href]");
  const href = row?.dataset.href;
  if (href) window.location.href = href;
});

$tbody.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const row = e.target.closest("tr[data-href]");
  const href = row?.dataset.href;
  if (!href) return;
  e.preventDefault();
  window.location.href = href;
});

$cards?.addEventListener("click", (e) => {
  const card = e.target.closest(".leaderboard-card[data-href]");
  const href = card?.dataset.href;
  if (href) window.location.href = href;
});

$cards?.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const card = e.target.closest(".leaderboard-card[data-href]");
  const href = card?.dataset.href;
  if (!href) return;
  e.preventDefault();
  window.location.href = href;
});

$yearSlider?.addEventListener("input", (e) => {
  setYear(e.target.value);
});

$searchInput?.addEventListener("input", (e) => {
  state.search = e.target.value;
  refresh();
});

document.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  if (chip.dataset.quality) {
    state.quality = chip.dataset.quality;
    refresh();
    return;
  }
  const key = chip.dataset.key;
  const id = chip.dataset.id;
  if (key === "type") {
    if (state.types.has(id)) state.types.delete(id);
    else state.types.add(id);
  } else if (key === "region") {
    if (state.regions.has(id)) state.regions.delete(id);
    else state.regions.add(id);
  } else if (key === "income") {
    if (state.incomes.has(id)) state.incomes.delete(id);
    else state.incomes.add(id);
  } else return;
  refresh();
});

$includeAggregates?.addEventListener("change", (e) => {
  state.includeAggregates = !!e.target.checked;
  refresh();
});

$weightInputs.forEach((input) =>
  input.addEventListener("input", () => {
    state.weights[input.dataset.indexWeight] = Number(input.value);
    updateWeightUi();
    refresh();
  })
);

$weightReset?.addEventListener("click", () => {
  state.weights = { ...DEFAULT_WEIGHT_POINTS };
  updateWeightUi();
  refresh();
});

$filterReset?.addEventListener("click", () => {
  state.search = "";
  state.types.clear();
  state.regions.clear();
  state.incomes.clear();
  state.quality = "all";
  state.includeAggregates = true;
  if ($searchInput) $searchInput.value = "";
  refresh();
});

async function loadAndCache() {
  payload = await loadLeaderboardData();
  latestRows = payload.countries ?? [];
  qualityByIso = payload.qualityByIso ?? {};
  applyUrlState();
  // Deep links to a past year need the per-year history right away.
  if (state.year !== YEAR_MAX) await ensureSeries();

  const regionMap = new Map();
  const incomeMap = new Map();
  for (const r of latestRows) {
    if (r.region?.id) regionMap.set(r.region.id, r.region);
    if (r.incomeLevel?.id) incomeMap.set(r.incomeLevel.id, r.incomeLevel);
  }
  regionsList = [...regionMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  incomesList = [...incomeMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  setStatus(latestRows.length ? "" : "No rows in data file.");
  if ($yearSlider) $yearSlider.value = String(state.year);
  if ($yearOutput) $yearOutput.textContent = String(state.year);
  if ($searchInput) $searchInput.value = state.search;
  if ($includeAggregates) $includeAggregates.checked = state.includeAggregates;
  updateWeightUi();
  renderFilterChips();
  refresh();
}

loadAndCache()
  .catch((e) => {
    console.error(e);
    setStatus(e instanceof Error ? e.message : "Could not load data.", true);
  })
  .finally(finishInitialLoad);
