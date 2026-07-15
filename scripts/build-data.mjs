/**
 * Fetches World Bank indicators plus WHO GHO HALE and writes the web data
 * files (public/data/leaderboard.json + series.json, minified) plus a full
 * pretty-printed archive payload (data-archive/countries.json, not shipped).
 * Run: npm run build-data (needs network once; commit the JSON for offline builds).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  latestByCountry,
  mergeRows,
  byCountryYear,
  incomeRowsWithGdpFallback,
  haleHistoryByIso,
  adjustedHaleAsOfYear,
  customIndexAbundanceSafetyHealthFreedom,
  customIndexAbundanceSafetyHealthFreedomFull,
  customIndexFromPillarsFull,
  combinedHealthLei,
  incomeIndexFromGni,
  safetyIndexFromHomicidesPer100k,
  freedomIndexFromScore,
  INDEX_WEIGHTS,
} from "../src/hdi-core.js";
import { dataQualityForSeries } from "../src/data-quality.js";
import { YEAR_MAX, YEAR_MIN } from "../src/site-years.js";

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
/** Intentional homicides per 100,000 — standard cross-country safety proxy (UNODC/WDI). */
const WB_HOMICIDE = "VC.IHR.PSRC.P5";
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

async function fetchWorldBankJson(urlString, indicator) {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(urlString);
    if (res.ok) return res.json();
    const retry =
      res.status === 400 ||
      res.status === 429 ||
      res.status === 502 ||
      res.status === 503 ||
      res.status === 504;
    if (retry && attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      continue;
    }
    throw new Error(`World Bank request failed (${res.status}) for ${indicator}`);
  }
  throw new Error(`World Bank request failed for ${indicator}`);
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
    label: "GDP per capita, PPP (constant 2021 international $; GNI fallback only)",
    dateRange: DATE_RANGE,
  },
  intentionalHomicidesPer100k: {
    indicator: WB_HOMICIDE,
    label: "Intentional homicides (per 100,000 people)",
    dateRange: DATE_RANGE,
  },
  population: {
    indicator: WB_POP,
    label: "Population, total",
    dateRange: DATE_RANGE_POP,
  },
};

