/**
 * World Bank indicators (align with UNDP-style income: PPP constant 2021 intl $).
 * @see https://data.worldbank.org/indicator/NY.GNP.PCAP.PP.KD
 */
const WB_LE = "SP.DYN.LE00.IN";
const WB_GNI = "NY.GNP.PCAP.PP.KD";

/** Small pages + `mrnev=1` keep responses fast (avoids proxy 502 on huge payloads). */
const WB_PER_PAGE = "500";

/**
 * World Bank JSON API base. Uses same-origin `/worldbank` when the dev/preview server
 * (or host) proxies to api.worldbank.org — avoids browser CORS "Failed to fetch".
 */
function worldBankApiOrigin() {
  const base = new URL(import.meta.env.BASE_URL || "/", window.location.href);
  return new URL("worldbank/", base);
}

const $status = document.getElementById("status");
const $tbody = document.getElementById("tbody");
const $filter = document.getElementById("filter");
const $btnRefresh = document.getElementById("btn-refresh");
const $fileCsv = document.getElementById("file-csv");

/** Same math as your Python `custom_hdi_no_education`. */
function customHdiNoEducation(lifeExpectancy, gniPerCapita) {
  const le = Math.max(20, Math.min(Number(lifeExpectancy), 85));
  const gni = Math.max(100, Math.min(Number(gniPerCapita), 75000));
  const lei = (le - 20) / 65;
  const incomeIndex =
    (Math.log(gni) - Math.log(100)) / (Math.log(75000) - Math.log(100));
  const customIndex = Math.sqrt(lei * incomeIndex);
  return Math.round(customIndex * 1000) / 1000;
}

function isCountryRow(row) {
  const iso = row.countryiso3code;
  return typeof iso === "string" && /^[A-Z]{3}$/.test(iso);
}

/**
 * @param {string} urlString
 * @param {string} indicator
 * @returns {Promise<[meta: { pages?: number }, data: WbRow[] | null]>}
 */
async function fetchWorldBankJson(urlString, indicator) {
  const maxAttempts = 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(urlString);
    if (res.ok) {
      return res.json();
    }
    const retry =
      res.status === 502 || res.status === 503 || res.status === 504 || res.status === 429;
    if (retry && attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      continue;
    }
    throw new Error(`World Bank request failed (${res.status}) for ${indicator}`);
  }
  throw new Error(`World Bank request failed for ${indicator}`);
}

/**
 * @param {string} indicator
 * @param {{ useMrnev: boolean }} opts
 */
async function fetchAllPagesInner(indicator, opts) {
  const out = [];
  let page = 1;
  const apiRoot = worldBankApiOrigin();
  for (;;) {
    const url = new URL(`v2/country/all/indicator/${encodeURIComponent(indicator)}`, apiRoot);
    url.searchParams.set("format", "json");
    url.searchParams.set("per_page", WB_PER_PAGE);
    url.searchParams.set("page", String(page));
    if (opts.useMrnev) {
      url.searchParams.set("mrnev", "1");
    }

    const json = await fetchWorldBankJson(url.toString(), indicator);
    const [meta, data] = json;
    if (!data?.length) break;
    out.push(...data);
    const pages = meta?.pages ?? 1;
    if (page >= pages) break;
    page += 1;
  }
  return out;
}

/** @param {string} indicator */
async function fetchAllPages(indicator) {
  try {
    return await fetchAllPagesInner(indicator, { useMrnev: true });
  } catch (e) {
    console.warn(`mrnev=1 request failed for ${indicator}, falling back to paged history`, e);
    return await fetchAllPagesInner(indicator, { useMrnev: false });
  }
}

/**
 * Latest non-null observation per ISO3 country.
 * @param {WbRow[]} rows
 * @returns {Map<string, { year: number, value: number, name: string }>}
 */
function latestByCountry(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!isCountryRow(r) || r.value == null) continue;
    const iso = r.countryiso3code;
    const year = parseInt(String(r.date), 10);
    if (Number.isNaN(year)) continue;
    const value = Number(r.value);
    const name = r.country?.value ?? iso;
    const prev = map.get(iso);
    if (!prev || year > prev.year) {
      map.set(iso, { year, value, name });
    }
  }
  return map;
}

