/**
 * Fetches World Bank indicators, WHO GHO HALE and UCDP war deaths and writes the web data
 * files (public/data/leaderboard.json + series.json, minified) plus a full
 * pretty-printed archive payload (data-archive/countries.json, not shipped).
 * Run: npm run build-data (needs network once; commit the JSON for offline builds).
 *
 * Every request is retried with backoff and must return a complete, error-free
 * payload, otherwise the build fails. Before writing, the result is compared with
 * the committed public/data files and nothing is written if coverage shrinks
 * (pass --force to write anyway). HFI_FILE=<path> reads the Human Freedom Index
 * from a browser-downloaded JSON or CSV file instead of the bot-protected URL, and
 * UCDP_GED_FILE=<path> reads the UCDP event data from a downloaded .zip or .csv.
 *
 * Importing this module only defines the helpers (for tests); the build runs only
 * when the file is executed directly.
 */
import { readFile, writeFile, mkdir, rename, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";

import {
  latestByCountry,
  mergeRows,
  byCountryYear,
  incomeRowsWithGdpFallback,
  haleHistoryByIso,
  dropLifeExpectancyBelowHale,
  LE_BELOW_HALE_MAX,
  adjustedHaleAsOfYear,
  customIndexAbundanceSafetyHealthFreedom,
  customIndexFromPillarsFull,
  combinedHealthLei,
  incomeIndexFromGni,
  safetyIndexFromHomicidesPer100k,
  freedomIndexFromScore,
  warDeathRows,
  INDEX_WEIGHTS,
} from "../src/hdi-core.js";
import { YEAR_MAX, YEAR_MIN } from "../src/site-years.js";
import { fetchUcdpWarDeaths, UCDP_GED_URL, UCDP_GED_VERSION } from "./ucdp-ged.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = join(ROOT, "public", "data");
const ARCHIVE_DIR = join(ROOT, "data-archive");
const OUT = join(ARCHIVE_DIR, "countries.json");
const LEADERBOARD_OUT = join(DATA_DIR, "leaderboard.json");
const SERIES_OUT = join(DATA_DIR, "series.json");

const WB_BASE = "https://api.worldbank.org";
const WB_LE = "SP.DYN.LE00.IN";
const WB_GNI = "NY.GNP.PCAP.PP.KD";
const WB_GDP = "NY.GDP.PCAP.PP.KD";
/** Intentional homicides per 100,000 (UNODC via WDI). */
const WB_HOMICIDE = "VC.IHR.PSRC.P5";
/** Road traffic deaths per 100,000 (WHO estimates via WDI). */
const WB_ROAD = "SH.STA.TRAF.P5";
/** Total population — weights the global time series. */
const WB_POP = "SP.POP.TOTL";
const WB_PER_PAGE = "500";

/** Cato/Fraser Human Freedom Index 2025, column-oriented JSON. */
const HFI_URL =
  "https://www.cato.org/sites/cato.org/files/human-freedom-index-files/2025-human-freedom-index.json";
const HFI_FREEDOM_COMPONENTS = [
  "pf_rol",
  "pf_movement",
  "pf_religion",
  "pf_assembly",
  "pf_expression",
  "pf_identity",
];

/** WHO GHO: Healthy life expectancy (HALE) at birth, both sexes. This is the only non-World Bank source. */
const WHO_HALE_URL = "https://ghoapi.azureedge.net/api/WHOSIS_000002";
const WHO_HALE_FILTER = "SpatialDimType eq 'COUNTRY' and Dim1 eq 'SEX_BTSX'";
/** WHO GHO OData max `$top` is 1000 per request. */
const WHO_PAGE_SIZE = 1000;
/** WHO publishes HALE for ~185 countries; far fewer means a broken response. */
const WHO_HALE_MIN_COUNTRIES = 150;

/** Per attempt; without it a stalled request would hang for undici's 5-minute default. */
const REQUEST_TIMEOUT_MS = 60_000;
const REQUEST_ATTEMPTS = 5;
const RETRY_DELAY_MS = 1000;

/**
 * Committed data is replaced only if no coverage figure drops by more than this
 * share (see `sanityProblems`); `--force` overrides.
 */
export const SHRINK_TOLERANCE = 0.02;

/**
 * World Bank residual classifications: lending type LNX and income level INX are both
 * named "Not classified" and aren't meaningful peer groups, so they never become group rows.
 */
export const UNCLASSIFIED_GROUP_IDS = new Set(["LNX", "INX"]);

function isTransientStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

/** The World Bank API answers valid requests with sporadic HTTP 400s, so those are retried too. */
function isTransientWorldBankStatus(status) {
  return status === 400 || isTransientStatus(status);
}

function textSnippet(text) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
}

/**
 * GET a JSON document. Network errors, timeouts, unparsable bodies, error payloads
 * (`validate` returns a message) and transient HTTP statuses (`retryStatus`; by default
 * 408, 429, 5xx) are retried with exponential backoff; other non-2xx statuses fail at
 * once. Never resolves with an error body.
 */
export async function fetchJsonWithRetry(
  url,
  {
    label,
    validate = () => null,
    retryStatus = isTransientStatus,
    attempts = REQUEST_ATTEMPTS,
    timeoutMs = REQUEST_TIMEOUT_MS,
    retryDelayMs = RETRY_DELAY_MS,
    fetchImpl = globalThis.fetch,
  } = {}
) {
  let lastError = null;
  let attempt = 0;
  while (attempt < attempts) {
    attempt += 1;
    let retryable = true;
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) {
        retryable = retryStatus(res.status);
        throw new Error(`HTTP ${res.status}`);
      }
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`response is not JSON: ${textSnippet(text)}`);
      }
      const problem = validate(json);
      if (problem) throw new Error(problem);
      return json;
    } catch (error) {
      lastError = error;
      if (!retryable) break;
    }
    if (attempt < attempts) {
      await new Promise((r) => setTimeout(r, retryDelayMs * 2 ** (attempt - 1)));
    }
  }
  throw new Error(
    `${label} request failed after ${attempt} attempt${attempt === 1 ? "" : "s"}: ${lastError?.message} (${url})`,
    { cause: lastError }
  );
}

/**
 * World Bank API v2 answers errors with HTTP 200 and `[{ message: [...] }]`; a valid page
 * is `[meta, rows]`. Returns the problem as text, or null for a valid page.
 */
export function worldBankPayloadError(json) {
  if (!Array.isArray(json)) return "World Bank response is not a JSON array";
  const messages = json[0]?.message;
  if (messages) {
    const text = (Array.isArray(messages) ? messages : [messages])
      .map((m) =>
        typeof m === "object" ? [m?.id, m?.key, m?.value].filter(Boolean).join(" ") : m
      )
      .join("; ");
    return `World Bank error: ${text || "unspecified"}`;
  }
  if (json.length < 2 || typeof json[0] !== "object" || json[0] === null) {
    return "World Bank response has no page metadata";
  }
  return null;
}

/** OData error bodies are `{ error: { message } }`; a valid page has a `value` array. */
export function whoPayloadError(json) {
  if (Array.isArray(json?.value)) return null;
  const message = json?.error?.message;
  return message ? `WHO GHO error: ${message}` : "WHO GHO response has no value array";
}

/**
 * Every row of a paged World Bank API v2 list. Throws unless each page is valid and the
 * rows add up to the `total` the API announced.
 */
export async function fetchWorldBankPages(path, params, label, http = {}) {
  const out = [];
  let expected = null;
  for (let page = 1; ; page++) {
    const url = new URL(`${WB_BASE}${path}`);
    url.searchParams.set("format", "json");
    for (const [key, value] of Object.entries(params)) {
      if (value != null) url.searchParams.set(key, value);
    }
    url.searchParams.set("page", String(page));

    const [meta, data] = await fetchJsonWithRetry(url.toString(), {
      label,
      validate: worldBankPayloadError,
      retryStatus: isTransientWorldBankStatus,
      ...http,
    });
    const pages = Number(meta.pages);
    const total = Number(meta.total);
    if (!Number.isInteger(pages) || !Number.isInteger(total)) {
      throw new Error(`${label}: page ${page} has no page count or total`);
    }
    if (expected && (pages !== expected.pages || total !== expected.total)) {
      throw new Error(
        `${label}: the dataset changed while paging (${expected.total} rows/${expected.pages} pages, then ${total}/${pages})`
      );
    }
    expected = { pages, total };
    if (page <= pages && !data?.length) {
      throw new Error(`${label}: page ${page} of ${pages} has no rows`);
    }
    if (data?.length) out.push(...data);
    if (page >= pages) break;
  }
  if (!out.length) throw new Error(`${label}: the World Bank returned no rows`);
  if (out.length !== expected.total) {
    throw new Error(`${label}: received ${out.length} of ${expected.total} rows`);
  }
  return out;
}

