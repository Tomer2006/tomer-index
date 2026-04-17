import { customIndexHealthIncomeSafety } from "./hdi-core.js";

const $status = document.getElementById("status");
const $tbody = document.getElementById("tbody");
const $filter = document.getElementById("filter");
const $fileCsv = document.getElementById("file-csv");

const COLS = 7;

function renderTable(rows, filterText) {
  const q = filterText.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.iso.toLowerCase().includes(q))
    : rows;

  $tbody.replaceChildren();
  if (!filtered.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = COLS;
    td.className = "empty";
    td.textContent = rows.length ? "No countries match your filter." : "No data.";
    tr.appendChild(td);
    $tbody.appendChild(tr);
    return;
  }

  filtered.forEach((r) => {
    const rank = rows.indexOf(r) + 1;
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

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatInt(n) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.round(n));
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
      ? `${n} countries from bundled data.${when}`
      : "No countries in data file."
  );
  renderTable(cache, $filter.value);
}

function setStatus(msg, isError = false) {
  $status.textContent = msg;
  $status.classList.toggle("error", isError);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) throw new Error("CSV needs a header and at least one row.");

  const header = lines[0].split(",").map((h) => h.trim());
  const iCountry = header.indexOf("Country");
  const iLe = header.indexOf("Life_Expectancy");
  const iHale = header.indexOf("HALE");
  const iGni = header.indexOf("GNI_per_capita");
  const iHom = header.indexOf("Homicides_per_100k");
  if (iCountry < 0 || iLe < 0 || iHale < 0 || iGni < 0 || iHom < 0) {
    throw new Error(
      "Expected columns: Country, Life_Expectancy, HALE, GNI_per_capita, Homicides_per_100k"
    );
  }

  const out = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = splitCsvLine(lines[li]);
    if (cols.length < header.length) continue;
    const name = cols[iCountry]?.trim();
    const le = parseFloat(cols[iLe]);
    const hale = parseFloat(cols[iHale]);
    const gni = parseFloat(cols[iGni]);
    const hom = parseFloat(cols[iHom]);
    if (
      !name ||
      Number.isNaN(le) ||
      Number.isNaN(hale) ||
      Number.isNaN(gni) ||
      Number.isNaN(hom)
    ) {
      continue;
    }
    out.push({
      iso: "---",
      name,
      leYear: "—",
      le,
      haleYear: "—",
      hale,
      gniYear: "—",
      gni,
      homicideYear: "—",
      homicidesPer100k: hom,
      customIndex: customIndexHealthIncomeSafety(le, gni, hom, hale),
    });
  }
  out.sort((a, b) => b.customIndex - a.customIndex);
  return out;
}

function splitCsvLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if ((c === "," && !inQuotes) || (c === "\r" && !inQuotes)) {
      result.push(cur);
      cur = "";
    } else if (c !== "\r") {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

$filter.addEventListener("input", () => renderTable(cache, $filter.value));

$fileCsv.addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  ev.target.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    cache = parseCsv(text);
    setStatus(`Loaded ${cache.length} rows from ${file.name}.`);
    renderTable(cache, $filter.value);
  } catch (e) {
    console.error(e);
    setStatus(e instanceof Error ? e.message : "Invalid CSV", true);
  }
});

loadLocalData().catch((e) => {
  console.error(e);
  setStatus(e instanceof Error ? e.message : "Could not load data.", true);
});

/** @typedef {{ iso: string, name: string, leYear: number|string, le: number, haleYear?: number|string, hale?: number, gniYear: number|string, gni: number, homicideYear: number|string, homicidesPer100k: number, customIndex: number }} CountryRow */
