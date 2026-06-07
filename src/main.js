import { escapeHtml, formatInt } from "./format.js";
import {
  formatTomer,
  formatTomerAxis,
  onScaleChange,
  renderScaleControl,
} from "./index-scale.js";
import { combinedHealthLei } from "./hdi-core.js";
import { dataQualityBadgeHtml, dataQualityForRow } from "./data-quality.js";
import { loadLeaderboardData, loadSeriesData } from "./data-loader.js";
import { sourceYearBadgeHtml, sourceYearSummary } from "./source-years.js";
import { YEAR_MAX, YEAR_MIN } from "./site-years.js";

const $status = document.getElementById("status");
const $tbody = document.getElementById("tbody");
const $globalChart = document.getElementById("global-series-chart");
const $scaleControl = document.getElementById("scale-control");
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

const COLS = 8;
const SOURCE_KEYS = ["leYear", "haleYear", "gniYear", "homicideYear"];
const TYPE_FILTERS = [
  { id: "country", name: "Country" },
  { id: "region", name: "Region" },
  { id: "income", name: "Income group" },
  { id: "derived", name: "Derived group" },
];

function healthValue(r) {
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
};

let payload = null;
let latestRows = [];
let entrySeries = {};
let qualityByIso = {};
let regionsList = [];
let incomesList = [];