/** Every row matching an OData filter from the WHO GHO HALE endpoint, in a stable order. */
export async function fetchWhoPages(filter, orderBy, label, http = {}) {
  const out = [];
  for (let skip = 0; ; skip += WHO_PAGE_SIZE) {
    /** OData $-params: build query string manually (URLSearchParams mishandles $ keys in some runtimes). */
    const qs = [
      `$filter=${encodeURIComponent(filter)}`,
      `$orderby=${orderBy}`,
      `$top=${WHO_PAGE_SIZE}`,
      `$skip=${skip}`,
      "$format=json",
    ].join("&");
    const json = await fetchJsonWithRetry(`${WHO_HALE_URL}?${qs}`, {
      label,
      validate: whoPayloadError,
      ...http,
    });
    out.push(...json.value);
    if (json.value.length < WHO_PAGE_SIZE) break;
  }
  return out;
}

/**
 * WDI `date=` upper bound (inclusive). Capped at the site's YEAR_MAX so observations newer
 * than the display window (e.g. fresh 2024/2025 vintages that are still being revised) can
 * never reach any output — not even through the latest-observation fallback paths
 * (`latestByCountry` → `mergeRows` → `customHdi`, and the derived-group inputs). Bumping
 * YEAR_MAX in src/site-years.js widens the fetch automatically.
 */
const WDI_END_YEAR = YEAR_MAX;
const DATE_RANGE = `${YEAR_MIN}:${WDI_END_YEAR}`;
const DATE_RANGE_POP = `${YEAR_MIN}:${WDI_END_YEAR}`;
const SERIES_YEAR_MIN = YEAR_MIN;
const SERIES_YEAR_MAX = YEAR_MAX;
const SERIES_RANGE_LABEL = `${SERIES_YEAR_MIN}-${SERIES_YEAR_MAX}`;

const WORLD_BANK_INPUTS = {
  lifeExpectancy: {
    indicator: WB_LE,
    label: "Life expectancy at birth, total (years)",
    dateRange: DATE_RANGE,
  },
  gniPerCapita: {
    indicator: WB_GNI,
    label: "GNI per capita, PPP (constant 2021 international $)",
    dateRange: DATE_RANGE,
  },
  gdpPerCapita: {
    indicator: WB_GDP,
    label: "GDP per capita, PPP (constant 2021 international $; only extends GNI)",
    dateRange: DATE_RANGE,
  },
  intentionalHomicidesPer100k: {
    indicator: WB_HOMICIDE,
    label: "Intentional homicides (per 100,000 people)",
    dateRange: DATE_RANGE,
  },
  roadDeathsPer100k: {
    indicator: WB_ROAD,
    label: "Mortality caused by road traffic injury (per 100,000 population)",
    dateRange: DATE_RANGE,
  },
  population: {
    indicator: WB_POP,
    label: "Population, total",
    dateRange: DATE_RANGE_POP,
  },
};

/**
 * Personal-freedom rows from, in order: the HFI_FILE override, the HFI download, or (when
 * the download fails, as it does whenever the site serves its bot challenge) the exact-year
 * freedom observations stored in the committed series.json. The cached fallback is loud,
 * records when its data was retrieved, and `cachedFreedomLosses` stops a build that would
 * drop any of it.
 * @param {object | null} committedSeries — parsed public/data/series.json, or null
 * @param {string} generatedAt — this build's timestamp
 */
export async function fetchHfiPersonalFreedom(committedSeries, generatedAt, http = {}) {
  const file = process.env.HFI_FILE;
  if (file) {
    // An explicit override never falls back: a bad file must stop the build.
    const rows = hfiRowsFromColumns(hfiColumnsFromText(await readFile(file, "utf8")));
    if (!rows.length) throw new Error(`HFI_FILE ${file} has no usable personal-freedom rows`);
    console.log(`Human Freedom Index read from HFI_FILE (${rows.length} observations).`);
    return {
      rows,
      status: "file",
      file: basename(file),
      retrievedAt: (await stat(file)).mtime.toISOString(),
    };
  }
  try {
    const data = await fetchJsonWithRetry(HFI_URL, {
      label: "Human Freedom Index",
      attempts: 2,
      validate: (json) =>
        json?.year && typeof json.year === "object" ? null : "response has no year column",
      ...http,
    });
    const rows = hfiRowsFromColumns(data);
    if (!rows.length) throw new Error("Human Freedom Index download has no usable rows");
    return { rows, status: "downloaded", retrievedAt: generatedAt };
  } catch (error) {
    const rows = cachedHfiRows(committedSeries);
    if (!rows.length) throw error;
    const previous = committedSeries.sourceRefresh?.humanFreedomIndex;
    const retrievedAt =
      previous?.retrievedAt ??
      (previous?.status === "downloaded" ? committedSeries.generatedAt : null);
    const countries = new Set(rows.map((row) => row.countryiso3code)).size;
    console.warn(
      [
        "",
        "!!! WARNING: Human Freedom Index download failed — reusing committed freedom data.",
        `!!! Reason: ${error.message}`,
        `!!! Reusing ${rows.length} observations for ${countries} countries from series.json (built ${committedSeries.generatedAt ?? "unknown"}).`,
        `!!! HFI data originally retrieved: ${retrievedAt ?? "unknown (before that build)"}.`,
        "!!! New or revised HFI values are not included. To refresh, download the HFI JSON or",
        "!!! CSV in a browser and rerun with HFI_FILE=<path>.",
        "",
      ].join("\n")
    );
    return {
      rows,
      status: "cached",
      retrievedAt,
      cachedFrom: committedSeries.generatedAt,
      reason: error.message,
    };
  }
}

/** Exact-year freedom observations a previous build stored in series.json. */
export function cachedHfiRows(series) {
  const rows = [];
  for (const [iso, entry] of Object.entries(series?.entrySeries ?? {})) {
    if (!/^[A-Z]{3}$/.test(iso)) continue;
    for (const point of entry.points ?? []) {
      if (
        point.freedomYear === point.year &&
        Number.isFinite(point.freedom) &&
        point.year >= YEAR_MIN &&
        point.year <= YEAR_MAX
      ) {
        rows.push({
          countryiso3code: iso,
          date: String(point.year),
          value: point.freedom,
          country: { value: iso },
        });
      }
    }
  }
  return rows;
}

/**
 * ISO codes whose reused freedom observations would be missing from the new series. Writing
 * such a build would lose them for good, since the next fallback reads this build's output.
 */
export function cachedFreedomLosses(cachedRows, entrySeries) {
  const lost = new Set();
  for (const row of cachedRows) {
    const year = Number(row.date);
    const point = entrySeries[row.countryiso3code]?.points?.find((p) => p.year === year);
    if (point?.freedomYear !== year || point.freedom !== row.value) {
      lost.add(row.countryiso3code);
    }
  }
  return [...lost].sort();
}

const HFI_MISSING_CELLS = new Set(["", "-", "NA", "N/A", ".."]);
const HFI_CSV_ALIASES = { iso_code: "iso", iso3: "iso", country: "countries" };

/**
 * An HFI file (the column-oriented JSON download, or the CSV export) as the JSON's
 * `{ field: { rowKey: value } }` shape. CSV gaps become null, like the JSON's.
 */
export function hfiColumnsFromText(text) {
  const source = String(text).replace(/^\uFEFF/, "");
  if (source.trimStart().startsWith("{")) return JSON.parse(source);
  const [header = [], ...records] = parseCsv(source);
  const columns = {};
  header.forEach((rawName, index) => {
    const name = rawName.trim().toLowerCase();
    const field = HFI_CSV_ALIASES[name] ?? name;
    if (!field || columns[field]) return;
    columns[field] = {};
    records.forEach((record, row) => {
      const cell = (record[index] ?? "").trim();
      columns[field][row] = HFI_MISSING_CELLS.has(cell.toUpperCase()) ? null : cell;
    });
  });
  return columns;
}