async function fetchHfiPersonalFreedom() {
  let data;
  try {
    const res = await fetch(HFI_URL);
    if (!res.ok) throw new Error(`Human Freedom Index request failed (${res.status})`);
    const text = await res.text();
    data = JSON.parse(text);
  } catch (error) {
    try {
      const cached = JSON.parse(await readFile(SERIES_OUT, "utf8"));
      const rows = [];
      for (const [iso, series] of Object.entries(cached.entrySeries ?? {})) {
        if (!/^[A-Z]{3}$/.test(iso)) continue;
        for (const point of series.points ?? []) {
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
      if (!rows.length) throw error;
      console.warn(
        `Human Freedom Index download unavailable; using ${rows.length} cached observations.`
      );
      return rows;
    } catch {
      throw error;
    }
  }
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

const WB_WLD = "WLD";
/** WHO GHO: global HALE (not country-level) for the same SEX_BTSX series as per-country. */
const WHO_HALE_GLOBAL_FILTER =
  "SpatialDimType eq 'GLOBAL' and SpatialDim eq 'GLOBAL' and Dim1 eq 'SEX_BTSX'";

/**
 * Worldwide Tomer index by displayed year using published world aggregates, not a sample of
 * countries. World Bank supplies every input except HALE; WHO GHO supplies HALE.
 * @param {ReturnType<typeof byCountryYear>} leByCY
 * @param {ReturnType<typeof byCountryYear>} gniByCY
 * @param {ReturnType<typeof byCountryYear>} homByCY
 * @param {ReturnType<typeof byCountryYear>} popByCY
 * @param {ReturnType<typeof haleHistoryByIso>} haleWldMap — map with only WLD → global HALE history
 * @param {number} yearMin
 * @param {number} yearMax
 */
function worldAggregateTomerSeries(
  leByCY,
  gniByCY,
  homByCY,
  freedomByCY,
  popByCY,
  haleWldMap,
  yearMin,
  yearMax
) {
  const leM = leByCY.get(WB_WLD);
  const gniM = gniByCY.get(WB_WLD);
  const homM = homByCY.get(WB_WLD);
  const freedomM = freedomByCY.get(WB_WLD);
  const popM = popByCY.get(WB_WLD);
  const points = [];
  for (let y = yearMin; y <= yearMax; y++) {
    const leY = observationAsOfYear(leM, y, yearMin);
    const gniY = observationAsOfYear(gniM, y, yearMin);
    const homY = observationAsOfYear(homM, y, yearMin);
    const freedomY = observationAsOfYear(freedomM, y, yearMin);
    const popY = observationAsOfYear(popM, y, yearMin);
    const hale = adjustedHaleAsOfYear(haleWldMap, WB_WLD, y, leM, yearMin);
    if (!leY || !gniY || !homY || !freedomY || !hale || !popY) continue;
    const p = popY.value;
    if (typeof p !== "number" || !Number.isFinite(p) || p <= 0) continue;
    const idx = customIndexAbundanceSafetyHealthFreedomFull(
      leY.value,
      gniY.value,
      homY.value,
      hale.value,
      freedomY.value
    );
    points.push({
      year: y,
      value: Math.round(idx * 10000) / 10000,
      leYear: leY.year,
      haleYear: hale.year,
      haleEstimated: hale.estimated || undefined,
      gniYear: gniY.year,
      incomeSource: gniY.incomeSource,
      homicideYear: homY.year,
      freedomYear: freedomY.year,
      freedom: rounded(freedomY.value, 2),
      populationYear: popY.year,
      n: 1,
      population: Math.round(p),
    });
  }
  return points;
}

/**
 * Fetches WHO global HALE and returns the same array shape as `haleHistoryByIso` for ISO `WLD`.
 * @returns {ReturnType<typeof haleHistoryByIso>}
 */
async function fetchHaleWldMapFromGlobalWho() {
  const out = [];
  const pageSize = 1000;
  let skip = 0;
  for (;;) {
    const qs = [
      `$filter=${encodeURIComponent(WHO_HALE_GLOBAL_FILTER)}`,
      `$orderby=TimeDim`,
      `$top=${pageSize}`,
      `$skip=${skip}`,
      "$format=json",
    ].join("&");
    const res = await fetch(`${WHO_HALE_URL}?${qs}`);
    if (!res.ok) {
      throw new Error(`WHO GHO global HALE request failed (${res.status})`);
    }
    const json = await res.json();
    const chunk = json.value ?? [];
    for (const r of chunk) {
      if (r.NumericValue == null || Number.isNaN(Number(r.NumericValue))) continue;
      const y = r.TimeDim;
      const year = typeof y === "number" ? y : parseInt(String(y), 10);
      if (Number.isNaN(year)) continue;
      out.push({ year, value: Number(r.NumericValue) });
    }
    if (chunk.length < pageSize) break;
    skip += pageSize;
  }
  out.sort((a, b) => a.year - b.year);
  const m = new Map();
  m.set(WB_WLD, out);
  return m;
}

async function fetchAllPages(indicator, dateRange = DATE_RANGE, source = null) {
  const out = [];
  let page = 1;
  for (;;) {
    const url = new URL(
      `${WB_BASE}/v2/country/all/indicator/${encodeURIComponent(indicator)}`
    );
    url.searchParams.set("format", "json");
    url.searchParams.set("date", dateRange);
    url.searchParams.set("per_page", WB_PER_PAGE);
    url.searchParams.set("page", String(page));
    if (source) url.searchParams.set("source", source);

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

function summarizeWorldBankRows(rows, expectedIndicator) {
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

async function fetchAllWorldBankInputs() {
  console.log("Downloading all World Bank inputs first ...");
  const entries = await Promise.all(
    Object.entries(WORLD_BANK_INPUTS).map(async ([key, spec]) => {
      console.log("Fetching", spec.indicator, "...");
      const rows = await fetchAllPages(spec.indicator, spec.dateRange, spec.source);
      return [key, { ...spec, rows }];
    })
  );
  console.log("Fetching World Bank country metadata ...");
  const countryMeta = await fetchWorldBankCountryMeta();
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
function latestHaleByIso(rows) {
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

async function fetchAllWhoHale() {
  const out = [];
  /** WHO GHO OData max `$top` is 1000 per request. */
  const pageSize = 1000;
  let skip = 0;
  for (;;) {
    /** OData $-params: build query string manually (URLSearchParams mishandles $ keys in some runtimes). */
    const qs = [
      `$filter=${encodeURIComponent(WHO_HALE_FILTER)}`,
      `$top=${pageSize}`,
      `$skip=${skip}`,
      "$format=json",
    ].join("&");
    const res = await fetch(`${WHO_HALE_URL}?${qs}`);
    if (!res.ok) {
      throw new Error(`WHO GHO HALE request failed (${res.status})`);
    }
    const json = await res.json();
    const chunk = json.value ?? [];
    if (!chunk.length) break;
    out.push(...chunk);
    if (chunk.length < pageSize) break;
    skip += pageSize;
  }
  return out;
}

async function fetchWorldBankCountryMeta() {
  const map = new Map();
  let page = 1;
  for (;;) {
    const url = new URL(`${WB_BASE}/v2/country`);
    url.searchParams.set("format", "json");
    url.searchParams.set("per_page", "1000");
    url.searchParams.set("page", String(page));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`World Bank country metadata failed (${res.status})`);
    const json = await res.json();
    const [meta, list] = json;
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
    if (page >= (meta?.pages ?? 1)) break;
    page += 1;
  }
  return map;
}

function groupDefsForCountry(meta) {
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
    if (seen.has(d.iso)) return false;
    seen.add(d.iso);
    return true;
  });
}

function buildDerivedGroupRows(countryRows, popMap, countryMeta) {
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
      freedomYear: "mixed",
      freedom,
      derivedKind: bucket.kind,
      memberCount: bucket.members,
      customIndex: customIndexAbundanceSafetyHealthFreedom(
        le,
        gni,
        homicidesPer100k,
        hale,
        freedom
      ),
    });
  }
  out.sort((a, b) => b.customIndex - a.customIndex);
  return out;
}

function rounded(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function observationAsOfYear(yearMap, year, minSourceYear) {
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

function applyAbsolutePillars(point) {
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
  return true;
}

function buildFixedCohortSeries(entrySeries, countryRows, yearMin, yearMax) {
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
    const totals = { pop: 0, le: 0, hale: 0, gni: 0, hom: 0, freedom: 0 };
    for (const iso of cohort) {
      const point = pointByIsoYear.get(iso).get(year);
      const pop = point.population;
      totals.pop += pop;
      totals.le += point.le * pop;
      totals.hale += point.hale * pop;
      totals.gni += point.gni * pop;
      totals.hom += point.homicidesPer100k * pop;
      totals.freedom += point.freedom * pop;
    }
    const le = totals.le / totals.pop;
    const hale = totals.hale / totals.pop;
    const gni = totals.gni / totals.pop;
    const homicidesPer100k = totals.hom / totals.pop;
    const freedom = totals.freedom / totals.pop;
    const point = {
      year,
      le: rounded(le, 2),
      hale: rounded(hale, 2),
      gni: rounded(gni, 2),
      homicidesPer100k: rounded(homicidesPer100k, 3),
      freedom: rounded(freedom, 2),
      population: Math.round(totals.pop),
      n: cohort.length,
    };
    applyAbsolutePillars(point);
    point.value = point.customIndex;
    return point;
  });

  return { cohort, points };
}

function buildCountrySeries(iso, leByCY, gniByCY, homByCY, freedomByCY, popByCY, haleHistory, yearMin, yearMax) {
  const leM = leByCY.get(iso);
  const gniM = gniByCY.get(iso);
  const homM = homByCY.get(iso);
  const freedomM = freedomByCY.get(iso);
  const popM = popByCY.get(iso);
  const years = annualRange(yearMin, yearMax);
  const points = [];

  for (const y of years) {
    const leY = observationAsOfYear(leM, y, yearMin);
    const gniY = observationAsOfYear(gniM, y, yearMin);
    const homY = observationAsOfYear(homM, y, yearMin);
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
      point.gniYear = gniY.year;
      point.incomeSource = gniY.incomeSource;
    }
    if (homY) {
      point.homicidesPer100k = rounded(homY.value, 3);
      point.homicideYear = homY.year;
    }
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
      freedom: 0,
      members: 0,
      gniMembers: 0,
      gdpMembers: 0,
      estimatedHaleMembers: 0,
    };
    buckets.set(def.iso, bucket);
  }
  bucket.pop += pop;
  bucket.le += values.le * pop;
  bucket.hale += values.hale * pop;
  bucket.gni += values.gni * pop;
  bucket.hom += values.hom * pop;
  bucket.freedom += values.freedom * pop;
  bucket.members += 1;
  if (values.incomeSource === "GDP") bucket.gdpMembers += 1;
  else bucket.gniMembers += 1;
  if (values.haleEstimated) bucket.estimatedHaleMembers += 1;
}