function mergeRows(leMap, gniMap) {
  /** @type {CountryRow[]} */
  const merged = [];
  for (const [iso, le] of leMap) {
    const gni = gniMap.get(iso);
    if (!gni) continue;
    const score = customHdiNoEducation(le.value, gni.value);
    merged.push({
      iso,
      name: le.name || gni.name,
      leYear: le.year,
      le: le.value,
      gniYear: gni.year,
      gni: gni.value,
      customHdi: score,
    });
  }
  merged.sort((a, b) => b.customHdi - a.customHdi);
  return merged;
}

function renderTable(rows, filterText) {
  const q = filterText.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.iso.toLowerCase().includes(q))
    : rows;

  $tbody.replaceChildren();
  if (!filtered.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.className = "empty";
    td.textContent = rows.length ? "No countries match your filter." : "No data.";
    tr.appendChild(td);
    $tbody.appendChild(tr);
    return;
  }

  filtered.forEach((r) => {
    const rank = rows.indexOf(r) + 1;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${rank}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${r.leYear}</td>
      <td>${r.le.toFixed(1)}</td>
      <td>${r.gniYear}</td>
      <td>${formatInt(r.gni)}</td>
      <td>${r.customHdi.toFixed(3)}</td>
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

async function loadFromWorldBank() {
  setStatus("Fetching life expectancy…");
  const leRows = await fetchAllPages(WB_LE);
  setStatus("Fetching GNI per capita…");
  const gniRows = await fetchAllPages(WB_GNI);

  const leMap = latestByCountry(leRows);
  const gniMap = latestByCountry(gniRows);
  cache = mergeRows(leMap, gniMap);

  const n = cache.length;
  setStatus(
    n
      ? `Showing ${n} countries. Latest years per indicator may differ — see columns.`
      : "No overlapping country data."
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
  const iGni = header.indexOf("GNI_per_capita");
  if (iCountry < 0 || iLe < 0 || iGni < 0) {
    throw new Error('Expected columns: Country, Life_Expectancy, GNI_per_capita');
  }

  /** @type {CountryRow[]} */
  const out = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = splitCsvLine(lines[li]);
    if (cols.length < header.length) continue;
    const name = cols[iCountry]?.trim();
    const le = parseFloat(cols[iLe]);
    const gni = parseFloat(cols[iGni]);
    if (!name || Number.isNaN(le) || Number.isNaN(gni)) continue;
    out.push({
      iso: "---",
      name,
      leYear: "—",
      le,
      gniYear: "—",
      gni,
      customHdi: customHdiNoEducation(le, gni),
    });
  }
  out.sort((a, b) => b.customHdi - a.customHdi);
  return out;
}

/** Minimal CSV split (handles quoted fields). */
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

$btnRefresh.addEventListener("click", async () => {
  $btnRefresh.disabled = true;
  document.querySelector(".table-wrap")?.classList.add("loading");
  try {
    await loadFromWorldBank();
  } catch (e) {
    console.error(e);
    setStatus(
      e instanceof Error
        ? e.message
        : "Could not load World Bank data. Check your connection or try a CSV upload.",
      true
    );
    $tbody.replaceChildren();
  } finally {
    $btnRefresh.disabled = false;
    document.querySelector(".table-wrap")?.classList.remove("loading");
  }
});

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

loadFromWorldBank().catch((e) => {
  console.error(e);
  const detail = e instanceof Error ? e.message : String(e);
  const hint =
    e instanceof TypeError && String(e.message).toLowerCase().includes("fetch")
      ? " If you opened dist/index.html as a file, run npm run dev or npm run preview (needs the API proxy)."
      : "";
  setStatus(`Could not load World Bank data: ${detail}.${hint} You can use “Or load CSV”.`, true);
});

/** @typedef {{ countryiso3code: string, country: { value: string }, date: string, value: number | null }} WbRow */
/** @typedef {{ iso: string, name: string, leYear: number|string, le: number, gniYear: number|string, gni: number, customHdi: number }} CountryRow */
