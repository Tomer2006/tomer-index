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
 * 3-pillar weighted geometric index: LEI_combined^(4/9) × Income^(4/9) × Safety^(1/9)
 * LEI_combined = ½·LEI(lifespan) + ½·LEI(HALE healthspan).
 */
export function customIndexHealthIncomeSafety(
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
  const customIndex =
    Math.pow(lei, W_LEI) *
    Math.pow(incomeIndex, W_INCOME) *
    Math.pow(si, W_SAFETY);
  return Math.round(customIndex * 1000) / 1000;
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
