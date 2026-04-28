/** Shared HDI-style math + merging (used by the app and `scripts/build-data.mjs`). */

/** Homicides per 100,000: 0 = best safety, 60 = floor (worst) for the safety sub-index. */
const HOMICIDE_RATE_MAX = 60;

/** UNDP-style life table goalposts (years), applied to both life expectancy and HALE. */
const LE_MIN = 20;
const LE_MAX = 85;

/** Weighted geometric mean, ratio 4 : 4 : 1 — safety is 4× less influential than each of LEI and income. */
const W_LEI = 4 / 9;
const W_INCOME = 4 / 9;
const W_SAFETY = 1 / 9;

/**
 * Life Expectancy Index from years at birth (same formula as UNDP LEI for full lifespan).
 * @param {number} years — life expectancy or HALE
 */
export function leiFromYears(years) {
  const y = Math.max(LE_MIN, Math.min(Number(years), LE_MAX));
  return (y - LE_MIN) / (LE_MAX - LE_MIN);
}

/**
 * Health pillar: ½ lifespan (life expectancy) + ½ healthspan (HALE), each as LEI-style 0–1.
 */
export function combinedHealthLei(lifeExpectancyYears, haleYears) {
  return (
    0.5 * leiFromYears(lifeExpectancyYears) +
    0.5 * leiFromYears(haleYears)
  );
}

/**
 * Safety index 0–1 from intentional homicide rate (higher = safer).
 * Uses a linear inversion: SI = (max − h) / max with h clamped to [0, max].
 */
export function safetyIndexFromHomicidesPer100k(homicidesPer100k) {
  const h = Math.max(0, Math.min(Number(homicidesPer100k), HOMICIDE_RATE_MAX));
  return (HOMICIDE_RATE_MAX - h) / HOMICIDE_RATE_MAX;
}

/** Original 2-pillar index: √(LEI × Income Index) — health + income only. */
export function customHdiNoEducation(lifeExpectancy, gniPerCapita) {
  const lei = leiFromYears(lifeExpectancy);
  const gni = Math.max(100, Math.min(Number(gniPerCapita), 75000));
  const incomeIndex =
    (Math.log(gni) - Math.log(100)) / (Math.log(75000) - Math.log(100));
  const customIndex = Math.sqrt(lei * incomeIndex);
  return Math.round(customIndex * 1000) / 1000;
}

/**
 * Same formula as `customIndexHealthIncomeSafety` but full float precision (no rounding).
 * Use when aggregating or charting a time series so small year-to-year moves are not lost.
 */
export function customIndexHealthIncomeSafetyFull(
  lifeExpectancy,
  gniPerCapita,
  homicidesPer100k,
  healthyLifeExpectancy
) {
  const lei = combinedHealthLei(lifeExpectancy, healthyLifeExpectancy);
  const gni = Math.max(100, Math.min(Number(gniPerCapita), 75000));
  const incomeIndex =
    (Math.log(gni) - Math.log(100)) / (Math.log(75000) - Math.log(100));
  const si = safetyIndexFromHomicidesPer100k(homicidesPer100k);
  return (
    Math.pow(lei, W_LEI) *
    Math.pow(incomeIndex, W_INCOME) *
    Math.pow(si, W_SAFETY)
  );
}

/**
 * 3-pillar weighted geometric index: LEI_combined^(4/9) × Income^(4/9) × Safety^(1/9)
 * LEI_combined = ½·LEI(lifespan) + ½·LEI(HALE healthspan).
 */
export function customIndexHealthIncomeSafety(
  lifeExpectancy,
  gniPerCapita,
  homicidesPer100k,
  healthyLifeExpectancy
) {
  return (
    Math.round(
      customIndexHealthIncomeSafetyFull(
        lifeExpectancy,
        gniPerCapita,
        homicidesPer100k,
        healthyLifeExpectancy
      ) * 1000
    ) / 1000
  );
}

