import { escapeHtml, formatInt } from "./format.js";
import {
  formatTomer,
  formatTomerAxis,
  onScaleChange,
  renderScaleControl,
} from "./index-scale.js";

const $status = document.getElementById("status");
const $tbody = document.getElementById("tbody");
const $globalChart = document.getElementById("global-series-chart");
const $scaleControl = document.getElementById("scale-control");

const COLS = 7;

/** Current sort: default = best rank (highest Tomer index first). */
let sortState = { key: "tomer", bestFirst: true };

/** @param {string} key */
function sortValue(r, key) {
  switch (key) {
    case "tomer": {
      const v = r.customIndex ?? r.customHdi;
      return typeof v === "number" && Number.isFinite(v) ? v : NaN;
    }
    case "le":
      return typeof r.le === "number" && Number.isFinite(r.le) ? r.le : NaN;
    case "hale":
      return typeof r.hale === "number" && !Number.isNaN(r.hale) ? r.hale : NaN;
    case "gni":
      return typeof r.gni === "number" && Number.isFinite(r.gni) ? r.gni : NaN;
    case "homicides": {
      const h = r.homicidesPer100k;
      return typeof h === "number" && !Number.isNaN(h) ? h : NaN;
    }
    default:
      return NaN;
  }
}

/**
 * @param {typeof cache} rows
 * @param {string} key tomer | le | hale | gni | homicides | name
 * @param {boolean} bestFirst better-at-metric first; for name = A–Z
 */
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

function getSortedCache() {
  if (!cache.length) return [];
  const { key, bestFirst } = sortState;
  return sortedRows(cache, key, bestFirst);
}

function updateHeaderSortUI() {
  document.querySelectorAll(".leaderboard-table .th-sort").forEach((btn) => {
    const key = btn.dataset.sort;
    const active = key === sortState.key;
    const label = btn.querySelector(".th-sort-label")?.textContent?.trim() ?? key;
    const icon = btn.querySelector(".th-sort-icon");

    btn.classList.toggle("is-active", active);
    if (icon) {
      icon.textContent = active ? (sortState.bestFirst ? "↑" : "↓") : "";
    }

    if (active) {
      const hint = sortState.bestFirst ? "Best first — click to reverse" : "Worst first — click to reverse";
      btn.setAttribute("aria-label", `${label}: ${hint}`);
    } else {
      btn.setAttribute("aria-label", `Sort by ${label}`);
    }
  });
}

function renderTable(rows) {
  $tbody.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = COLS;
    td.className = "empty";
    td.textContent = "No data.";
    tr.appendChild(td);
    $tbody.appendChild(tr);
    return;
  }

  rows.forEach((r, i) => {
    const rank = i + 1;
    const tr = document.createElement("tr");
    const href = `./entry.html?iso=${encodeURIComponent(r.iso)}`;
    tr.className = "leaderboard-row-link";
    tr.dataset.href = href;
    tr.tabIndex = 0;
    tr.setAttribute("aria-label", `Open ${r.name} history`);
    const h = r.homicidesPer100k;
    const hStr =
      typeof h === "number" && !Number.isNaN(h) ? h.toFixed(1) : "—";
    const idx = r.customIndex ?? r.customHdi ?? 0;
    const hale =
      typeof r.hale === "number" && !Number.isNaN(r.hale)
        ? r.hale.toFixed(1)
        : "—";
    tr.innerHTML = `
      <td>${rank}</td>
      <td><a class="leaderboard-entry-link" href="${href}">${escapeHtml(r.name)}</a></td>
      <td>${r.le.toFixed(1)}</td>
      <td>${hale}</td>
      <td>${formatInt(r.gni)}</td>
      <td>${hStr}</td>
      <td>${formatTomer(idx)}</td>
    `;
    $tbody.appendChild(tr);
  });
}

let cache = [];

function globalSourceYearText(point) {
  const parts = [
    ["LE", point.leYear],
    ["HALE", point.haleYear],
    ["GNI", point.gniYear],
    ["Homicides", point.homicideYear],
  ]
    .filter(([, year]) => typeof year === "number" && year !== point.year)
    .map(([label, year]) => `${label} ${year}`);
  return parts.length ? `Source years: ${parts.join(", ")}` : "";
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

/**
 * @param {HTMLElement} container
 * @param {{ points: { year: number, value: number, n: number, population?: number, leYear?: number, haleYear?: number, gniYear?: number, homicideYear?: number }[] }} series
 */
function renderGlobalAverageChart(container, series) {
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

  svg.addEventListener("pointerleave", hidePoint);
  svg.addEventListener("blur", hidePoint);

  if (false) {
    $globalFoot.hidden = false;
    if (typeof series?.footNote === "string" && series.footNote.trim()) {
      $globalFoot.textContent = series.footNote.trim();
    } else {
      const popBit =
        typeof last.population === "number" && Number.isFinite(last.population)
          ? `; pop. sum (included) ≈${last.population.toLocaleString()}`
          : "";
      $globalFoot.textContent = `${first.year} ${fmt(first.value)} → ${last.year} ${fmt(
        last.value
      )} (${last.n} countries${popBit} in ${last.year}).`;
    }
  }
}


function refreshLeaderboard() {
  updateHeaderSortUI();
  renderTable(getSortedCache());
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
  if (sortState.key === key) {
    sortState.bestFirst = !sortState.bestFirst;
  } else {
    sortState = { key, bestFirst: true };
  }
  refreshLeaderboard();
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

renderScaleControl($scaleControl);
let lastGlobalSeries = { points: [] };

async function loadAndCache() {
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
  lastGlobalSeries = payload.globalAverageSeries ?? { points: [] };
  setStatus(cache.length ? "" : "No rows in data file.");
  updateHeaderSortUI();
  renderTable(getSortedCache());
  renderGlobalAverageChart($globalChart, lastGlobalSeries);
}

onScaleChange(() => {
  renderTable(getSortedCache());
  renderGlobalAverageChart($globalChart, lastGlobalSeries);
});

loadAndCache().catch((e) => {
  console.error(e);
  setStatus(e instanceof Error ? e.message : "Could not load data.", true);
});

/** @typedef {{ iso: string, name: string, leYear: number|string, le: number, haleYear?: number|string, hale?: number, gniYear: number|string, gni: number, homicideYear: number|string, homicidesPer100k: number, customIndex: number, derivedKind?: string, memberCount?: number }} CountryRow */
