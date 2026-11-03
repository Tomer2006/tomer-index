import test from "node:test";
import assert from "node:assert/strict";

import {
  leiFromYears,
  combinedHealthLei,
  safetyDeathsPer100k,
  safetyIndexFromDeathsPer100k,
  incomeIndexFromGni,
  freedomIndexFromScore,
  customIndexAbundanceSafetyHealthFreedom,
  customIndexAbundanceSafetyHealthFreedomFull,
  INDEX_WEIGHTS,
  incomeRowsWithGdpFallback,
  latestByCountry,
  byCountryYear,
  haleHistoryByIso,
  haleAsOfYear,
  adjustedHaleAsOfYear,
  mergeRows,
  warDeathRows,
} from "../src/hdi-core.js";

function wbRow(iso, year, value, name = iso) {
  return {
    countryiso3code: iso,
    date: String(year),
    value,
    country: { value: name },
  };
}

test("income rows use GNI, extend it by GDP growth, and use plain GDP only before GNI starts", () => {
  const rows = incomeRowsWithGdpFallback(
    [wbRow("AAA", 2022, 12000), wbRow("BBB", 2023, 9000)],
    [
      wbRow("AAA", 2021, 17000),
      wbRow("AAA", 2022, 18000),
      wbRow("AAA", 2023, 19800),
      wbRow("CCC", 2023, 7000),
    ]
  );
  const byYear = byCountryYear(rows);

  // Before AAA's first GNI, GDP as published (later GNI is never pulled backward).
  assert.deepEqual(byYear.get("AAA").get(2021), {
    value: 17000,
    name: "AAA",
    incomeSource: "GDP",
  });
  assert.deepEqual(byYear.get("AAA").get(2022), {
    value: 12000,
    name: "AAA",
    incomeSource: "GNI",
  });
  // 2023 has no GNI: 2022's GNI grows with GDP (+10%), not a switch to GDP's level.
  const estimated = byYear.get("AAA").get(2023);
  assert.ok(Math.abs(estimated.value - 13200) < 1e-6, `${estimated.value} ≈ 13200`);
  assert.equal(estimated.incomeSource, "GNI");
  assert.equal(estimated.incomeBaseYear, 2022);
  assert.equal(latestByCountry(rows).get("AAA").incomeBaseYear, 2022);
  assert.equal(latestByCountry(rows).get("BBB").incomeSource, "GNI");
  assert.equal(latestByCountry(rows).get("BBB").incomeBaseYear, undefined);
  assert.equal(latestByCountry(rows).get("CCC").incomeSource, "GDP");
});