export function isCountryRow(row) {
  const iso = row.countryiso3code;
  return typeof iso === "string" && /^[A-Z]{3}$/.test(iso);
}

/** @param {object[]} rows World Bank API rows */
export function latestByCountry(rows) {
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

/**
 * World Bank rows → map of ISO → (year → { value, name }).
 * @param {object[]} rows
 * @returns {Map<string, Map<number, { value: number, name: string }>>}
 */
export function byCountryYear(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!isCountryRow(r) || r.value == null) continue;
    const iso = r.countryiso3code;
    const year = parseInt(String(r.date), 10);
    if (Number.isNaN(year)) continue;
    const value = Number(r.value);
    const name = r.country?.value ?? iso;
    if (!map.has(iso)) map.set(iso, new Map());
    map.get(iso).set(year, { value, name });
  }
  return map;
}

/**
 * WHO HALE rows → map of ISO → sorted [{ year, value }, …] (one entry per year).
 * @param {object[]} rows — GHO WHOSIS_000002 style
 * @returns {Map<string, { year: number, value: number }[]>}
 */
export function haleHistoryByIso(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r.SpatialDimType !== "COUNTRY" || r.Dim1 !== "SEX_BTSX") continue;
    if (r.NumericValue == null || Number.isNaN(Number(r.NumericValue))) continue;
    const iso = r.SpatialDim;
    if (typeof iso !== "string" || !/^[A-Z]{3}$/.test(iso)) continue;
    const year = r.TimeDim;
    const y = typeof year === "number" ? year : parseInt(String(year), 10);
    if (Number.isNaN(y)) continue;
    const value = Number(r.NumericValue);
    if (!map.has(iso)) map.set(iso, []);
    map.get(iso).push({ year: y, value });
  }
  for (const [iso, arr] of map) {
    arr.sort((a, b) => a.year - b.year);
    const deduped = [];
    for (const row of arr) {
      const last = deduped[deduped.length - 1];
      if (last && last.year === row.year) deduped[deduped.length - 1] = row;
      else deduped.push(row);
    }
    map.set(iso, deduped);
  }
  return map;
}

/**
 * Latest HALE value on or before `year` (inclusive).
 * @param {Map<string, { year: number, value: number }[]>} haleHistory
 * @param {string} iso
 * @param {number} year
 * @returns {{ year: number, value: number } | null}
 */
export function haleAsOfYear(haleHistory, iso, year) {
  const arr = haleHistory.get(iso);
  if (!arr?.length) return null;
  let best = null;
  for (const row of arr) {
    if (row.year <= year && (!best || row.year > best.year)) best = row;
  }
  return best;
}

/**
 * Health + income + safety (homicide-based SI); health = ½ LE + ½ HALE.
 * @param {Map<string, { year: number, value: number, name: string }>} leMap
 * @param {Map<string, { year: number, value: number, name: string }>} gniMap
 * @param {Map<string, { year: number, value: number, name: string }>} homicideMap
 * @param {Map<string, { year: number, value: number, name: string }>} haleMap
 */
export function mergeRows(leMap, gniMap, homicideMap, haleMap) {
  const merged = [];
  for (const [iso, le] of leMap) {
    const gni = gniMap.get(iso);
    const hom = homicideMap.get(iso);
    const hale = haleMap.get(iso);
    if (!gni || !hom || !hale) continue;
    const score = customIndexHealthIncomeSafety(
      le.value,
      gni.value,
      hom.value,
      hale.value
    );
    merged.push({
      iso,
      name: le.name || gni.name,
      leYear: le.year,
      le: le.value,
      haleYear: hale.year,
      hale: hale.value,
      gniYear: gni.year,
      gni: gni.value,
      homicideYear: hom.year,
      homicidesPer100k: hom.value,
      customIndex: score,
    });
  }
  merged.sort((a, b) => b.customIndex - a.customIndex);
  return merged;
}
