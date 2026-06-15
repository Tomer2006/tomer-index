import test from "node:test";
import assert from "node:assert/strict";

import {
  leiFromYears,
  combinedHealthLei,
  safetyIndexFromHomicidesPer100k,
  incomeIndexFromGni,
  customIndexHealthIncomeSafety,
  customIndexHealthIncomeSafetyFull,
  incomeRowsWithGdpFallback,
  latestByCountry,
  byCountryYear,
  haleHistoryByIso,
  haleAsOfYear,
  adjustedHaleAsOfYear,
  mergeRows,
} from "../src/hdi-core.js";

function wbRow(iso, year, value, name = iso) {
  return {
    countryiso3code: iso,
    date: String(year),
    value,
    country: { value: name },
  };
}

test("income rows prefer annual GNI and use GDP only for missing country-years", () => {
  const rows = incomeRowsWithGdpFallback(
    [wbRow("AAA", 2022, 12000), wbRow("BBB", 2023, 9000)],
    [wbRow("AAA", 2022, 18000), wbRow("AAA", 2023, 19000), wbRow("CCC", 2023, 7000)]
  );
  const byYear = byCountryYear(rows);

  assert.deepEqual(byYear.get("AAA").get(2022), {
    value: 12000,
    name: "AAA",
    incomeSource: "GNI",
  });
  assert.deepEqual(byYear.get("AAA").get(2023), {
    value: 19000,
    name: "AAA",
    incomeSource: "GDP",
  });
  assert.equal(latestByCountry(rows).get("BBB").incomeSource, "GNI");
  assert.equal(latestByCountry(rows).get("CCC").incomeSource, "GDP");
});

const closeTo = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} ≈ ${expected}`);

test("leiFromYears uses 20–85 goalposts and clamps outside them", () => {
  assert.equal(leiFromYears(20), 0);
  assert.equal(leiFromYears(85), 1);
  closeTo(leiFromYears(52.5), 0.5);
  assert.equal(leiFromYears(10), 0);
  assert.equal(leiFromYears(100), 1);
});

test("combinedHealthLei averages lifespan and healthspan LEIs", () => {
  closeTo(combinedHealthLei(85, 20), 0.5);
  closeTo(combinedHealthLei(85, 85), 1);
  closeTo(combinedHealthLei(52.5, 52.5), 0.5);
});

test("safety index inverts homicides linearly with a 60/100k floor", () => {
  assert.equal(safetyIndexFromHomicidesPer100k(0), 1);
  assert.equal(safetyIndexFromHomicidesPer100k(60), 0);
  closeTo(safetyIndexFromHomicidesPer100k(30), 0.5);
  assert.equal(safetyIndexFromHomicidesPer100k(120), 0);
  assert.equal(safetyIndexFromHomicidesPer100k(-5), 1);
});

test("income index uses HDI log goalposts $100–$75,000 and clamps", () => {
  assert.equal(incomeIndexFromGni(100), 0);
  assert.equal(incomeIndexFromGni(75000), 1);
  assert.equal(incomeIndexFromGni(50), 0);
  assert.equal(incomeIndexFromGni(1e6), 1);
  // Log scaling: a doubling adds a constant amount.
  const step = incomeIndexFromGni(200) - incomeIndexFromGni(100);
  const step2 = incomeIndexFromGni(400) - incomeIndexFromGni(200);
  closeTo(step, step2);
});

test("index is the 4:4:1 weighted geometric mean of the pillars", () => {
  const le = 80;
  const hale = 70;
  const gni = 40000;
  const hom = 2;
  const health = combinedHealthLei(le, hale);
  const income = incomeIndexFromGni(gni);
  const safety = safetyIndexFromHomicidesPer100k(hom);
  const expected =
    Math.pow(health, 4 / 9) * Math.pow(income, 4 / 9) * Math.pow(safety, 1 / 9);
  closeTo(customIndexHealthIncomeSafetyFull(le, gni, hom, hale), expected);
});

test("homicide rates at or above 60/100k collapse the index to 0", () => {
  assert.equal(customIndexHealthIncomeSafetyFull(80, 40000, 60, 70), 0);
  assert.equal(customIndexHealthIncomeSafety(80, 40000, 75, 70), 0);
});

test("customIndexHealthIncomeSafety rounds to 3 decimals, Full does not", () => {
  const full = customIndexHealthIncomeSafetyFull(80, 40000, 2, 70);
  const rounded = customIndexHealthIncomeSafety(80, 40000, 2, 70);
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

test("mergeRows requires all four inputs and sorts by index descending", () => {
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
  const merged = mergeRows(le, gni, hom, hale);
  assert.deepEqual(
    merged.map((r) => r.iso),
    ["AAA", "BBB"]
  );
  assert.ok(merged[0].customIndex > merged[1].customIndex);
  assert.equal(merged[0].haleYear, 2021);
});