const closeTo = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} ≈ ${expected}`);

test("leiFromYears scores 20 years 0 and 85 years 1, with no cap either way", () => {
  assert.equal(leiFromYears(20), 0);
  assert.equal(leiFromYears(85), 1);
  closeTo(leiFromYears(52.5), 0.5);
  closeTo(leiFromYears(7), -0.2);
  // Each year past 85 adds as much as a year below it.
  closeTo(leiFromYears(150), 2);
});

test("combinedHealthLei averages lifespan and healthspan LEIs", () => {
  closeTo(combinedHealthLei(85, 20), 0.5);
  closeTo(combinedHealthLei(85, 85), 1);
  closeTo(combinedHealthLei(52.5, 52.5), 0.5);
});

test("safety adds homicide, war and road deaths and inverts them, 0 at 100/100k and below past it", () => {
  assert.equal(safetyDeathsPer100k(0.5, 0, 2.3), 2.8);
  assert.equal(safetyIndexFromDeathsPer100k(0), 1);
  assert.equal(safetyIndexFromDeathsPer100k(100), 0);
  closeTo(safetyIndexFromDeathsPer100k(25), 0.75);
  assert.equal(safetyIndexFromDeathsPer100k(300), -2);
});

test("war deaths are battle deaths per 100k, 0 in peaceful years up to the source's last year", () => {
  const pop = [2019, 2020, 2021, 2022].flatMap((year) => [
    wbRow("AAA", year, 2e6),
    wbRow("BBB", year, 5e6),
  ]);
  const battle = [wbRow("AAA", 2020, 1000), wbRow("AAA", 2021, null), wbRow("CCC", 2021, 50)];
  const byYear = byCountryYear(warDeathRows(battle, pop));
  assert.equal(byYear.get("AAA").get(2020).value, 50);
  assert.equal(byYear.get("AAA").get(2019).value, 0);
  assert.equal(byYear.get("AAA").get(2021).value, 0);
  assert.equal(byYear.get("BBB").get(2021).value, 0);
  // The source ends in 2021: 2022 has no row, so it carries 2021 forward.
  assert.equal(byYear.get("AAA").has(2022), false);
  // No population, no rate.
  assert.equal(byYear.has("CCC"), false);
});

test("income index uses HDI log goalposts $100–$75,000, with no cap either way", () => {
  assert.equal(incomeIndexFromGni(100), 0);
  closeTo(incomeIndexFromGni(75000), 1);
  closeTo(incomeIndexFromGni(50), -incomeIndexFromGni(200));
  // Log scaling: a doubling adds a constant amount, above the goalpost too.
  const step = incomeIndexFromGni(200) - incomeIndexFromGni(100);
  closeTo(incomeIndexFromGni(400) - incomeIndexFromGni(200), step);
  closeTo(incomeIndexFromGni(150000) - incomeIndexFromGni(75000), step);
  // $75,000² / $100 is as far above the goalpost as $75,000 is above $100.
  closeTo(incomeIndexFromGni(75000 * 750), 2);
});

test("freedom index maps the 0-100 personal-freedom score to 0-1", () => {
  assert.equal(freedomIndexFromScore(0), 0);
  assert.equal(freedomIndexFromScore(50), 0.5);
  assert.equal(freedomIndexFromScore(100), 1);
});

test("index uses the declared 40/30/20/10 dimension weights", () => {
  const le = 80;
  const hale = 70;
  const gni = 40000;
  const deaths = 12;
  const health = combinedHealthLei(le, hale);
  const income = incomeIndexFromGni(gni);
  const safety = safetyIndexFromDeathsPer100k(deaths);
  const freedom = 0.8;
  const expected =
    INDEX_WEIGHTS.abundance * income +
    INDEX_WEIGHTS.safety * safety +
    INDEX_WEIGHTS.health * health +
    INDEX_WEIGHTS.freedom * freedom;
  assert.equal(Object.values(INDEX_WEIGHTS).reduce((sum, weight) => sum + weight, 0), 1);
  closeTo(customIndexAbundanceSafetyHealthFreedomFull(le, gni, deaths, hale, 80), expected);
});

test("the index passes 1 once health or income goes past its goalpost", () => {
  closeTo(customIndexAbundanceSafetyHealthFreedomFull(85, 75000, 0, 85, 100), 1);
  const longer = customIndexAbundanceSafetyHealthFreedomFull(100, 75000, 0, 90, 100);
  const richer = customIndexAbundanceSafetyHealthFreedomFull(85, 150000, 0, 85, 100);
  assert.ok(longer > 1, `longer lives score ${longer}`);
  assert.ok(richer > 1, `higher income scores ${richer}`);
  closeTo(customIndexAbundanceSafetyHealthFreedomFull(150, 1e6, 0, 140, 100), 1.4084, 1e-4);
});

test("the index keeps falling past 100 violent and road deaths per 100k, below 0", () => {
  const at = (deaths) => customIndexAbundanceSafetyHealthFreedomFull(70, 3000, deaths, 60, 40);
  // Each extra death per 100k costs the safety weight / 100, past 100 too.
  closeTo(at(100) - at(200), INDEX_WEIGHTS.safety);
  assert.ok(at(400) < 0, `400 deaths per 100k score ${at(400)}`);
  assert.equal(customIndexAbundanceSafetyHealthFreedom(70, 3000, 400, 60, 40), -0.492);
  // Every pillar at its lower goalpost scores 0.
  closeTo(customIndexAbundanceSafetyHealthFreedomFull(20, 100, 100, 20, 0), 0);
});

test("four-pillar index rounds to 3 decimals, Full does not", () => {
  const full = customIndexAbundanceSafetyHealthFreedomFull(80, 40000, 2, 70, 80);
  const rounded = customIndexAbundanceSafetyHealthFreedom(80, 40000, 2, 70, 80);
  assert.equal(rounded, Math.round(full * 1000) / 1000);
});

test("latestByCountry keeps the newest observation per ISO", () => {
  const rows = [
    { countryiso3code: "SWE", date: "2020", value: 1, country: { value: "Sweden" } },
    { countryiso3code: "SWE", date: "2022", value: 2, country: { value: "Sweden" } },
    { countryiso3code: "SWE", date: "2021", value: 3, country: { value: "Sweden" } },
    { countryiso3code: "1W", date: "2022", value: 9, country: { value: "World" } },
    { countryiso3code: "NOR", date: "2022", value: null },
  ];
  const map = latestByCountry(rows);
  assert.equal(map.size, 1);
  assert.deepEqual(map.get("SWE"), { year: 2022, value: 2, name: "Sweden" });
});

test("byCountryYear indexes values by ISO then year", () => {
  const rows = [
    { countryiso3code: "FIN", date: "2020", value: 5, country: { value: "Finland" } },
    { countryiso3code: "FIN", date: "2021", value: 6, country: { value: "Finland" } },
  ];
  const map = byCountryYear(rows);
  assert.equal(map.get("FIN").get(2021).value, 6);
});

test("haleAsOfYear returns the latest observation on or before the year", () => {
  const history = haleHistoryByIso([
    { SpatialDimType: "COUNTRY", SpatialDim: "JPN", Dim1: "SEX_BTSX", TimeDim: 2000, NumericValue: 71 },
    { SpatialDimType: "COUNTRY", SpatialDim: "JPN", Dim1: "SEX_BTSX", TimeDim: 2019, NumericValue: 74 },
    { SpatialDimType: "COUNTRY", SpatialDim: "JPN", Dim1: "SEX_BTSX", TimeDim: 2021, NumericValue: 73.8 },
    { SpatialDimType: "REGION", SpatialDim: "EUR", Dim1: "SEX_BTSX", TimeDim: 2021, NumericValue: 70 },
    { SpatialDimType: "COUNTRY", SpatialDim: "JPN", Dim1: "SEX_MLE", TimeDim: 2021, NumericValue: 70 },
  ]);
  assert.deepEqual(haleAsOfYear(history, "JPN", 2020), { year: 2019, value: 74 });
  assert.deepEqual(haleAsOfYear(history, "JPN", 2021), { year: 2021, value: 73.8 });
  assert.equal(haleAsOfYear(history, "JPN", 1999), null);
  assert.equal(haleAsOfYear(history, "EUR", 2021), null);
});

test("adjustedHaleAsOfYear preserves the latest reported unhealthy-life gap", () => {
  const history = haleHistoryByIso([
    { SpatialDimType: "COUNTRY", SpatialDim: "AAA", Dim1: "SEX_BTSX", TimeDim: 2021, NumericValue: 70 },
  ]);
  const lifeExpectancy = new Map([
    [2021, { value: 80, name: "Alpha" }],
    [2024, { value: 82, name: "Alpha" }],
  ]);

  assert.deepEqual(adjustedHaleAsOfYear(history, "AAA", 2021, lifeExpectancy, 2000), {
    year: 2021,
    value: 70,
  });
  assert.deepEqual(adjustedHaleAsOfYear(history, "AAA", 2024, lifeExpectancy, 2000), {
    year: 2021,
    value: 72,
    estimated: true,
    adjustmentYear: 2024,
    baselineLifeExpectancyYear: 2021,
  });
});

test("adjustedHaleAsOfYear keeps a negative gap instead of dropping HALE to life expectancy", () => {
  // Nigeria-like: WHO's HALE is above the World Bank's life expectancy.
  const history = haleHistoryByIso([
    { SpatialDimType: "COUNTRY", SpatialDim: "NGA", Dim1: "SEX_BTSX", TimeDim: 2021, NumericValue: 54.95 },
  ]);
  const lifeExpectancy = new Map([
    [2021, { value: 53.46, name: "Nigeria" }],
    [2022, { value: 54.08, name: "Nigeria" }],
    [2023, { value: 18, name: "Nigeria" }],
  ]);
  const in2022 = adjustedHaleAsOfYear(history, "NGA", 2022, lifeExpectancy, 2000);
  closeTo(in2022.value, 55.57, 1e-9);
  assert.equal(in2022.estimated, true);
  // Still never below the 20-year goalpost (18 + 1.49 would be).
  assert.equal(adjustedHaleAsOfYear(history, "NGA", 2023, lifeExpectancy, 2000).value, 20);
});

test("mergeRows requires every metric and sorts by index descending", () => {
  const le = new Map([
    ["AAA", { year: 2023, value: 84, name: "Alpha" }],
    ["BBB", { year: 2023, value: 60, name: "Beta" }],
    ["CCC", { year: 2023, value: 80, name: "Gamma" }],
  ]);
  const gni = new Map([
    ["AAA", { year: 2023, value: 60000, name: "Alpha" }],
    ["BBB", { year: 2023, value: 3000, name: "Beta" }],
    // CCC missing GNI → dropped.
  ]);
  const hom = new Map([
    ["AAA", { year: 2023, value: 0.5, name: "Alpha" }],
    ["BBB", { year: 2023, value: 30, name: "Beta" }],
    ["CCC", { year: 2023, value: 1, name: "Gamma" }],
  ]);
  const hale = new Map([
    ["AAA", { year: 2021, value: 73, name: "Alpha" }],
    ["BBB", { year: 2021, value: 52, name: "Beta" }],
    ["CCC", { year: 2021, value: 70, name: "Gamma" }],
  ]);
  const freedom = new Map([
    ["AAA", { year: 2023, value: 95, name: "Alpha" }],
    ["BBB", { year: 2023, value: 40, name: "Beta" }],
    ["CCC", { year: 2023, value: 80, name: "Gamma" }],
  ]);
  const war = new Map([
    ["AAA", { year: 2023, value: 0, name: "Alpha" }],
    ["BBB", { year: 2023, value: 4, name: "Beta" }],
    ["CCC", { year: 2023, value: 0, name: "Gamma" }],
  ]);
  const road = new Map([
    ["AAA", { year: 2019, value: 2.5, name: "Alpha" }],
    ["BBB", { year: 2019, value: 20, name: "Beta" }],
    ["CCC", { year: 2019, value: 5, name: "Gamma" }],
  ]);
  const merged = mergeRows({ le, gni, homicide: hom, war, road, hale, freedom });
  assert.deepEqual(
    merged.map((r) => r.iso),
    ["AAA", "BBB"]
  );
  assert.ok(merged[0].customIndex > merged[1].customIndex);
  assert.equal(merged[0].haleYear, 2021);
  assert.equal(merged[0].roadYear, 2019);
  assert.equal(merged[1].safetyDeathsPer100k, 54);
  // A country without a road death rate isn't scored.
  road.delete("AAA");
  assert.deepEqual(
    mergeRows({ le, gni, homicide: hom, war, road, hale, freedom }).map((r) => r.iso),
    ["BBB"]
  );
});
