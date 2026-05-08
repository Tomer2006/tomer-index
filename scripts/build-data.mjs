/**
 * Fetches World Bank indicators plus WHO GHO HALE and writes public/data/countries.json.
 * Run: npm run build-data (needs network once; commit the JSON for offline builds).
 */
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  latestByCountry,
  mergeRows,
  byCountryYear,
  haleHistoryByIso,
  haleAsOfYear,
  customIndexHealthIncomeSafety,
  customIndexHealthIncomeSafetyFull,
} from "../src/hdi-core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "public", "data", "countries.json");

const WB_BASE = "https://api.worldbank.org";
const WB_LE = "SP.DYN.LE00.IN";
const WB_GNI = "NY.GNP.PCAP.PP.KD";
/** Intentional homicides per 100,000 — standard cross-country safety proxy (UNODC/WDI). */
const WB_HOMICIDE = "VC.IHR.PSRC.P5";
/** Total population — weights the global time series. */
const WB_POP = "SP.POP.TOTL";
const WB_PER_PAGE = "500";

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
 * WDI `date=` upper bound (inclusive). Use current calendar year + 1 so each `npm run build-data`
 * requests the newest country-years the API has (leaderboard uses `latestByCountry` / `latestHaleByIso`
 * per series). Entry history pages are rendered on a fixed 2000-2023 timeline and keep source-year
 * metadata for each metric when the displayed year uses an observation from a nearby source year.
 */
