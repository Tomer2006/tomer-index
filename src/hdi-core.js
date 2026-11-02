/** Shared HDI-style math + merging (used by the app and `scripts/build-data.mjs`). */

/** Homicides per 100,000: 0 = best safety, 60 = floor (worst) for the safety sub-index. */
const HOMICIDE_RATE_MAX = 60;

/** UNDP-style life table goalposts (years), applied to both life expectancy and HALE. */
const LE_MIN = 20;
const LE_MAX = 85;

/** User-defined importance weights; sum to 1. */
export const INDEX_WEIGHTS = Object.freeze({
  abundance: 0.1,
  safety: 0.3,
  health: 0.4,
  freedom: 0.2,
});

/** Weighted geometric mean of pillars normalized against fixed goalposts. */
export function customIndexFromPillarsFull({ abundance, safety, health, freedom }) {
  return (
    Math.pow(abundance, INDEX_WEIGHTS.abundance) *
    Math.pow(safety, INDEX_WEIGHTS.safety) *
    Math.pow(health, INDEX_WEIGHTS.health) *
    Math.pow(freedom, INDEX_WEIGHTS.freedom)
  );
}

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

/** Abundance pillar 0-1 from GNI per capita (PPP) using HDI log goalposts. */
export function incomeIndexFromGni(gniPerCapita) {
  const gni = Math.max(100, Math.min(Number(gniPerCapita), 75000));
  return (Math.log(gni) - Math.log(100)) / (Math.log(75000) - Math.log(100));
}

/** Freedom pillar 0-1 from the HFI-derived Personal Freedom score (0-100). */
export function freedomIndexFromScore(score) {
  return Math.max(0, Math.min(Number(score), 100)) / 100;
}

/**
 * Full-precision four-pillar index for aggregation and charting.
 * Use when aggregating or charting a time series so small year-to-year moves are not lost.
 */
export function customIndexAbundanceSafetyHealthFreedomFull(
  lifeExpectancy,
  gniPerCapita,
  homicidesPer100k,
  healthyLifeExpectancy,
  freedomScore
) {
  const health = combinedHealthLei(lifeExpectancy, healthyLifeExpectancy);
  const gni = Math.max(100, Math.min(Number(gniPerCapita), 75000));
  const incomeIndex =
    (Math.log(gni) - Math.log(100)) / (Math.log(75000) - Math.log(100));
  const si = safetyIndexFromHomicidesPer100k(homicidesPer100k);
  const freedom = freedomIndexFromScore(freedomScore);
  return customIndexFromPillarsFull({
    abundance: incomeIndex,
    safety: si,
    health,
    freedom,
  });
}

/**
 * Importance-weighted geometric index of abundance, safety, health, and freedom.
 */
export function customIndexAbundanceSafetyHealthFreedom(
  lifeExpectancy,
  gniPerCapita,
  homicidesPer100k,
  healthyLifeExpectancy,
  freedomScore
) {
  return (
    Math.round(
      customIndexAbundanceSafetyHealthFreedomFull(
        lifeExpectancy,
        gniPerCapita,
        homicidesPer100k,
        healthyLifeExpectancy,
        freedomScore
      ) * 1000
    ) / 1000
  );
}

export function isCountryRow(row) {
  const iso = row.countryiso3code;
  return typeof iso === "string" && /^[A-Z]{3}$/.test(iso);
}

/**
 * Build one annual PPP-income series. Published GNI is used as is. A year without GNI
 * takes the latest earlier GNI and moves it by the change in GDP per capita since that
 * year, so a missing GNI year never swaps in the other measure (Tajikistan's GDP is
 * half its GNI). Such rows keep `incomeSource: "GNI"` and carry `incomeBaseYear`, the
 * GNI year they start from. Plain GDP is used only before a country's first year with
 * both, since later observations are never pulled backward.
 */