function sortValue(r, key) {
  switch (key) {
    case "tomer": {
      const v = r.customIndex ?? r.customHdi;
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
      gni: point.gni,
      gniYear: point.gniYear,
      homicidesPer100k: point.homicidesPer100k,
      homicideYear: point.homicideYear,
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

function metricCell(row, html, sourceKeys = []) {
  return `${html}${sourceYearBadgeHtml(row, sourceKeys, state.year)}`;
}

function tomerSourceBadge(row) {
  return sourceYearBadgeHtml(row, SOURCE_KEYS, state.year);
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
  rows.forEach((r, i) => {
    const rank = i + 1;
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
    const idx = r.customIndex ?? r.customHdi;
    const health = healthValue(r);
    const healthText = Number.isFinite(health) ? formatTomer(health) : "-";
    const gniText =
      typeof r.gni === "number" && Number.isFinite(r.gni) ? formatInt(r.gni) : "-";
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
      <td>${formatTomer(idx)}${tomerSourceBadge(r)}</td>
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
    .map((r, i) => {
      const href = `./entry.html?iso=${encodeURIComponent(r.iso)}`;
      const quality = rowQuality(r);
      const idx = r.customIndex ?? r.customHdi;
      const health = healthValue(r);
      const source = sourceYearSummary(r, SOURCE_KEYS, state.year);
      const healthText = Number.isFinite(health) ? formatTomer(health) : "-";
      const gniText =
        typeof r.gni === "number" && Number.isFinite(r.gni) ? formatInt(r.gni) : "-";
      return `
        <article class="leaderboard-card" data-href="${href}" tabindex="0" aria-label="Open ${escapeHtml(
          r.name
        )} history">
          <div class="leaderboard-card-head">
            <span class="leaderboard-card-rank">#${i + 1}</span>
            <div>
              <h2 class="leaderboard-card-title">${escapeHtml(r.name)}${dataQualityBadgeHtml(
                quality
              )}</h2>
              <p class="leaderboard-card-meta">${escapeHtml(rowTypeLabel(r))}${
                source ? ` &middot; ${escapeHtml(source)}` : ""
              }</p>
            </div>
          </div>
          <dl class="leaderboard-card-grid">
            <div><dt>Tomer</dt><dd>${formatTomer(idx)}${tomerSourceBadge(r)}</dd></div>
            <div><dt>Life exp.</dt><dd>${metricCell(r, fmtNum(r.le, 1), "leYear")}</dd></div>
            <div><dt>HALE</dt><dd>${metricCell(r, fmtNum(r.hale, 1), "haleYear")}</dd></div>
            <div><dt>Health</dt><dd>${metricCell(r, healthText, ["leYear", "haleYear"])}</dd></div>
            <div><dt>GNI pc</dt><dd>${metricCell(r, gniText, "gniYear")}</dd></div>
            <div><dt>Homicides</dt><dd>${metricCell(
              r,
              fmtNum(r.homicidesPer100k, 1),
              "homicideYear"
            )}</dd></div>
          </dl>
        </article>
      `;
    })
    .join("");
}

function globalSourceYearText(point) {
  const parts = [
    ["LE", point.leYear],
    ["HALE", point.haleYear],
    ["GNI", point.gniYear],
    ["Homicides", point.homicideYear],
  ]
    .filter(([, year]) => typeof year === "number" && year === point.year)
    .map(([label, year]) => `${label} ${year}`);
  return parts.length ? `Source years with data: ${parts.join(", ")}` : "";
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

function renderGlobalAverageChart(container, series, highlightYear) {
  container.replaceChildren();
  const pts = series?.points;
  if (!Array.isArray(pts) || !pts.length) {
    const p = document.createElement("p");
    p.className = "global-series-empty muted";
    p.textContent =
      "No time series in data. Run npm run build-data to refresh public/data/countries.json.";
    container.appendChild(p);
    return;
  }

  const w = 880;
  const h = 300;
  const padL = 52;
  const padR = 28;
  const padT = 20;
  const padB = 48;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const yearLo = Math.min(...pts.map((p) => p.year));
  const yearHi = Math.max(...pts.map((p) => p.year));
  const valLo = Math.min(...pts.map((p) => p.value));
  const valHi = Math.max(...pts.map((p) => p.value));
  const padV = (valHi - valLo) * 0.08 || 0.02;
  const y0 = valLo - padV;
  const y1 = valHi + padV;

  const xAt = (year) => {
    const span = yearHi - yearLo || 1;
    return padL + ((year - yearLo) / span) * innerW;
  };
  const yAt = (v) => padT + innerH - ((v - y0) / (y1 - y0 || 1)) * innerH;

  const d = pts
    .map((p, i) => {
      const x = xAt(p.year);
      const y = yAt(p.value);
      return `${i === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");

  const last = pts[pts.length - 1];
  const first = pts[0];
  const fmt = (v) => formatTomer(v);

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("class", "global-series-svg");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const gridTicks = 4;
  for (let i = 0; i <= gridTicks; i++) {
    const t = i / gridTicks;
    const v = y0 + (1 - t) * (y1 - y0);
    const gy = padT + t * innerH;
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", String(padL));
    line.setAttribute("x2", String(padL + innerW));
    line.setAttribute("y1", String(gy));
    line.setAttribute("y2", String(gy));
    line.setAttribute("class", "global-series-grid");
    svg.appendChild(line);
    const lab = document.createElementNS(ns, "text");
    lab.setAttribute("x", String(padL - 8));
    lab.setAttribute("y", String(gy + 4));
    lab.setAttribute("text-anchor", "end");
    lab.setAttribute("class", "global-series-axis");
    lab.textContent = formatTomerAxis(v);
    svg.appendChild(lab);
  }

  for (let i = 0; i <= 2; i++) {
    const t = i / 2;
    const yr = Math.round(yearLo + t * (yearHi - yearLo));
    const gx = xAt(yr);
    const lab = document.createElementNS(ns, "text");
    lab.setAttribute("x", String(gx));
    lab.setAttribute("y", String(h - 12));
    lab.setAttribute("text-anchor", "middle");
    lab.setAttribute("class", "global-series-axis");
    lab.textContent = String(yr);
    svg.appendChild(lab);
  }

  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  path.setAttribute("class", "global-series-line");
  path.setAttribute("fill", "none");
  svg.appendChild(path);

  const cLast = document.createElementNS(ns, "circle");
  cLast.setAttribute("cx", String(xAt(last.year)));
  cLast.setAttribute("cy", String(yAt(last.value)));
  cLast.setAttribute("r", "4");
  cLast.setAttribute("class", "global-series-dot");
  svg.appendChild(cLast);

  const cFirst = document.createElementNS(ns, "circle");
  cFirst.setAttribute("cx", String(xAt(first.year)));
  cFirst.setAttribute("cy", String(yAt(first.value)));
  cFirst.setAttribute("r", "3");
  cFirst.setAttribute("class", "global-series-dot global-series-dot-start");
  svg.appendChild(cFirst);

  if (typeof highlightYear === "number") {
    const hp = pts.find((p) => p.year === highlightYear);
    if (hp) {
      const hx = xAt(hp.year);
      const vline = document.createElementNS(ns, "line");
      vline.setAttribute("x1", String(hx));
      vline.setAttribute("x2", String(hx));
      vline.setAttribute("y1", String(padT));
      vline.setAttribute("y2", String(padT + innerH));
      vline.setAttribute("class", "global-series-highlight-line");
      svg.appendChild(vline);
      const dot = document.createElementNS(ns, "circle");
      dot.setAttribute("cx", String(hx));
      dot.setAttribute("cy", String(yAt(hp.value)));
      dot.setAttribute("r", "5");
      dot.setAttribute("class", "global-series-highlight-dot");
      svg.appendChild(dot);
    }
  }

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

  const chart = document.createElement("div");
  chart.className = "global-series-chart-inner";
  chart.appendChild(tooltip);
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
    tooltip.innerHTML = `
      <strong>${point.year}</strong>
      <span>Tomer index: ${fmt(point.value)}</span>
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
    let closest = pts[0];
    let best = Infinity;
    for (const point of pts) {
      const delta = Math.abs(point.year - yearAtPointer);
      if (delta < best) {
        closest = point;
        best = delta;
      }
    }
    showPoint(closest);
  });

  svg.addEventListener("click", (e) => {
    const svgPoint = clientToSvgPoint(svg, e.clientX, e.clientY);
    const clampedX = Math.max(padL, Math.min(svgPoint.x, padL + innerW));
    const yearAtPointer = yearLo + ((clampedX - padL) / innerW) * (yearHi - yearLo || 1);
    let closest = pts[0];
    let best = Infinity;
    for (const point of pts) {
      const delta = Math.abs(point.year - yearAtPointer);
      if (delta < best) {
        closest = point;
        best = delta;
      }
    }
    setYear(closest.year);
  });

  svg.addEventListener("pointerleave", hidePoint);
  svg.addEventListener("blur", hidePoint);
}

function setYear(year) {
  const y = Math.max(YEAR_MIN, Math.min(YEAR_MAX, parseInt(year, 10) || YEAR_MAX));
  state.year = y;
  if ($yearSlider) $yearSlider.value = String(y);
  if ($yearOutput) $yearOutput.textContent = String(y);
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
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", next);
}

function refresh() {
  syncUrl();
  const rows = getDisplayRows();
  updateHeaderSortUI();
  renderTable(rows);
  renderCards(rows);
  renderGlobalAverageChart($globalChart, payload?.globalAverageSeries, state.year);
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

renderScaleControl($scaleControl);
onScaleChange(() => refresh());

async function loadAndCache() {
  const [leaderboardPayload, seriesPayload] = await Promise.all([
    loadLeaderboardData(),
    loadSeriesData(),
  ]);
  payload = leaderboardPayload;
  latestRows = payload.countries ?? [];
  entrySeries = seriesPayload.entrySeries ?? {};
  qualityByIso = payload.qualityByIso ?? {};
  applyUrlState();

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
  renderFilterChips();
  refresh();
}

loadAndCache().catch((e) => {
  console.error(e);
  setStatus(e instanceof Error ? e.message : "Could not load data.", true);
});