const WDI_END_YEAR = new Date().getUTCFullYear() + 1;
const DATE_RANGE = `1960:${WDI_END_YEAR}`;
const DATE_RANGE_POP = `1960:${WDI_END_YEAR}`;
const SERIES_YEAR_MIN = 2000;
const SERIES_YEAR_MAX = 2023;

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
  popByCY,
  haleWldMap,
  yearMin,
  yearMax
) {
  const leM = leByCY.get(WB_WLD);
  const gniM = gniByCY.get(WB_WLD);
  const homM = homByCY.get(WB_WLD);
  const popM = popByCY.get(WB_WLD);
  const points = [];
  for (let y = yearMin; y <= yearMax; y++) {
    const leY = observationForTimelineYear(leM, y);
    const gniY = observationForTimelineYear(gniM, y);
    const homY = observationForTimelineYear(homM, y);
    const popY = observationForTimelineYear(popM, y);
    const hale = haleForTimelineYear(haleWldMap, WB_WLD, y);
    if (!leY || !gniY || !homY || !hale || !popY) continue;
    const p = popY.value;
    if (typeof p !== "number" || !Number.isFinite(p) || p <= 0) continue;
    const idx = customIndexHealthIncomeSafetyFull(
      leY.value,
      gniY.value,
      homY.value,
      hale.value
    );
    points.push({
      year: y,
      value: Math.round(idx * 10000) / 10000,
      leYear: leY.year,
      haleYear: hale.year,
      gniYear: gniY.year,
      homicideYear: homY.year,
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

async function fetchAllPages(indicator, dateRange = DATE_RANGE) {
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
        members: 0,
      };
      buckets.set(iso, bucket);
    }
    bucket.pop += pop;
    bucket.le += row.le * pop;
    bucket.hale += row.hale * pop;
    bucket.gni += row.gni * pop;
    bucket.hom += row.homicidesPer100k * pop;
    bucket.members += 1;
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
    out.push({
      iso: bucket.iso,
      name: bucket.name,
      leYear: "mixed",
      le,
      haleYear: "mixed",
      hale,
      gniYear: "mixed",
      gni,
      homicideYear: "mixed",
      homicidesPer100k,
      derivedKind: bucket.kind,
      memberCount: bucket.members,
      customIndex: customIndexHealthIncomeSafety(le, gni, homicidesPer100k, hale),
    });
  }
  out.sort((a, b) => b.customIndex - a.customIndex);
  return out;
}

function rounded(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function latestAsOfYear(yearMap, year) {
  if (!yearMap?.size) return null;
  let best = null;
  for (const [candidateYear, row] of yearMap) {
    if (candidateYear <= year && (!best || candidateYear > best.year)) {
      best = { ...row, year: candidateYear };
    }
  }
  return best;
}

function firstAfterYear(yearMap, year) {
  if (!yearMap?.size) return null;
  let best = null;
  for (const [candidateYear, row] of yearMap) {
    if (candidateYear > year && (!best || candidateYear < best.year)) {
      best = { ...row, year: candidateYear };
    }
  }
  return best;
}

function observationForTimelineYear(yearMap, year) {
  return latestAsOfYear(yearMap, year) ?? firstAfterYear(yearMap, year);
}

function firstHaleAfterYear(haleHistory, iso, year) {
  const rows = haleHistory.get(iso);
  if (!rows?.length) return null;
  return rows.find((row) => row.year > year) ?? null;
}

function haleForTimelineYear(haleHistory, iso, year) {
  return haleAsOfYear(haleHistory, iso, year) ?? firstHaleAfterYear(haleHistory, iso, year);
}

function annualRange(yearMin, yearMax) {
  const out = [];
  for (let y = yearMin; y <= yearMax; y++) out.push(y);
  return out;
}

function buildCountrySeries(iso, leByCY, gniByCY, homByCY, popByCY, haleHistory, yearMin, yearMax) {
  const leM = leByCY.get(iso);
  const gniM = gniByCY.get(iso);
  const homM = homByCY.get(iso);
  const popM = popByCY.get(iso);
  const years = annualRange(yearMin, yearMax);
  const points = [];

  for (const y of years) {
    const leY = observationForTimelineYear(leM, y);
    const gniY = observationForTimelineYear(gniM, y);
    const homY = observationForTimelineYear(homM, y);
    const popY = observationForTimelineYear(popM, y);
    const hale = haleForTimelineYear(haleHistory, iso, y);
    if (!leY || !gniY || !homY || !hale) continue;

    const idx = customIndexHealthIncomeSafetyFull(
      leY.value,
      gniY.value,
      homY.value,
      hale.value
    );
    const pop = popY?.value;
    points.push({
      year: y,
      le: rounded(leY.value, 2),
      leYear: leY.year,
      hale: rounded(hale.value, 2),
      haleYear: hale.year,
      gni: rounded(gniY.value, 2),
      gniYear: gniY.year,
      homicidesPer100k: rounded(homY.value, 3),
      homicideYear: homY.year,
      customIndex: rounded(idx, 4),
      ...(typeof pop === "number" && Number.isFinite(pop) && pop > 0
        ? { population: Math.round(pop) }
        : {}),
    });
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
      members: 0,
    };
    buckets.set(def.iso, bucket);
  }
  bucket.pop += pop;
  bucket.le += values.le * pop;
  bucket.hale += values.hale * pop;
  bucket.gni += values.gni * pop;
  bucket.hom += values.hom * pop;
  bucket.members += 1;
}

function buildDerivedGroupSeries(leByCY, gniByCY, homByCY, popByCY, haleHistory, countryMeta, yearMin, yearMax) {
  const byIso = new Map();
  const years = annualRange(yearMin, yearMax);

  for (const y of years) {
    const buckets = new Map();
    for (const [iso, meta] of countryMeta) {
      const leY = observationForTimelineYear(leByCY.get(iso), y);
      const gniY = observationForTimelineYear(gniByCY.get(iso), y);
      const homY = observationForTimelineYear(homByCY.get(iso), y);
      const popY = observationForTimelineYear(popByCY.get(iso), y);
      const hale = haleForTimelineYear(haleHistory, iso, y);
      const pop = popY?.value;
      if (!leY || !gniY || !homY || !hale) continue;
      if (typeof pop !== "number" || !Number.isFinite(pop) || pop <= 0) continue;

      const values = {
        le: leY.value,
        hale: hale.value,
        gni: gniY.value,
        hom: homY.value,
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
      const idx = customIndexHealthIncomeSafetyFull(le, gni, homicidesPer100k, hale);
      if (!byIso.has(bucket.iso)) {
        byIso.set(bucket.iso, {
          definition:
            "Population-weighted annual timeline for 2000-2023. World Bank supplies life expectancy, GNI per capita (PPP), intentional homicides/100k, population, and grouping metadata; WHO GHO supplies HALE only. Values are computed from the real country observations available for each displayed year: latest observation on or before the year, or the earliest later observation when no prior value exists. Metric source years are preserved in the data file for country rows; derived rows aggregate those observations.",
          points: [],
        });
      }
      byIso.get(bucket.iso).points.push({
        year: y,
        le: rounded(le, 2),
        hale: rounded(hale, 2),
        gni: rounded(gni, 2),
        homicidesPer100k: rounded(homicidesPer100k, 3),
        customIndex: rounded(idx, 4),
        population: Math.round(bucket.pop),
        n: bucket.members,
      });
    }
  }

  return byIso;
}

async function main() {
  console.log("Fetching", WB_LE, "…");
  const leRows = await fetchAllPages(WB_LE);
  console.log("Fetching", WB_GNI, "…");
  const gniRows = await fetchAllPages(WB_GNI);
  console.log("Fetching", WB_HOMICIDE, "…");
  const homRows = await fetchAllPages(WB_HOMICIDE);
  console.log("Fetching", WB_POP, "…");
  const popRows = await fetchAllPages(WB_POP, DATE_RANGE_POP);
  console.log("Fetching WHO HALE (WHOSIS_000002) …");
  const haleRows = await fetchAllWhoHale();
  console.log("Fetching WHO global HALE (GLOBAL / SEX_BTSX) for WLD time series …");
  const haleWldMap = await fetchHaleWldMapFromGlobalWho();
  console.log("Fetching World Bank country metadata …");
  const countryMeta = await fetchWorldBankCountryMeta();

  const leMap = latestByCountry(leRows);
  const gniMap = latestByCountry(gniRows);
  const homicideMap = latestByCountry(homRows);
  const haleMap = latestHaleByIso(haleRows);
  const countryRows = mergeRows(leMap, gniMap, homicideMap, haleMap);
  const popMap = latestByCountry(popRows);
  const derivedGroupRows = buildDerivedGroupRows(countryRows, popMap, countryMeta);
  const groupIso = new Set(derivedGroupRows.map((r) => r.iso));
  const countries = [
    ...countryRows.filter((r) => !groupIso.has(r.iso)),
    ...derivedGroupRows,
  ].sort((a, b) => b.customIndex - a.customIndex);

  const { yearMin, yearMax } = yearWindowFromRange(DATE_RANGE);
  const leByCY = byCountryYear(leRows);
  const gniByCY = byCountryYear(gniRows);
  const homByCY = byCountryYear(homRows);
  const popByCY = byCountryYear(popRows);
  const haleHistory = haleHistoryByIso(haleRows);
  const seriesYearMin = Math.max(yearMin, SERIES_YEAR_MIN);
  const seriesYearMax = Math.min(yearMax, SERIES_YEAR_MAX);
  const worldSeries = worldAggregateTomerSeries(
    leByCY,
    gniByCY,
    homByCY,
    popByCY,
    haleWldMap,
    seriesYearMin,
    seriesYearMax
  );
  const entrySeries = {};
  for (const row of countryRows) {
    const points = buildCountrySeries(
      row.iso,
      leByCY,
      gniByCY,
      homByCY,
      popByCY,
      haleHistory,
      seriesYearMin,
      seriesYearMax
    );
    if (points.length) {
      entrySeries[row.iso] = {
        definition:
          "Country annual timeline for 2000-2023. World Bank supplies life expectancy, GNI per capita (PPP), intentional homicides/100k, and population; WHO GHO supplies HALE only. Each value is a real source observation: latest observation on or before the displayed year, or the earliest later observation when no prior value exists. Source years are stored on each point for life expectancy, HALE, GNI, and homicides.",
        points,
      };
    }
  }
  for (const [iso, series] of buildDerivedGroupSeries(
    leByCY,
    gniByCY,
    homByCY,
    popByCY,
    haleHistory,
    countryMeta,
    seriesYearMin,
    seriesYearMax
  )) {
    if (series.points.length) entrySeries[iso] = series;
  }
  const firstP = worldSeries[0];
  const lastP = worldSeries[worldSeries.length - 1];
  const fmt4 = (v) => (v == null ? "—" : v.toFixed(4));
  const footNote =
    firstP && lastP
      ? `${firstP.year} ${fmt4(firstP.value)} → ${lastP.year} ${fmt4(
          lastP.value
        )}. World Bank WLD: life expectancy, GNI per capita (PPP), intentional homicides/100k, and population. WHO GHO: global healthy life expectancy (HALE) at birth, both sexes. Each displayed year uses the latest available observation on or before that year, or the earliest later observation when no prior value exists. Pop. = WLD world total.`
      : "";

  const payload = {
    generatedAt: new Date().toISOString(),
    yearWindow: DATE_RANGE,
    indicators: {
      lifeExpectancy: WB_LE,
      healthyLifeExpectancyHale: "WHO WHOSIS_000002 (HALE at birth, both sexes)",
      gniPerCapita: WB_GNI,
      intentionalHomicidesPer100k: WB_HOMICIDE,
      population: WB_POP,
    },
    sourcePolicy: {
      worldBank:
        "All non-HALE inputs come from World Bank: life expectancy, GNI per capita (PPP), intentional homicides/100k, population, and country/group metadata.",
      whoGho:
        "HALE is the only WHO GHO input: WHOSIS_000002, healthy life expectancy at birth, both sexes.",
    },
    derivedRows:
      "Derived rows are population-weighted aggregates computed from the country rows in this file using World Bank data for all non-HALE metrics and WHO GHO for HALE only. Added group types: World, regions, admin regions, income levels, lending types, plus Low & middle income, Middle income, IDA total, and IDA & IBRD total. No alternate metrics are substituted.",
    healthPillar:
      "LEI = ½·LEI(life expectancy) + ½·LEI(HALE); same 20–85 goalposts for both.",
    safetyNote:
      "Safety uses intentional homicides/100k only (comparable worldwide). Theft, assault, and sexual violence are not mixed in because definitions and reporting differ by country.",
    indexWeights: { lei: 4 / 9, income: 4 / 9, safety: 1 / 9 },
    globalAverageSeries: {
      definition:
        "Worldwide published timeline, not a sample of individual countries. Every displayed year from 2000-2023 uses real source observations: World Bank WLD (World) for SP.DYN.LE00.IN, NY.GNP.PCAP.PP.KD, VC.IHR.PSRC.P5, and SP.POP.TOTL, plus WHO GHO global HALE (WHOSIS_000002, GLOBAL, both sexes). World Bank supplies all non-HALE inputs; WHO GHO supplies HALE only. When a same-year observation is unavailable, the point uses the latest observation on or before that year, or the earliest later observation when no prior value exists. Source years are stored on each point.",
      chartTitle: "Worldwide aggregate (WLD + global HALE)",
      footNote,
      points: worldSeries,
    },
    entrySeries,
    countries,
  };

  await mkdir(join(ROOT, "public", "data"), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${countries.length} leaderboard rows → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