function buildDerivedGroupSeries(leByCY, gniByCY, homByCY, freedomByCY, popByCY, haleHistory, countryMeta, yearMin, yearMax) {
  const byIso = new Map();
  const years = annualRange(yearMin, yearMax);

  for (const y of years) {
    const buckets = new Map();
    for (const [iso, meta] of countryMeta) {
      const leY = observationAsOfYear(leByCY.get(iso), y, yearMin);
      const gniY = observationAsOfYear(gniByCY.get(iso), y, yearMin);
      const homY = observationAsOfYear(homByCY.get(iso), y, yearMin);
      const freedomY = observationAsOfYear(freedomByCY.get(iso), y, yearMin);
      const popY = observationAsOfYear(popByCY.get(iso), y, yearMin);
      const hale = adjustedHaleAsOfYear(
        haleHistory,
        iso,
        y,
        leByCY.get(iso),
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
        hom: homY.value,
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
      const homicidesPer100k = bucket.hom / bucket.pop;
      const freedom = bucket.freedom / bucket.pop;
      if (!byIso.has(bucket.iso)) {
        byIso.set(bucket.iso, {
          definition:
            `Population-weighted annual timeline for ${SERIES_RANGE_LABEL}. World Bank supplies life expectancy, GNI per capita (PPP), GDP per capita (PPP) as an annual fallback when GNI is missing, intentional homicides/100k, population, and grouping metadata; WHO GHO supplies HALE only. Exact annual HALE is preferred; missing HALE years preserve the latest reported life-expectancy-minus-HALE gap and apply it to current life expectancy. Other inputs use exact same-year values when present, otherwise the latest prior value from ${SERIES_YEAR_MIN} onward. Future observations are not pulled backward.`,
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
        homicidesPer100k: rounded(homicidesPer100k, 3),
        freedom: rounded(freedom, 2),
        population: Math.round(bucket.pop),
        n: bucket.members,
      };
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

function sortRowsByIndex(rows) {
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

function rowsForDisplayYear(rows, entrySeries, displayYear) {
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
        homicidesPer100k: point.homicidesPer100k,
        homicideYear: point.homicideYear ?? row.homicideYear,
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

async function main() {
  const { data: worldBankData, countryMeta, summary: worldBankAudit } =
    await fetchAllWorldBankInputs();
  const leRows = worldBankData.lifeExpectancy.rows;
  const gniRows = worldBankData.gniPerCapita.rows;
  const gdpRows = worldBankData.gdpPerCapita.rows;
  const incomeRows = incomeRowsWithGdpFallback(gniRows, gdpRows);
  const homRows = worldBankData.intentionalHomicidesPer100k.rows;
  console.log("Fetching Human Freedom Index personal-freedom scores …");
  const freedomRows = await fetchHfiPersonalFreedom();
  const popRows = worldBankData.population.rows;
  console.log("Fetching WHO HALE (WHOSIS_000002) …");
  // Same cap as the WDI fetch: drop observations past the display window at the
  // source so every downstream consumer (latest rows, histories) is bounded.
  const haleRows = (await fetchAllWhoHale()).filter((r) => {
    const y = typeof r.TimeDim === "number" ? r.TimeDim : parseInt(String(r.TimeDim), 10);
    return Number.isFinite(y) && y <= SERIES_YEAR_MAX;
  });
  const leMap = latestByCountry(leRows);
  const gniMap = latestByCountry(incomeRows);
  const homicideMap = latestByCountry(homRows);
  const freedomMap = latestByCountry(freedomRows);
  const haleMap = latestHaleByIso(haleRows);
  const countryRows = mergeRows(leMap, gniMap, homicideMap, haleMap, freedomMap);
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
  const leByCY = byCountryYear(leRows);
  const gniByCY = byCountryYear(incomeRows);
  const homByCY = byCountryYear(homRows);
  const freedomByCY = byCountryYear(freedomRows);
  const popByCY = byCountryYear(popRows);
  const haleHistory = haleHistoryByIso(haleRows);
  const seriesYearMin = Math.max(yearMin, SERIES_YEAR_MIN);
  const seriesYearMax = Math.min(yearMax, SERIES_YEAR_MAX);
  let worldSeries = [];
  const entrySeries = {};
  for (const row of countryRows) {
    const points = buildCountrySeries(
      row.iso,
      leByCY,
      gniByCY,
      homByCY,
      freedomByCY,
      popByCY,
      haleHistory,
      seriesYearMin,
      seriesYearMax
    );
    if (points.length) {
      entrySeries[row.iso] = {
        definition:
          `Country annual timeline for ${SERIES_RANGE_LABEL}. World Bank supplies abundance (GNI per capita PPP, with GDP fallback), safety (intentional homicides/100k), life expectancy, and population; WHO GHO supplies HALE; the Cato/Fraser Human Freedom Index supplies Personal Freedom. Exact annual HALE is preferred; missing HALE years preserve the latest reported life-expectancy-minus-HALE gap and apply it to current life expectancy. Other inputs use exact same-year values when present, otherwise the latest prior value from ${SERIES_YEAR_MIN} onward. The Tomer index is stored only when all four pillars are available as of that year. Future observations are not pulled backward.`,
        points,
      };
    }
  }
  const derivedSeries = buildDerivedGroupSeries(
    leByCY,
    gniByCY,
    homByCY,
    freedomByCY,
    popByCY,
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
    generatedAt: new Date().toISOString(),
    yearWindow: DATE_RANGE,
    worldBankAudit,
    indicators: {
      lifeExpectancy: WB_LE,
      healthyLifeExpectancyHale: "WHO WHOSIS_000002 (HALE at birth, both sexes)",
      gniPerCapita: WB_GNI,
      gdpPerCapitaFallback: WB_GDP,
      intentionalHomicidesPer100k: WB_HOMICIDE,
      freedomPersonalFreedomSubIndex:
        "Human Freedom Index 2025 Personal Freedom components excluding Security and Safety, rescaled to 0-100",
      population: WB_POP,
    },
    sourcePolicy: {
      worldBank:
        "World Bank supplies life expectancy, GNI per capita (PPP), GDP per capita (PPP) only as an annual fallback when GNI is missing, intentional homicides/100k, population, and country/group metadata.",
      whoGho:
        "HALE is the only WHO GHO input: WHOSIS_000002, healthy life expectancy at birth, both sexes. Missing annual HALE values are estimated by preserving the latest reported life-expectancy-minus-HALE gap and applying it to current life expectancy.",
      humanFreedomIndex:
        "Freedom is derived from the Cato Institute and Fraser Institute Human Freedom Index 2025 Personal Freedom categories, excluding Security and Safety to keep it distinct from the tracker’s Safety pillar.",
    },
    derivedRows:
      "Derived rows are population-weighted aggregates computed from the country rows in this file using World Bank data for abundance, safety, life expectancy, and population; WHO GHO for HALE; and the Human Freedom Index for personal freedom. GNI per capita (PPP) is preferred for abundance; GDP per capita (PPP) is substituted only for country-years without GNI.",
    healthPillar:
      "LEI = ½·LEI(life expectancy) + ½·LEI(HALE); same 20–85 goalposts for both.",
    safetyNote:
      "Safety uses intentional homicides/100k only (comparable worldwide). Theft, assault, and sexual violence are not mixed in because definitions and reporting differ by country.",
    freedomNote:
      "Freedom averages the Personal Freedom categories for rule of law, movement, religion, association, expression, and relationships from the Cato/Fraser Human Freedom Index 2025, then rescales the result from 0-10 to 0-100. The Security and Safety category is excluded to keep the pillar distinct from Safety.",
    pillarNormalization:
      "Every base pillar is normalized against fixed goalposts, then combined directly. Scores are absolute and do not depend on other countries or the selected year.",
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

  const qualityByIso = Object.fromEntries(
    Object.entries(entrySeries)
      .map(([iso, series]) => [iso, dataQualityForSeries(series)])
      .filter(([, quality]) => quality)
  );
  const leaderboardPayload = {
    generatedAt: payload.generatedAt,
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
    qualityByIso,
    countries,
  };
  const seriesPayload = {
    generatedAt: payload.generatedAt,
    yearWindow: payload.yearWindow,
    entrySeries,
  };
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(ARCHIVE_DIR, { recursive: true });
  // Archive payload stays pretty-printed for inspection; the web files are
  // minified because they ship to the browser.
  await writeFile(OUT, JSON.stringify(payload, null, 2), "utf8");
  await writeFile(LEADERBOARD_OUT, JSON.stringify(leaderboardPayload), "utf8");
  await writeFile(SERIES_OUT, JSON.stringify(seriesPayload), "utf8");
  console.log(`Wrote ${countries.length} leaderboard rows → ${LEADERBOARD_OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