export function incomeRowsWithGdpFallback(gniRows, gdpRows) {
  const byCountry = new Map();

  function addRows(rows, measure) {
    for (const row of rows) {
      if (!isCountryRow(row) || row.value == null) continue;
      const year = parseInt(String(row.date), 10);
      const value = Number(row.value);
      if (Number.isNaN(year) || !Number.isFinite(value)) continue;
      const iso = row.countryiso3code;
      if (!byCountry.has(iso)) byCountry.set(iso, new Map());
      const years = byCountry.get(iso);
      years.set(year, { ...years.get(year), [measure]: { ...row, value } });
    }
  }

  addRows(gniRows, "gni");
  addRows(gdpRows, "gdp");
  const out = [];
  for (const years of byCountry.values()) {
    // The latest year with both measures, and GNI as a multiple of GDP in that year.
    let base = null;
    for (const year of [...years.keys()].sort((a, b) => a - b)) {
      const { gni, gdp } = years.get(year);
      if (gni) {
        out.push({ ...gni, incomeSource: "GNI" });
        if (gdp?.value > 0) base = { year, ratio: gni.value / gdp.value };
      } else if (base) {
        out.push({
          ...gdp,
          value: gdp.value * base.ratio,
          incomeSource: "GNI",
          incomeBaseYear: base.year,
        });
      } else {
        out.push({ ...gdp, incomeSource: "GDP" });
      }
    }
  }
  return out;
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
      const observation = { year, value, name };
      if (r.incomeSource) observation.incomeSource = r.incomeSource;
      if (r.incomeBaseYear) observation.incomeBaseYear = r.incomeBaseYear;
      map.set(iso, observation);
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
    const observation = { value, name };
    if (r.incomeSource) observation.incomeSource = r.incomeSource;
    if (r.incomeBaseYear) observation.incomeBaseYear = r.incomeBaseYear;
    map.get(iso).set(year, observation);
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
export function haleAsOfYear(haleHistory, iso, year, minSourceYear = -Infinity) {
  const arr = haleHistory.get(iso);
  if (!arr?.length) return null;
  let best = null;
  for (const row of arr) {
    if (
      row.year >= minSourceYear &&
      row.year <= year &&
      (!best || row.year > best.year)
    ) {
      best = row;
    }
  }
  return best;
}

/**
 * HALE for a displayed year. Exact WHO observations are returned unchanged.
 * Otherwise preserve the latest observed LE - HALE gap and apply it to the
 * current life-expectancy value. The gap keeps its sign: WHO's HALE can exceed the
 * World Bank's life expectancy (Nigeria's does), and a gap clamped at 0 would drop
 * HALE to life expectancy in the first estimated year.
 */
export function adjustedHaleAsOfYear(
  haleHistory,
  iso,
  year,
  lifeExpectancyByYear,
  minSourceYear = -Infinity
) {
  const reported = haleAsOfYear(haleHistory, iso, year, minSourceYear);
  if (!reported) return null;
  if (reported.year === year) return reported;

  function lifeExpectancyAsOf(targetYear) {
    if (!lifeExpectancyByYear?.size) return null;
    let best = null;
    for (const [candidateYear, row] of lifeExpectancyByYear) {
      if (
        candidateYear >= minSourceYear &&
        candidateYear <= targetYear &&
        (!best || candidateYear > best.year)
      ) {
        best = { ...row, year: candidateYear };
      }
    }
    return best;
  }

  const baselineLe = lifeExpectancyAsOf(reported.year);
  const currentLe = lifeExpectancyAsOf(year);
  if (!baselineLe || !currentLe) return reported;

  const unhealthyYears = baselineLe.value - reported.value;
  const value = Math.max(20, currentLe.value - unhealthyYears);
  return {
    year: reported.year,
    value,
    estimated: true,
    adjustmentYear: currentLe.year,
    baselineLifeExpectancyYear: baselineLe.year,
  };
}

/**
 * Health + income + safety (homicide-based SI); health = ½ LE + ½ HALE.
 * @param {Map<string, { year: number, value: number, name: string }>} leMap
 * @param {Map<string, { year: number, value: number, name: string }>} gniMap
 * @param {Map<string, { year: number, value: number, name: string }>} homicideMap
 * @param {Map<string, { year: number, value: number, name: string }>} haleMap
 */
export function mergeRows(leMap, gniMap, homicideMap, haleMap, freedomMap) {
  const merged = [];
  for (const [iso, le] of leMap) {
    const gni = gniMap.get(iso);
    const hom = homicideMap.get(iso);
    const hale = haleMap.get(iso);
    const freedom = freedomMap.get(iso);
    if (!gni || !hom || !hale || !freedom) continue;
    const score = customIndexAbundanceSafetyHealthFreedom(
      le.value,
      gni.value,
      hom.value,
      hale.value,
      freedom.value
    );
    merged.push({
      iso,
      name: le.name || gni.name,
      leYear: le.year,
      le: le.value,
      haleYear: hale.year,
      hale: hale.value,
      // Estimated income is dated by the GNI year it starts from, as estimated HALE is.
      gniYear: gni.incomeBaseYear ?? gni.year,
      gni: gni.value,
      incomeSource: gni.incomeSource,
      ...(gni.incomeBaseYear && { incomeEstimated: true }),
      homicideYear: hom.year,
      homicidesPer100k: hom.value,
      freedomYear: freedom.year,
      freedom: freedom.value,
      customIndex: score,
    });
  }
  merged.sort((a, b) => b.customIndex - a.customIndex);
  return merged;
}
