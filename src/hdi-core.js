/** Shared HDI-style math + merging (used by the app and `scripts/build-data.mjs`). */

/**
 * Safety deaths (homicide, war and road crashes) per 100,000 people a year: none scores
 * 1, and 100 (1 in 1,000 people) scores 0. More deaths score below 0.
 */
const SAFETY_DEATHS_ZERO = 100;

/**
 * Life expectancy and HALE score 0 at 20 years and 1 at 85 years (UNDP's goalposts).
 * Neither is a limit: every year beyond 85, or short of 20, moves the score the same.
 */
const LE_ZERO = 20;
const LE_MARK = 85;

/**
 * Income scores 0 at $100 and 1 at $75,000 (UNDP's goalposts) on a log scale, and keeps
 * going past either.
 */
const INCOME_ZERO = 100;
const INCOME_MARK = 75000;

/** User-defined importance weights; sum to 1. */
export const INDEX_WEIGHTS = Object.freeze({
  abundance: 0.1,
  safety: 0.3,
  health: 0.4,
  freedom: 0.2,
});

/**
 * Weighted average of pillars normalized against fixed goalposts: 1 when every goalpost
 * is met, 0 when every pillar sits at its lowest. No pillar is capped or floored, so the
 * index has no limit either way.
 */
export function customIndexFromPillarsFull({ abundance, safety, health, freedom }) {
  return (
    INDEX_WEIGHTS.abundance * abundance +
    INDEX_WEIGHTS.safety * safety +
    INDEX_WEIGHTS.health * health +
    INDEX_WEIGHTS.freedom * freedom
  );
}

/**
 * Life Expectancy Index from years at birth (UNDP's LEI formula without its caps).
 * @param {number} years — life expectancy or HALE
 */
export function leiFromYears(years) {
  return (Number(years) - LE_ZERO) / (LE_MARK - LE_ZERO);
}

/**
 * Health pillar: ½ lifespan (life expectancy) + ½ healthspan (HALE), each as an LEI.
 */
export function combinedHealthLei(lifeExpectancyYears, haleYears) {
  return (
    0.5 * leiFromYears(lifeExpectancyYears) +
    0.5 * leiFromYears(haleYears)
  );
}

/** Safety deaths per 100,000: homicides, war deaths and road deaths. */
export function safetyDeathsPer100k(homicides, war, road) {
  return Number(homicides) + Number(war) + Number(road);
}

/**
 * Safety index from safety deaths per 100,000 (higher = safer), inverted linearly:
 * 1 with no deaths, 0 at 100, and below 0 beyond.
 */
export function safetyIndexFromDeathsPer100k(deathsPer100k) {
  return (SAFETY_DEATHS_ZERO - Number(deathsPer100k)) / SAFETY_DEATHS_ZERO;
}

/** Abundance pillar from GNI per capita (PPP) on HDI's log scale, without its caps. */
export function incomeIndexFromGni(gniPerCapita) {
  return Math.log(Number(gniPerCapita) / INCOME_ZERO) / Math.log(INCOME_MARK / INCOME_ZERO);
}

/** Freedom pillar 0-1 from the HFI-derived Personal Freedom score (0-100). */
export function freedomIndexFromScore(score) {
  return Number(score) / 100;
}

/**
 * Full-precision four-pillar index for aggregation and charting.
 * Use when aggregating or charting a time series so small year-to-year moves are not lost.
 */
export function customIndexAbundanceSafetyHealthFreedomFull(
  lifeExpectancy,
  gniPerCapita,
  deathsPer100k,
  healthyLifeExpectancy,
  freedomScore
) {
  return customIndexFromPillarsFull({
    abundance: incomeIndexFromGni(gniPerCapita),
    safety: safetyIndexFromDeathsPer100k(deathsPer100k),
    health: combinedHealthLei(lifeExpectancy, healthyLifeExpectancy),
    freedom: freedomIndexFromScore(freedomScore),
  });
}

/**
 * Importance-weighted average of abundance, safety, health, and freedom, to 3 decimals.
 */
export function customIndexAbundanceSafetyHealthFreedom(
  lifeExpectancy,
  gniPerCapita,
  deathsPer100k,
  healthyLifeExpectancy,
  freedomScore
) {
  return (
    Math.round(
      customIndexAbundanceSafetyHealthFreedomFull(
        lifeExpectancy,
        gniPerCapita,
        deathsPer100k,
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
 * War deaths per 100,000 from death counts (UCDP, by the country whose people died), which
 * only list country-years with deaths. Every other country-year with a population figure,
 * up to the latest year the source covers, had no war deaths and gets a 0 row, so
 * peaceful countries have a value and the latest year carries forward like other inputs.
 */
export function warDeathRows(deathRows, popRows) {
  const deaths = new Map();
  let latestYear = -Infinity;
  for (const row of deathRows) {
    if (!isCountryRow(row) || row.value == null) continue;
    const year = parseInt(String(row.date), 10);
    const value = Number(row.value);
    if (Number.isNaN(year) || !Number.isFinite(value)) continue;
    deaths.set(`${row.countryiso3code}|${year}`, value);
    latestYear = Math.max(latestYear, year);
  }
  const out = [];
  for (const row of popRows) {
    if (!isCountryRow(row) || row.value == null) continue;
    const year = parseInt(String(row.date), 10);
    const pop = Number(row.value);
    if (Number.isNaN(year) || year > latestYear || !(pop > 0)) continue;
    const count = deaths.get(`${row.countryiso3code}|${year}`) ?? 0;
    out.push({
      countryiso3code: row.countryiso3code,
      country: row.country,
      date: String(year),
      value: (count / pop) * 1e5,
    });
  }
  return out;
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
 * Each country's latest value of every input, scored together; health = ½ LE + ½ HALE.
 * Every argument maps ISO3 → `{ year, value, name }` (`latestByCountry`).
 * @param {{ le: Map, gni: Map, homicide: Map, war: Map, road: Map, hale: Map, freedom: Map }} latest
 */
export function mergeRows({ le: leMap, gni: gniMap, homicide, war, road, hale: haleMap, freedom: freedomMap }) {
  const merged = [];
  for (const [iso, le] of leMap) {
    const gni = gniMap.get(iso);
    const hom = homicide.get(iso);
    const warDeaths = war.get(iso);
    const roadDeaths = road.get(iso);
    const hale = haleMap.get(iso);
    const freedom = freedomMap.get(iso);
    if (!gni || !hom || !warDeaths || !roadDeaths || !hale || !freedom) continue;
    const deaths = safetyDeathsPer100k(hom.value, warDeaths.value, roadDeaths.value);
    const score = customIndexAbundanceSafetyHealthFreedom(
      le.value,
      gni.value,
      deaths,
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
      warYear: warDeaths.year,
      warDeathsPer100k: warDeaths.value,
      roadYear: roadDeaths.year,
      roadDeathsPer100k: roadDeaths.value,
      safetyDeathsPer100k: deaths,
      freedomYear: freedom.year,
      freedom: freedom.value,
      customIndex: score,
    });
  }
  merged.sort((a, b) => b.customIndex - a.customIndex);
  return merged;
}
