/**
 * Fetches World Bank + WHO GHO indicators and writes public/data/countries.json.
 * Run: npm run build-data (needs network once; commit the JSON for offline builds).
 */
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { latestByCountry, mergeRows } from "../src/hdi-core.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "public", "data", "countries.json");

const WB_BASE = "https://api.worldbank.org";
const WB_LE = "SP.DYN.LE00.IN";
const WB_GNI = "NY.GNP.PCAP.PP.KD";
/** Intentional homicides per 100,000 — standard cross-country safety proxy (UNODC/WDI). */
const WB_HOMICIDE = "VC.IHR.PSRC.P5";
const WB_PER_PAGE = "500";

/** WHO GHO: Healthy life expectancy (HALE) at birth, both sexes. */
const WHO_HALE_URL = "https://ghoapi.azureedge.net/api/WHOSIS_000002";
const WHO_HALE_FILTER = "SpatialDimType eq 'COUNTRY' and Dim1 eq 'SEX_BTSX'";

async function fetchWorldBankJson(urlString, indicator) {
  const maxAttempts = 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(urlString);
    if (res.ok) return res.json();
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

/** Limit years so pagination stays fast; latest year per country still found inside the window. */
const DATE_RANGE = "2000:2025";

async function fetchAllPages(indicator) {
  const out = [];
  let page = 1;
  for (;;) {
    const url = new URL(
      `${WB_BASE}/v2/country/all/indicator/${encodeURIComponent(indicator)}`
    );
    url.searchParams.set("format", "json");
    url.searchParams.set("date", DATE_RANGE);
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

async function main() {
  console.log("Fetching", WB_LE, "…");
  const leRows = await fetchAllPages(WB_LE);
  console.log("Fetching", WB_GNI, "…");
  const gniRows = await fetchAllPages(WB_GNI);
  console.log("Fetching", WB_HOMICIDE, "…");
  const homRows = await fetchAllPages(WB_HOMICIDE);
  console.log("Fetching WHO HALE (WHOSIS_000002) …");
  const haleRows = await fetchAllWhoHale();

  const leMap = latestByCountry(leRows);
  const gniMap = latestByCountry(gniRows);
  const homicideMap = latestByCountry(homRows);
  const haleMap = latestHaleByIso(haleRows);
  const countries = mergeRows(leMap, gniMap, homicideMap, haleMap);

  const payload = {
    generatedAt: new Date().toISOString(),
    yearWindow: DATE_RANGE,
    indicators: {
      lifeExpectancy: WB_LE,
      healthyLifeExpectancyHale: "WHO WHOSIS_000002 (HALE at birth, both sexes)",
      gniPerCapita: WB_GNI,
      intentionalHomicidesPer100k: WB_HOMICIDE,
    },
    healthPillar:
      "LEI = ½·LEI(life expectancy) + ½·LEI(HALE); same 20–85 goalposts for both.",
    safetyNote:
      "Safety uses intentional homicides/100k only (comparable worldwide). Theft, assault, and sexual violence are not mixed in because definitions and reporting differ by country.",
    indexWeights: { lei: 4 / 9, income: 4 / 9, safety: 1 / 9 },
    countries,
  };

  await mkdir(join(ROOT, "public", "data"), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${countries.length} countries → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