function parseCsv(text) {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== "\"") field += ch;
      else if (text[i + 1] === "\"") field += text[++i];
      else quoted = false;
    } else if (ch === "\"") {
      quoted = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field || record.length) {
    record.push(field);
    records.push(record);
  }
  return records.filter((r) => r.some((cell) => cell.trim()));
}

/** HFI column-oriented data → WDI-style personal-freedom rows (0–100). */
export function hfiRowsFromColumns(data) {
  const rows = [];
  for (const key of Object.keys(data.year ?? {})) {
    const year = Number(data.year[key]);
    const iso = data.iso?.[key];
    // Respect the HFI's own coverage decision: JSON null must remain missing,
    // never become Number(null) === 0.
    if (data.pf_score?.[key] == null) continue;
    const components = HFI_FREEDOM_COMPONENTS
      .map((field) => data[field]?.[key])
      .filter((value) => value != null)
      .map(Number)
      .filter(Number.isFinite);
    if (components.length < 5) continue;
    const value =
      (components.reduce((sum, component) => sum + component, 0) / components.length) * 10;
    if (
      !Number.isInteger(year) ||
      year < YEAR_MIN ||
      year > YEAR_MAX ||
      typeof iso !== "string" ||
      !/^[A-Z]{3}$/.test(iso) ||
      !Number.isFinite(value)
    ) {
      continue;
    }
    rows.push({
      countryiso3code: iso,
      date: String(year),
      value,
      country: { value: data.countries?.[key] ?? iso },
    });
  }
  return rows;
}

function yearWindowFromRange(range) {
  const m = /^(\d{4}):(\d{4})$/.exec(range.trim());
  if (!m) throw new Error(`Invalid DATE_RANGE: ${range}`);
  return { yearMin: Number(m[1]), yearMax: Number(m[2]) };
}

export async function fetchAllPages(
  indicator,
  dateRange = DATE_RANGE,
  source = null,
  http = {}
) {
  return fetchWorldBankPages(
    `/v2/country/all/indicator/${encodeURIComponent(indicator)}`,
    { date: dateRange, per_page: WB_PER_PAGE, source },
    `World Bank ${indicator}`,
    http
  );
}

export function summarizeWorldBankRows(rows, expectedIndicator) {
  const countries = new Set();
  let earliestYear = Infinity;
  let latestYear = -Infinity;
  for (const row of rows) {
    const rowIndicator = row?.indicator?.id;
    if (rowIndicator && rowIndicator !== expectedIndicator) {
      throw new Error(
        `Expected World Bank indicator ${expectedIndicator}, got ${rowIndicator}`
      );
    }
    if (row.value == null || Number.isNaN(Number(row.value))) continue;
    const iso = row.countryiso3code;
    const year = parseInt(String(row.date), 10);
    if (typeof iso === "string" && /^[A-Z]{3}$/.test(iso)) countries.add(iso);
    if (!Number.isNaN(year)) {
      earliestYear = Math.min(earliestYear, year);
      latestYear = Math.max(latestYear, year);
    }
  }
  return {
    rows: rows.length,
    countriesWithValues: countries.size,
    earliestYear: Number.isFinite(earliestYear) ? earliestYear : null,
    latestYear: Number.isFinite(latestYear) ? latestYear : null,
  };
}

async function fetchAllWorldBankInputs(http = {}) {
  console.log("Downloading all World Bank inputs first ...");
  const entries = await Promise.all(
    Object.entries(WORLD_BANK_INPUTS).map(async ([key, spec]) => {
      console.log("Fetching", spec.indicator, "...");
      const rows = await fetchAllPages(spec.indicator, spec.dateRange, spec.source, http);
      return [key, { ...spec, rows }];
    })
  );
  console.log("Fetching World Bank country metadata ...");
  const countryMeta = await fetchWorldBankCountryMeta(http);
  const data = Object.fromEntries(entries);
  const summary = Object.fromEntries(
    entries.map(([key, item]) => [
      key,
      {
        source: "World Bank WDI",
        indicator: item.indicator,
        label: item.label,
        dateRange: item.dateRange,
        ...summarizeWorldBankRows(item.rows, item.indicator),
      },
    ])
  );
  return {
    data,
    countryMeta,
    summary: {
      downloadedFirst: true,
      countryMetadata: {
        source: "World Bank country metadata",
        countriesWithMetadata: countryMeta.size,
      },
      series: summary,
    },
  };
}

/** Latest HALE (years) per ISO3 from WHO GHO rows. */
export function latestHaleByIso(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r.SpatialDimType !== "COUNTRY" || r.Dim1 !== "SEX_BTSX") continue;
    if (r.NumericValue == null || Number.isNaN(Number(r.NumericValue))) continue;
    const iso = r.SpatialDim;
    if (typeof iso !== "string" || !/^[A-Z]{3}$/.test(iso)) continue;
    const year = r.TimeDim;
    const value = Number(r.NumericValue);
    const prev = map.get(iso);
    if (!prev || year > prev.year) {
      map.set(iso, { year, value, name: iso });
    }
  }
  return map;
}

/**
 * WHO country HALE rows, ordered so `$skip` paging can't skip or repeat rows. Throws on any
 * failed page and when far fewer countries than WHO publishes come back.
 */
export async function fetchAllWhoHale({
  minCountries = WHO_HALE_MIN_COUNTRIES,
  ...http
} = {}) {
  const rows = await fetchWhoPages(WHO_HALE_FILTER, "SpatialDim,TimeDim", "WHO GHO HALE", http);
  const countries = new Set(
    rows.filter((r) => r.NumericValue != null).map((r) => r.SpatialDim)
  ).size;
  if (countries < minCountries) {
    throw new Error(
      `WHO GHO returned HALE for only ${countries} countries (expected at least ${minCountries})`
    );
  }
  return rows;
}

/**
 * WHO country HALE rows from the GHO download or, when it fails (from late October 2026
 * the API answered every request with HTTP 500), the exact WHO observations stored in the
 * committed series.json. Like the HFI fallback, it is loud, records when its data was
 * retrieved, and `cachedHaleLosses` stops a build that would drop any of it.
 * @param {object | null} committedSeries — parsed public/data/series.json, or null
 * @param {string} generatedAt — this build's timestamp
 */
export async function fetchWhoHaleOrCached(committedSeries, generatedAt, http = {}) {
  try {
    return { rows: await fetchAllWhoHale(http), status: "downloaded", retrievedAt: generatedAt };
  } catch (error) {
    const rows = cachedHaleRows(committedSeries);
    if (!rows.length) throw error;
    const previous = committedSeries.sourceRefresh?.whoHale;
    const retrievedAt =
      previous?.retrievedAt ??
      (previous?.status === "downloaded" ? committedSeries.generatedAt : null);
    const countries = new Set(rows.map((row) => row.SpatialDim)).size;
    console.warn(
      [
        "",
        "!!! WARNING: WHO GHO HALE download failed — reusing committed HALE data.",
        `!!! Reason: ${error.message}`,
        `!!! Reusing ${rows.length} observations for ${countries} countries from series.json (built ${committedSeries.generatedAt ?? "unknown"}).`,
        `!!! WHO data originally retrieved: ${retrievedAt ?? "unknown (before that build)"}.`,
        "!!! New or revised WHO values are not included; rerun once the GHO API answers.",
        "",
      ].join("\n")
    );
    return {
      rows,
      status: "cached",
      retrievedAt,
      cachedFrom: committedSeries.generatedAt,
      reason: error.message,
    };
  }
}

/** Exact-year WHO HALE observations a previous build stored in series.json, as GHO rows. */
export function cachedHaleRows(series) {
  const rows = [];
  for (const [iso, entry] of Object.entries(series?.entrySeries ?? {})) {
    if (!/^[A-Z]{3}$/.test(iso)) continue;
    for (const point of entry.points ?? []) {
      if (
        point.haleYear === point.year &&
        !point.haleEstimated &&
        Number.isFinite(point.hale)
      ) {
        rows.push({
          SpatialDimType: "COUNTRY",
          SpatialDim: iso,
          Dim1: "SEX_BTSX",
          TimeDim: point.year,
          NumericValue: point.hale,
        });
      }
    }
  }
  return rows;
}

