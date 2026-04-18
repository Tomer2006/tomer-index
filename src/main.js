import { escapeHtml, formatInt } from "./format.js";

const $status = document.getElementById("status");
const $tbody = document.getElementById("tbody");

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
      ? `${n} countries.${when}`
      : "No countries in data file."
  );
  updateHeaderSortUI();
  renderTable(getSortedCache());
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

/** @typedef {{ iso: string, name: string, leYear: number|string, le: number, haleYear?: number|string, hale?: number, gniYear: number|string, gni: number, homicideYear: number|string, homicidesPer100k: number, customIndex: number }} CountryRow */
