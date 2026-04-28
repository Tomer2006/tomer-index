import { escapeHtml, formatInt } from "./format.js";

const $status = document.getElementById("status");
const $tbody = document.getElementById("tbody");
const $globalDef = document.getElementById("global-series-def");
const $globalChart = document.getElementById("global-series-chart");
const $globalFoot = document.getElementById("global-series-foot");

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
      <td>${escapeHtml(r.name)}</td>
      <td>${r.le.toFixed(1)}</td>
      <td>${hale}</td>
      <td>${formatInt(r.gni)}</td>
      <td>${hStr}</td>
      <td>${idx.toFixed(3)}</td>
    `;
    $tbody.appendChild(tr);
  });
}

let cache = [];

/**
 * @param {HTMLElement} container
 * @param {{ definition?: string, chartTitle?: string, footNote?: string, points: { year: number, value: number, n: number, population?: number }[] }} series
 */
function renderGlobalAverageChart(container, series) {
  container.replaceChildren();
  if ($globalDef) {
    $globalDef.textContent = series?.definition?.trim() ?? "";
  }
  if ($globalFoot) {
    $globalFoot.hidden = true;
    $globalFoot.textContent = "";
  }

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
  const fmt = (v) => v.toFixed(4);

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
    const span0 = y1 - y0 || 1;
    lab.textContent = span0 < 0.05 ? v.toFixed(4) : v.toFixed(2);
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

  const title = document.createElementNS(ns, "text");
  title.setAttribute("x", String(padL + innerW * 0.5));
  title.setAttribute("y", String(padT - 2));
  title.setAttribute("text-anchor", "middle");
  title.setAttribute("class", "global-series-heading");
  title.textContent = series?.chartTitle?.trim() || "Global average (time series)";
  svg.appendChild(title);

  container.appendChild(svg);

  if ($globalFoot) {
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

async function loadLocalData() {
  setStatus("");
  const res = await fetch(`${import.meta.env.BASE_URL}data/countries.json`);
  if (!res.ok) {
    throw new Error(
      `Missing public/data/countries.json (${res.status}). Run: npm run build-data`
    );
  }
  const payload = await res.json();
  cache = payload.countries ?? [];
  const n = cache.length;
  const when = payload.generatedAt
    ? ` Snapshot: ${new Date(payload.generatedAt).toLocaleString()}.`
    : "";
  setStatus(
    n
      ? `${n} leaderboard rows.${when}`
      : "No rows in data file."
  );
  updateHeaderSortUI();
  renderTable(getSortedCache());
  renderGlobalAverageChart(
    $globalChart,
    payload.globalAverageSeries ?? { points: [] }
  );
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

loadLocalData().catch((e) => {
  console.error(e);
  setStatus(e instanceof Error ? e.message : "Could not load data.", true);
});

/** @typedef {{ iso: string, name: string, leYear: number|string, le: number, haleYear?: number|string, hale?: number, gniYear: number|string, gni: number, homicideYear: number|string, homicidesPer100k: number, customIndex: number, derivedKind?: string, memberCount?: number }} CountryRow */