/** ISO codes whose reused HALE observations would be missing from the new series. */
export function cachedHaleLosses(cachedRows, entrySeries) {
  const lost = new Set();
  for (const row of cachedRows) {
    const point = entrySeries[row.SpatialDim]?.points?.find((p) => p.year === row.TimeDim);
    if (point?.haleYear !== row.TimeDim || point.hale !== row.NumericValue) {
      lost.add(row.SpatialDim);
    }
  }
  return [...lost].sort();
}

async function fetchWorldBankCountryMeta(http = {}) {
  const list = await fetchWorldBankPages(
    "/v2/country",
    { per_page: "1000" },
    "World Bank country metadata",
    http
  );
  return countryMetaFromWorldBank(list);
}

/** World Bank /v2/country rows → ISO → { name, region, adminregion, incomeLevel, lendingType }. */
export function countryMetaFromWorldBank(list) {
  const map = new Map();
  for (const c of list ?? []) {
    if (typeof c.id !== "string" || !/^[A-Z]{3}$/.test(c.id)) continue;
    const groupOrNull = (g, rename = {}) => {
      const id = String(g?.id ?? "").trim();
      const name = String(g?.value ?? "").trim();
      if (!id || id === "NA" || !name || name === "Aggregates") return null;
      return { id, name: rename[id] ?? name };
    };
    const region = groupOrNull(c.region);
    if (!region) continue;
    map.set(c.id, {
      name: c.name,
      region,
      adminregion: groupOrNull(c.adminregion),
      incomeLevel: groupOrNull(c.incomeLevel),
      lendingType: groupOrNull(c.lendingType, {
        IBD: "IBRD only",
        IDX: "IDA only",
        IDB: "IDA blend",
      }),
    });
  }
  return map;
}

export function groupDefsForCountry(meta) {
  const defs = [{ iso: "WLD", name: "World", kind: "world" }];

  if (meta.region) {
    defs.push({
      iso: meta.region.id,
      name: meta.region.name,
      kind: "region",
    });
  }
  if (meta.adminregion) {
    defs.push({
      iso: meta.adminregion.id,
      name: meta.adminregion.name,
      kind: "adminregion",
    });
  }
  if (meta.incomeLevel) {
    defs.push({
      iso: meta.incomeLevel.id,
      name: meta.incomeLevel.name,
      kind: "incomeLevel",
    });
    if (["LIC", "LMC", "UMC"].includes(meta.incomeLevel.id)) {
      defs.push({
        iso: "LMY",
        name: "Low & middle income",
        kind: "incomeLevel",
      });
    }
    if (["LMC", "UMC"].includes(meta.incomeLevel.id)) {
      defs.push({
        iso: "MIC",
        name: "Middle income",
        kind: "incomeLevel",
      });
    }
  }
  if (meta.lendingType) {
    defs.push({
      iso: meta.lendingType.id,
      name: meta.lendingType.name,
      kind: "lendingType",
    });
    if (["IDX", "IDB"].includes(meta.lendingType.id)) {
      defs.push({
        iso: "IDA_TOTAL",
        name: "IDA total",
        kind: "lendingType",
      });
    }
    if (["IBD", "IDX", "IDB"].includes(meta.lendingType.id)) {
      defs.push({
        iso: "IDA_IBRD_TOTAL",
        name: "IDA & IBRD total",
        kind: "lendingType",
      });
    }
  }

  const seen = new Set();
  return defs.filter((d) => {
    if (seen.has(d.iso) || UNCLASSIFIED_GROUP_IDS.has(d.iso)) return false;
    seen.add(d.iso);
    return true;
  });
}

export function buildDerivedGroupRows(countryRows, popMap, countryMeta) {
  const buckets = new Map();

  function addToBucket(def, row, pop) {
    const { iso, name, kind } = def;
    let bucket = buckets.get(iso);
    if (!bucket) {
      bucket = {
        iso,
        name,
        kind,
        pop: 0,
        le: 0,
        hale: 0,
        gni: 0,
        hom: 0,
        war: weightedSum(),
        road: weightedSum(),
        freedom: 0,
        members: 0,
        gniMembers: 0,
        gdpMembers: 0,
      };
      buckets.set(iso, bucket);
    }
    bucket.pop += pop;
    bucket.le += row.le * pop;
    bucket.hale += row.hale * pop;
    bucket.gni += row.gni * pop;
    bucket.hom += row.homicidesPer100k * pop;
    bucket.war.add(row.warDeathsPer100k, pop);
    bucket.road.add(row.roadDeathsPer100k, pop);
    bucket.freedom += row.freedom * pop;
    bucket.members += 1;
    if (row.incomeSource === "GDP") bucket.gdpMembers += 1;
    else bucket.gniMembers += 1;
  }

  for (const row of countryRows) {
    const pop = popMap.get(row.iso)?.value;
    const meta = countryMeta.get(row.iso);
    if (typeof pop !== "number" || !Number.isFinite(pop) || pop <= 0 || !meta) continue;
    for (const def of groupDefsForCountry(meta)) addToBucket(def, row, pop);
  }

  const out = [];
  for (const bucket of buckets.values()) {
    if (!bucket.pop || bucket.members === 0) continue;
    const le = bucket.le / bucket.pop;
    const hale = bucket.hale / bucket.pop;
    const gni = bucket.gni / bucket.pop;
    const homicidesPer100k = bucket.hom / bucket.pop;
    const warDeathsPer100k = bucket.war.mean();
    const roadDeathsPer100k = bucket.road.mean();
    const freedom = bucket.freedom / bucket.pop;
    out.push({
      iso: bucket.iso,
      name: bucket.name,
      leYear: "mixed",
      le,
      haleYear: "mixed",
      hale,
      gniYear: "mixed",
      gni,
      incomeSource:
        bucket.gniMembers && bucket.gdpMembers
          ? "mixed"
          : bucket.gdpMembers
            ? "GDP"
            : "GNI",
      homicideYear: "mixed",
      homicidesPer100k,
      ...(Number.isFinite(warDeathsPer100k) && { warYear: "mixed", warDeathsPer100k }),
      ...(Number.isFinite(roadDeathsPer100k) && { roadYear: "mixed", roadDeathsPer100k }),
      freedomYear: "mixed",
      freedom,
      derivedKind: bucket.kind,
      memberCount: bucket.members,
      customIndex: customIndexAbundanceSafetyHealthFreedom(le, gni, homicidesPer100k, hale, freedom),
    });
  }
  out.sort((a, b) => b.customIndex - a.customIndex);
  return out;
}

