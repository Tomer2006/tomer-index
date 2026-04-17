import { escapeHtml, formatInt } from "./format.js";

const $status = document.getElementById("status");
const $tbody = document.getElementById("tbody");

const COLS = 7;

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
  renderTable(cache);
}

function setStatus(msg, isError = false) {
  $status.textContent = msg;
  $status.classList.toggle("error", isError);
}

loadLocalData().catch((e) => {
  console.error(e);
  setStatus(e instanceof Error ? e.message : "Could not load data.", true);
});

/** @typedef {{ iso: string, name: string, leYear: number|string, le: number, haleYear?: number|string, hale?: number, gniYear: number|string, gni: number, homicideYear: number|string, homicidesPer100k: number, customIndex: number }} CountryRow */