function rounded(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function observationAsOfYear(yearMap, year, minSourceYear) {
  if (!yearMap?.size) return null;
  let best = null;
  for (const [candidateYear, row] of yearMap) {
    if (
      candidateYear >= minSourceYear &&
      candidateYear <= year &&
      (!best || candidateYear > best.year)
    ) {
      best = { ...row, year: candidateYear };
    }
  }
  return best;
}

function annualRange(yearMin, yearMax) {
  const out = [];
  for (let y = yearMin; y <= yearMax; y++) out.push(y);
  return out;
}

/**
 * Stores the three death rates on a point, rounded as published. Only homicides feed the
 * safety pillar; war and road deaths are context.
 */
export function setDeathRates(point, homicides, war, road) {
  if (Number.isFinite(homicides)) point.homicidesPer100k = rounded(homicides, 3);
  if (Number.isFinite(war)) point.warDeathsPer100k = rounded(war, 3);
  if (Number.isFinite(road)) point.roadDeathsPer100k = rounded(road, 3);
}

/**
 * A population-weighted mean over the members that have a value, for the context rates
 * (war and road deaths) a member can lack and still be scored. NaN when none has one.
 */
function weightedSum() {
  let total = 0;
  let weight = 0;
  return {
    add(value, pop) {
      if (!Number.isFinite(value)) return;
      total += value * pop;
      weight += pop;
    },
    mean: () => (weight ? total / weight : NaN),
  };
}

function rawPillarValues(point) {
  if (
    !Number.isFinite(point?.le) ||
    !Number.isFinite(point?.hale) ||
    !Number.isFinite(point?.gni) ||
    !Number.isFinite(point?.homicidesPer100k) ||
    !Number.isFinite(point?.freedom)
  ) {
    return null;
  }
  return {
    abundance: incomeIndexFromGni(point.gni),
    safety: safetyIndexFromHomicidesPer100k(point.homicidesPer100k),
    health: combinedHealthLei(point.le, point.hale),
    freedom: freedomIndexFromScore(point.freedom),
  };
}

export function applyAbsolutePillars(point) {
  const raw = rawPillarValues(point);
  if (!raw) return false;
  point.abundanceIndex = rounded(raw.abundance, 6);
  point.safetyIndex = rounded(raw.safety, 6);
  point.healthIndex = rounded(raw.health, 6);
  point.freedomIndex = rounded(raw.freedom, 6);
  point.customIndex = rounded(
    customIndexFromPillarsFull({
      abundance: point.abundanceIndex,
      safety: point.safetyIndex,
      health: point.healthIndex,
      freedom: point.freedomIndex,
    }),
    4
  );
  // A pillar at its lower goalpost (20 years, $100, no freedom) would score −Infinity,
  // which JSON can't hold. No real country-year is there, so it means bad input data.
  if (!Number.isFinite(point.customIndex))
    throw new Error(`Pillar at or below its lower goalpost: ${JSON.stringify(raw)}`);
  return true;
}

export function buildFixedCohortSeries(entrySeries, countryRows, yearMin, yearMax) {
  const years = annualRange(yearMin, yearMax);
  const pointByIsoYear = new Map();
  const cohort = countryRows
    .map((row) => row.iso)
    .filter((iso) => {
      const byYear = new Map(
        (entrySeries[iso]?.points ?? []).map((point) => [point.year, point])
      );
      pointByIsoYear.set(iso, byYear);
      return years.every((year) => {
        const point = byYear.get(year);
        return (
          Number.isFinite(point?.customIndex) &&
          Number.isFinite(point?.population) &&
          point.population > 0
        );
      });
    });

  const points = years.map((year) => {
    const totals = {
      pop: 0,
      le: 0,
      hale: 0,
      gni: 0,
      hom: 0,
      war: weightedSum(),
      road: weightedSum(),
      freedom: 0,
    };
    for (const iso of cohort) {
      const point = pointByIsoYear.get(iso).get(year);
      const pop = point.population;
      totals.pop += pop;
      totals.le += point.le * pop;
      totals.hale += point.hale * pop;
      totals.gni += point.gni * pop;
      totals.hom += point.homicidesPer100k * pop;
      totals.war.add(point.warDeathsPer100k, pop);
      totals.road.add(point.roadDeathsPer100k, pop);
      totals.freedom += point.freedom * pop;
    }
    const point = {
      year,
      le: rounded(totals.le / totals.pop, 2),
      hale: rounded(totals.hale / totals.pop, 2),
      gni: rounded(totals.gni / totals.pop, 2),
    };
    setDeathRates(point, totals.hom / totals.pop, totals.war.mean(), totals.road.mean());
    point.freedom = rounded(totals.freedom / totals.pop, 2);
    point.population = Math.round(totals.pop);
    point.n = cohort.length;
    applyAbsolutePillars(point);
    point.value = point.customIndex;
    return point;
  });

  return { cohort, points };
}

/**
 * One country's yearly points. `inputs` maps each input (le, gni, homicide, war, road,
 * freedom, pop) to its `byCountryYear` map.
 */
export function buildCountrySeries(iso, inputs, haleHistory, yearMin, yearMax) {
  const leM = inputs.le.get(iso);
  const gniM = inputs.gni.get(iso);
  const homM = inputs.homicide.get(iso);
  const warM = inputs.war.get(iso);
  const roadM = inputs.road.get(iso);
  const freedomM = inputs.freedom.get(iso);
  const popM = inputs.pop.get(iso);
  const years = annualRange(yearMin, yearMax);
  const points = [];

  for (const y of years) {
    const leY = observationAsOfYear(leM, y, yearMin);
    const gniY = observationAsOfYear(gniM, y, yearMin);
    const homY = observationAsOfYear(homM, y, yearMin);
    const warY = observationAsOfYear(warM, y, yearMin);
    const roadY = observationAsOfYear(roadM, y, yearMin);
    const freedomY = observationAsOfYear(freedomM, y, yearMin);
    const popY = observationAsOfYear(popM, y, yearMin);
    const hale = adjustedHaleAsOfYear(haleHistory, iso, y, leM, yearMin);
    const point = { year: y };

    if (leY) {
      point.le = rounded(leY.value, 2);
      point.leYear = leY.year;
    }
    if (hale) {
      point.hale = rounded(hale.value, 2);
      point.haleYear = hale.year;
      if (hale.estimated) point.haleEstimated = true;
    }
    if (gniY) {
      point.gni = rounded(gniY.value, 2);
      point.gniYear = gniY.incomeBaseYear ?? gniY.year;
      point.incomeSource = gniY.incomeSource;
      if (gniY.incomeBaseYear) point.incomeEstimated = true;
    }
    setDeathRates(point, homY?.value, warY?.value, roadY?.value);
    if (homY) point.homicideYear = homY.year;
    if (warY) point.warYear = warY.year;
    if (roadY) point.roadYear = roadY.year;
    if (freedomY) {
      point.freedom = rounded(freedomY.value, 2);
      point.freedomYear = freedomY.year;
    }
    const pop = popY?.value;
    if (typeof pop === "number" && Number.isFinite(pop) && pop > 0) {
      point.population = Math.round(pop);
    }

    if (leY && gniY && homY && freedomY && hale) applyAbsolutePillars(point);

    const hasMetric =
      Number.isFinite(point.le) ||
      Number.isFinite(point.hale) ||
      Number.isFinite(point.gni) ||
      Number.isFinite(point.homicidesPer100k) ||
      Number.isFinite(point.warDeathsPer100k) ||
      Number.isFinite(point.roadDeathsPer100k) ||
      Number.isFinite(point.freedom) ||
      Number.isFinite(point.customIndex);
    if (hasMetric) points.push(point);
  }

  return points;
}

function addWeightedYearBucket(buckets, def, values, pop) {
  let bucket = buckets.get(def.iso);
  if (!bucket) {
    bucket = {
      iso: def.iso,
      name: def.name,
      kind: def.kind,
      pop: 0,
      le: 0,
      hale: 0,
      gni: 0,
      hom: 0,
      war: weightedSum(),
      road: weightedSum(),
      freedom: 0,
      members: 0,
      gniMembers: 0,
      gdpMembers: 0,
      estimatedHaleMembers: 0,
      estimatedIncomeMembers: 0,
    };
    buckets.set(def.iso, bucket);
  }
  bucket.pop += pop;
  bucket.le += values.le * pop;
  bucket.hale += values.hale * pop;
  bucket.gni += values.gni * pop;
  bucket.hom += values.hom * pop;
  bucket.war.add(values.war, pop);
  bucket.road.add(values.road, pop);
  bucket.freedom += values.freedom * pop;
  bucket.members += 1;
  if (values.incomeSource === "GDP") bucket.gdpMembers += 1;
  else bucket.gniMembers += 1;
  if (values.haleEstimated) bucket.estimatedHaleMembers += 1;
  if (values.incomeEstimated) bucket.estimatedIncomeMembers += 1;
}

/** Population-weighted group points; `inputs` is as for `buildCountrySeries`. */
export function buildDerivedGroupSeries(inputs, haleHistory, countryMeta, yearMin, yearMax) {
  const byIso = new Map();
  const years = annualRange(yearMin, yearMax);

  for (const y of years) {
    const buckets = new Map();
    for (const [iso, meta] of countryMeta) {
      const leY = observationAsOfYear(inputs.le.get(iso), y, yearMin);
      const gniY = observationAsOfYear(inputs.gni.get(iso), y, yearMin);
      const homY = observationAsOfYear(inputs.homicide.get(iso), y, yearMin);
      const warY = observationAsOfYear(inputs.war.get(iso), y, yearMin);
      const roadY = observationAsOfYear(inputs.road.get(iso), y, yearMin);
      const freedomY = observationAsOfYear(inputs.freedom.get(iso), y, yearMin);
      const popY = observationAsOfYear(inputs.pop.get(iso), y, yearMin);
      const hale = adjustedHaleAsOfYear(
        haleHistory,
        iso,
        y,
        inputs.le.get(iso),
        yearMin
      );
      const pop = popY?.value;
      if (!leY || !gniY || !homY || !freedomY || !hale) continue;
      if (typeof pop !== "number" || !Number.isFinite(pop) || pop <= 0) continue;

      const values = {
        le: leY.value,
        hale: hale.value,
        haleEstimated: hale.estimated,
        gni: gniY.value,
        incomeSource: gniY.incomeSource,
        incomeEstimated: Boolean(gniY.incomeBaseYear),
        hom: homY.value,
        war: warY?.value,
        road: roadY?.value,
        freedom: freedomY.value,
      };
      for (const def of groupDefsForCountry(meta)) {
        addWeightedYearBucket(buckets, def, values, pop);
      }
    }

    for (const bucket of buckets.values()) {
      if (!bucket.pop || bucket.members === 0) continue;
      const le = bucket.le / bucket.pop;
      const hale = bucket.hale / bucket.pop;
      const gni = bucket.gni / bucket.pop;
      const freedom = bucket.freedom / bucket.pop;
      if (!byIso.has(bucket.iso)) {
        byIso.set(bucket.iso, {
          definition:
            `Population-weighted annual timeline for ${SERIES_RANGE_LABEL}. World Bank supplies life expectancy, GNI per capita (PPP), GDP per capita (PPP) to extend GNI to years without it, intentional homicides/100k, road traffic deaths/100k, population, and grouping metadata; UCDP supplies war deaths; WHO GHO supplies HALE only. Exact annual HALE is preferred; missing HALE years preserve the latest reported life-expectancy-minus-HALE gap, keeping its sign, and apply it to current life expectancy. Missing GNI years move the latest GNI by the change in GDP per capita since then. Other inputs use exact same-year values when present, otherwise the latest prior value from ${SERIES_YEAR_MIN} onward. Future observations are not pulled backward.`,
          points: [],
        });
      }
      const point = {
        year: y,
        le: rounded(le, 2),
        hale: rounded(hale, 2),
        haleEstimated: bucket.estimatedHaleMembers > 0 || undefined,
        gni: rounded(gni, 2),
        incomeSource:
          bucket.gniMembers && bucket.gdpMembers
            ? "mixed"
            : bucket.gdpMembers
              ? "GDP"
              : "GNI",
        incomeEstimated: bucket.estimatedIncomeMembers > 0 || undefined,
      };
      setDeathRates(point, bucket.hom / bucket.pop, bucket.war.mean(), bucket.road.mean());
      point.freedom = rounded(freedom, 2);
      point.population = Math.round(bucket.pop);
      point.n = bucket.members;
      applyAbsolutePillars(point);
      byIso.get(bucket.iso).points.push(point);
    }
  }

  return byIso;
}

function indexSortValue(row) {
  const v = row.customIndex ?? row.customHdi;
  return typeof v === "number" && Number.isFinite(v) ? v : NaN;
}

export function sortRowsByIndex(rows) {
  return rows.sort((a, b) => {
    const av = indexSortValue(a);
    const bv = indexSortValue(b);
    const aBad = !Number.isFinite(av);
    const bBad = !Number.isFinite(bv);
    if (aBad && bBad) return a.name.localeCompare(b.name);
    if (aBad) return 1;
    if (bBad) return -1;
    return bv - av || a.name.localeCompare(b.name);
  });
}

export function rowsForDisplayYear(rows, entrySeries, displayYear) {
  return sortRowsByIndex(
    rows.map((row) => {
      const point = entrySeries[row.iso]?.points?.find((p) => p.year === displayYear);
      if (!point) return row;
      return {
        ...row,
        le: point.le,
        leYear: point.leYear ?? row.leYear,
        hale: point.hale,
        haleYear: point.haleYear ?? row.haleYear,
        haleEstimated: point.haleEstimated ?? false,
        gni: point.gni,
        gniYear: point.gniYear ?? row.gniYear,
        incomeSource: point.incomeSource ?? row.incomeSource,
        incomeEstimated: point.incomeEstimated ?? false,
        homicidesPer100k: point.homicidesPer100k,
        homicideYear: point.homicideYear ?? row.homicideYear,
        warDeathsPer100k: point.warDeathsPer100k,
        warYear: point.warYear ?? row.warYear,
        roadDeathsPer100k: point.roadDeathsPer100k,
        roadYear: point.roadYear ?? row.roadYear,
        freedom: point.freedom,
        freedomYear: point.freedomYear ?? row.freedomYear,
        abundanceIndex: point.abundanceIndex,
        safetyIndex: point.safetyIndex,
        healthIndex: point.healthIndex,
        freedomIndex: point.freedomIndex,
        population: point.population ?? row.population,
        customIndex: point.customIndex,
      };
    })
  );
}

/** Values the pre-write guard counts, each with the field holding its source year. */
const COVERAGE_FIELDS = [
  ["le", "leYear"],
  ["hale", "haleYear"],
  ["gni", "gniYear"],
  ["homicidesPer100k", "homicideYear"],
  ["warDeathsPer100k", "warYear"],
  ["roadDeathsPer100k", "roadYear"],
  ["freedom", "freedomYear"],
  ["customIndex", null],
];

/**
 * Coverage of one leaderboard.json + series.json pair: scored countries, groups, the
 * fixed-cohort size, and per value the countries that have it in their latest point and the
 * same-year source observations across all country histories.
 */
export function datasetStats(leaderboard, series) {
  const rows = leaderboard?.countries ?? [];
  const groupIso = new Set(rows.filter((row) => row.derivedKind).map((row) => row.iso));
  const countries = {};
  const observations = {};
  for (const [field] of COVERAGE_FIELDS) {
    countries[field] = 0;
    observations[field] = 0;
  }
  for (const [iso, entry] of Object.entries(series?.entrySeries ?? {})) {
    if (groupIso.has(iso)) continue;
    const points = entry.points ?? [];
    const latest = points.reduce((best, p) => (!best || p.year > best.year ? p : best), null);
    for (const [field, yearField] of COVERAGE_FIELDS) {
      if (Number.isFinite(latest?.[field])) countries[field] += 1;
      for (const point of points) {
        if (Number.isFinite(point[field]) && (!yearField || point[yearField] === point.year)) {
          observations[field] += 1;
        }
      }
    }
  }
  const trend = leaderboard?.globalAverageSeries?.points ?? [];
  return {
    scoredIso: rows
      .filter((row) => !row.derivedKind && Number.isFinite(row.customIndex))
      .map((row) => row.iso)
      .sort(),
    unscoredIso: rows.filter((row) => !Number.isFinite(row.customIndex)).map((row) => row.iso),
    groupIso: [...groupIso].sort(),
    cohortSize: leaderboard?.globalAverageSeries?.cohortSize ?? 0,
    trendIsFinite: trend.length > 0 && trend.every((point) => Number.isFinite(point.value)),
    countries,
    observations,
  };
}

function isoList(isos) {
  const shown = isos.slice(0, 15).join(", ");
  return isos.length > 15 ? `${shown} and ${isos.length - 15} more` : shown;
}

/**
 * Reasons not to replace the committed data with `next` (both from `datasetStats`): any
 * figure falling by more than `tolerance`, a missing group, or an unusable result.
 * `previous` is null when there is no committed data to compare with.
 */
export function sanityProblems(previous, next, tolerance = SHRINK_TOLERANCE) {
  const problems = [];
  if (!next.scoredIso.length) problems.push("no country has a Tomer index");
  if (next.unscoredIso.length) {
    problems.push(`rows without a Tomer index: ${isoList(next.unscoredIso)}`);
  }
  if (!next.trendIsFinite) {
    problems.push("the fixed-cohort trend is empty or has non-finite values");
  }
  if (!previous) return problems;

  const shrank = (label, before, after, detail = "") => {
    if (after < before * (1 - tolerance)) {
      problems.push(`${label} fell from ${before} to ${after}${detail}`);
    }
  };
  const dropped = previous.scoredIso.filter((iso) => !next.scoredIso.includes(iso));
  shrank(
    "scored countries",
    previous.scoredIso.length,
    next.scoredIso.length,
    dropped.length ? ` (dropped: ${isoList(dropped)})` : ""
  );
  shrank("fixed-cohort size", previous.cohortSize, next.cohortSize);
  for (const [field] of COVERAGE_FIELDS) {
    shrank(
      `countries with ${field} in their latest year`,
      previous.countries[field],
      next.countries[field]
    );
    shrank(`${field} observations`, previous.observations[field], next.observations[field]);
  }
  const lostGroups = previous.groupIso.filter((iso) => !next.groupIso.includes(iso));
  if (lostGroups.length) problems.push(`groups missing: ${isoList(lostGroups)}`);
  return problems;
}

/**
 * Printed when `sanityProblems` stops the write. The npm script is the way to force it:
 * its postbuild-data hook also runs build-world (shapes for newly scored countries) and
 * split-data, which a direct `node scripts/build-data.mjs --force` would skip.
 */
export function shrinkRefusalMessage(problems) {
  const list = problems.map((problem) => `  - ${problem}`).join("\n");
  return `Refusing to overwrite public/data: compared with the committed files, this build looks degraded:\n${list}\nNothing was written. If the change is expected, run \`npm run build-data -- --force\` (it then runs build-world and split-data too).`;
}

/** Parsed committed JSON, or null when the file doesn't exist yet. */
async function readCommittedJson(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Committed ${file} is not valid JSON (${error.message}); restore or delete it`
    );
  }
}

/** Writes every file to `<file>.tmp` first, so a failure can't leave a half-written mix. */
async function writeFilesAtomically(files) {
  for (const [file, text] of files) await writeFile(`${file}.tmp`, text, "utf8");
  for (const [file] of files) await rename(`${file}.tmp`, file);
}

async function main() {
  const force = process.argv.slice(2).includes("--force");
  const generatedAt = new Date().toISOString();
  const committedLeaderboard = await readCommittedJson(LEADERBOARD_OUT);
  const committedSeries = await readCommittedJson(SERIES_OUT);
  const { data: worldBankData, countryMeta, summary: worldBankAudit } =
    await fetchAllWorldBankInputs();
  const gniRows = worldBankData.gniPerCapita.rows;
  const gdpRows = worldBankData.gdpPerCapita.rows;
  const incomeRows = incomeRowsWithGdpFallback(gniRows, gdpRows);
  const homRows = worldBankData.intentionalHomicidesPer100k.rows;
  const roadRows = worldBankData.roadDeathsPer100k.rows;
  console.log("Fetching Human Freedom Index personal-freedom scores …");
  const freedomDownload = await fetchHfiPersonalFreedom(committedSeries, generatedAt);
  const freedomRows = freedomDownload.rows;
  const popRows = worldBankData.population.rows;
  console.log(`Reading UCDP GED ${UCDP_GED_VERSION} war deaths …`);
  const warDeaths = await fetchUcdpWarDeaths();
  const warRows = warDeathRows(warDeaths.rows, popRows);
  console.log("Fetching WHO HALE (WHOSIS_000002) …");
  const haleDownload = await fetchWhoHaleOrCached(committedSeries, generatedAt);
  // Same cap as the WDI fetch: drop observations past the display window at the
  // source so every downstream consumer (latest rows, histories) is bounded.
  const haleRows = haleDownload.rows.filter((r) => {
    const y = typeof r.TimeDim === "number" ? r.TimeDim : parseInt(String(r.TimeDim), 10);
    return Number.isFinite(y) && y <= SERIES_YEAR_MAX;
  });
  const haleHistory = haleHistoryByIso(haleRows);
  const leCheck = dropLifeExpectancyBelowHale(worldBankData.lifeExpectancy.rows, haleHistory);
  const leRows = leCheck.rows;
  for (const row of leCheck.dropped)
    console.warn(
      `Dropped ${row.iso} ${row.year} life expectancy ${row.lifeExpectancy}: below WHO HALE ${row.hale} (${row.haleYear}).`
    );
  const countryRows = mergeRows({
    le: latestByCountry(leRows),
    gni: latestByCountry(incomeRows),
    homicide: latestByCountry(homRows),
    war: latestByCountry(warRows),
    road: latestByCountry(roadRows),
    hale: latestHaleByIso(haleRows),
    freedom: latestByCountry(freedomRows),
  });
  for (const row of countryRows) {
    const meta = countryMeta.get(row.iso);
    if (!meta) continue;
    if (meta.region) row.region = meta.region;
    if (meta.incomeLevel) row.incomeLevel = meta.incomeLevel;
  }
  const popMap = latestByCountry(popRows);
  const derivedGroupRows = buildDerivedGroupRows(countryRows, popMap, countryMeta);
  const groupIso = new Set(derivedGroupRows.map((r) => r.iso));
  const latestCountries = sortRowsByIndex([
    ...countryRows.filter((r) => !groupIso.has(r.iso)),
    ...derivedGroupRows,
  ]);

  const { yearMin, yearMax } = yearWindowFromRange(DATE_RANGE);
  const inputsByCY = {
    le: byCountryYear(leRows),
    gni: byCountryYear(incomeRows),
    homicide: byCountryYear(homRows),
    war: byCountryYear(warRows),
    road: byCountryYear(roadRows),
    freedom: byCountryYear(freedomRows),
    pop: byCountryYear(popRows),
  };
  const seriesYearMin = Math.max(yearMin, SERIES_YEAR_MIN);
  const seriesYearMax = Math.min(yearMax, SERIES_YEAR_MAX);
  let worldSeries = [];
  const entrySeries = {};
  for (const row of countryRows) {
    const points = buildCountrySeries(
      row.iso,
      inputsByCY,
      haleHistory,
      seriesYearMin,
      seriesYearMax
    );
    if (points.length) {
      entrySeries[row.iso] = {
        definition:
          `Country annual timeline for ${SERIES_RANGE_LABEL}. World Bank supplies abundance (GNI per capita PPP, extended by GDP per capita growth), safety (intentional homicides per 100k), road traffic deaths per 100k (context only, not scored), life expectancy, and population; UCDP supplies war deaths (context only, not scored), counted for the country whose people died (years without any count as 0); WHO GHO supplies HALE; the Cato/Fraser Human Freedom Index supplies Personal Freedom. Exact annual HALE is preferred; missing HALE years preserve the latest reported life-expectancy-minus-HALE gap, keeping its sign, and apply it to current life expectancy. Missing GNI years move the latest GNI by the change in GDP per capita since then (incomeEstimated); plain GDP is used only before a country's first GNI year. Other inputs use exact same-year values when present, otherwise the latest prior value from ${SERIES_YEAR_MIN} onward. The Tomer index is stored only when all four pillars are available as of that year. Future observations are not pulled backward.`,
        points,
      };
    }
  }
  const derivedSeries = buildDerivedGroupSeries(
    inputsByCY,
    haleHistory,
    countryMeta,
    seriesYearMin,
    seriesYearMax
  );
  for (const [iso, series] of derivedSeries) {
    if (series.points.length) entrySeries[iso] = series;
  }
  const fixedCohort = buildFixedCohortSeries(
    entrySeries,
    countryRows,
    seriesYearMin,
    seriesYearMax
  );
  worldSeries = fixedCohort.points;
  const countries = rowsForDisplayYear(latestCountries, entrySeries, SERIES_YEAR_MAX);
  const firstP = worldSeries[0];
  const lastP = worldSeries[worldSeries.length - 1];
  const fmt4 = (v) => (v == null ? "—" : v.toFixed(4));
  const footNote =
    firstP && lastP
      ? `${firstP.year} ${fmt4(firstP.value)} → ${lastP.year} ${fmt4(
          lastP.value
        )}. Fixed cohort of ${fixedCohort.cohort.length} countries present in every year; population-weighted within that cohort. Coverage grows from ${Math.round(firstP.population / 1e6)}M to ${Math.round(lastP.population / 1e6)}M people.`
      : "";

  const payload = {
    generatedAt,
    yearWindow: DATE_RANGE,
    worldBankAudit,
    sourceRefresh: {
      worldBank: { status: "downloaded" },
      whoHale: {
        // "downloaded" or "cached" (reused from the committed series.json).
        status: haleDownload.status,
        latestObservationYear: Math.max(...haleRows.map((row) => Number(row.TimeDim))),
        retrievedAt: haleDownload.retrievedAt,
        cachedFrom: haleDownload.cachedFrom,
        reason: haleDownload.reason,
      },
      humanFreedomIndex: {
        // "downloaded", "file" (HFI_FILE) or "cached" (reused from the committed series.json).
        status: freedomDownload.status,
        edition: 2025,
        latestObservationYear: Math.max(...freedomRows.map((row) => Number(row.date))),
        url: HFI_URL,
        retrievedAt: freedomDownload.retrievedAt,
        file: freedomDownload.file,
        cachedFrom: freedomDownload.cachedFrom,
        reason: freedomDownload.reason,
      },
      ucdpGed: {
        // "downloaded" or "file" (UCDP_GED_FILE).
        status: warDeaths.status,
        version: UCDP_GED_VERSION,
        url: UCDP_GED_URL,
        events: warDeaths.eventCount,
        latestObservationYear: warDeaths.latestYear,
      },
      lifeExpectancyCheck: {
        maxYearsBelowHale: LE_BELOW_HALE_MAX,
        dropped: leCheck.dropped,
      },
    },
    indicators: {
      lifeExpectancy: WB_LE,
      healthyLifeExpectancyHale: "WHO WHOSIS_000002 (HALE at birth, both sexes)",
      gniPerCapita: WB_GNI,
      gdpPerCapitaFallback: WB_GDP,
      intentionalHomicidesPer100k: WB_HOMICIDE,
      warDeaths: `UCDP Georeferenced Event Dataset ${UCDP_GED_VERSION}: state-based and one-sided violence`,
      roadTrafficDeathsPer100k: WB_ROAD,
      freedomPersonalFreedomSubIndex:
        "Human Freedom Index 2025 Personal Freedom components excluding Security and Safety, rescaled to 0-100",
      population: WB_POP,
    },
    sourcePolicy: {
      worldBank:
        "World Bank supplies life expectancy, GNI per capita (PPP), GDP per capita (PPP) only to extend GNI to years without it (or, before a country's first GNI year, in its place), intentional homicides/100k, road traffic deaths/100k (WHO estimates), population, and country/group metadata.",
      ucdp:
        "War deaths come from the UCDP Georeferenced Event Dataset (state-based conflict and one-sided violence against civilians). Each death counts for the country whose people died: a government's soldiers for that government's country (the first listed, for a coalition), and armed groups, civilians and unidentified dead for the country where they died, with Gaza and the West Bank counted as Palestine.",
      whoGho:
        "HALE is the only WHO GHO input: WHOSIS_000002, healthy life expectancy at birth, both sexes. Missing annual HALE values are estimated by preserving the latest reported life-expectancy-minus-HALE gap, keeping its sign, and applying it to current life expectancy.",
      humanFreedomIndex:
        "Freedom is derived from the Cato Institute and Fraser Institute Human Freedom Index 2025 Personal Freedom categories, excluding Security and Safety to keep it distinct from the tracker’s Safety pillar.",
    },
    derivedRows:
      "Derived rows are population-weighted aggregates computed from the country rows in this file using World Bank data for abundance, homicide and road deaths, life expectancy, and population; UCDP for war deaths; WHO GHO for HALE; and the Human Freedom Index for personal freedom. GNI per capita (PPP) is used for abundance; a year without GNI moves the latest GNI by the change in GDP per capita (PPP) since then, and plain GDP per capita stands in only before a country's first GNI year.",
    healthPillar:
      `LEI = ½·LEI(life expectancy) + ½·LEI(HALE); both score 0 at 20 years and 1 at 85 years, and keep rising past 85. A World Bank life expectancy more than ${LE_BELOW_HALE_MAX} years below the latest WHO HALE on or before its year is treated as a source error and dropped (sourceRefresh.lifeExpectancyCheck lists them); that year uses the latest earlier value.`,
    safetyNote:
      "Safety scores intentional homicides per 100k as 1 / (1 + homicides / 100): 0 scores 1, 100 scores 0.5, 200 scores 1/3, and no number scores 0. War deaths (UCDP state-based and one-sided violence, counted for the country whose people died and divided by its population; years with none recorded count as 0) and road deaths per 100k are published alongside for context but are not part of the index, and a country-year doesn't need them to be scored. Suicide, other accidents, and non-fatal crime are not included.",
    freedomNote:
      "Freedom averages the Personal Freedom categories for rule of law, movement, religion, association, expression, and relationships from the Cato/Fraser Human Freedom Index 2025, then rescales the result from 0-10 to 0-100. The Security and Safety category is excluded to keep the pillar distinct from Safety.",
    pillarNormalization:
      "Every base pillar is normalized against fixed goalposts, and the index is 1 + the natural log of the pillars' weighted geometric mean: 1 + Σ weight·ln(pillar). 1 means every goalpost is met. Scores are absolute and do not depend on other countries or the selected year. The ranking is the geometric mean's, so weakness in one pillar drags the index down, and every halving of a pillar costs its weight × ln 2 however low it already is, so the index has no floor. Health (above 85 years) and abundance (above $75,000) keep rising past 1, so it has no ceiling either.",
    indexWeights: INDEX_WEIGHTS,
    globalAverageSeries: {
      definition:
        `Comparable fixed-cohort trend: the same ${fixedCohort.cohort.length} countries are included in every year from ${SERIES_RANGE_LABEL}, weighted by their population in each year. This avoids false jumps when countries enter the dataset. It covers ${Math.round(firstP.population / 1e6)} million people in ${firstP.year} and ${Math.round(lastP.population / 1e6)} million in ${lastP.year}; it is not a whole-world estimate.`,
      chartTitle: "Fixed-cohort Tomer index trend",
      cohortSize: fixedCohort.cohort.length,
      cohortIso: fixedCohort.cohort,
      footNote,
      points: worldSeries,
    },
    entrySeries,
    countries,
  };

  const leaderboardPayload = {
    generatedAt: payload.generatedAt,
    sourceRefresh: payload.sourceRefresh,
    yearWindow: payload.yearWindow,
    indicators: payload.indicators,
    sourcePolicy: payload.sourcePolicy,
    derivedRows: payload.derivedRows,
    healthPillar: payload.healthPillar,
    safetyNote: payload.safetyNote,
    freedomNote: payload.freedomNote,
    pillarNormalization: payload.pillarNormalization,
    indexWeights: payload.indexWeights,
    globalAverageSeries: payload.globalAverageSeries,
    countries,
  };
  const seriesPayload = {
    generatedAt: payload.generatedAt,
    sourceRefresh: payload.sourceRefresh,
    yearWindow: payload.yearWindow,
    entrySeries,
  };

  if (!committedLeaderboard || !committedSeries) {
    console.warn("No committed public/data to compare with; skipping the shrink check.");
  }
  const problems = sanityProblems(
    committedLeaderboard && committedSeries
      ? datasetStats(committedLeaderboard, committedSeries)
      : null,
    datasetStats(leaderboardPayload, seriesPayload)
  );
  if (freedomDownload.status === "cached") {
    const lost = cachedFreedomLosses(freedomRows, entrySeries);
    if (lost.length) {
      problems.push(
        `reused HFI freedom data would be lost for ${isoList(lost)}; the next build reuses this one's output, so it could never come back`
      );
    }
  }
  if (haleDownload.status === "cached") {
    const lost = cachedHaleLosses(haleRows, entrySeries);
    if (lost.length) {
      problems.push(
        `reused WHO HALE data would be lost for ${isoList(lost)}; the next build reuses this one's output, so it could never come back`
      );
    }
  }
  if (problems.length) {
    if (!force) {
      console.error(shrinkRefusalMessage(problems));
      process.exitCode = 1;
      return;
    }
    const list = problems.map((problem) => `  - ${problem}`).join("\n");
    console.warn(`--force: writing despite:\n${list}`);
  }

  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(ARCHIVE_DIR, { recursive: true });
  // Archive payload stays pretty-printed for inspection; the web files are
  // minified because they ship to the browser.
  await writeFilesAtomically([
    [OUT, JSON.stringify(payload, null, 2)],
    [LEADERBOARD_OUT, JSON.stringify(leaderboardPayload)],
    [SERIES_OUT, JSON.stringify(seriesPayload)],
  ]);
  console.log(`Wrote ${countries.length} leaderboard rows → ${LEADERBOARD_OUT}`);
}

// Run only when executed (`node scripts/build-data.mjs`), never when imported by tests.
if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
