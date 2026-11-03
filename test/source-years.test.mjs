import test from "node:test";
import assert from "node:assert/strict";
import {
  sourceBadge,
  sourceYearParts,
  sourceYearSummary,
  STALE_YEARS,
} from "../src/source-years.js";
import { dataQualityForRow, dataQualityForSeries } from "../src/data-quality.js";
import { formatInt, formatTick, stepDecimals } from "../src/format.js";
import { compactNumber, metricDefs } from "../src/metric-defs.js";
import {
  normalizedWeightPoints,
  weightedIndexFromPillars,
} from "../src/index-weights.js";

const TOMER = ["leYear", "haleYear", "gniYear", "homicideYear", "freedomYear"];
// Estimated HALE, plain GDP income (as before a country's GNI starts), older inputs.
const row = {
  iso: "CHE",
  leYear: 2024,
  haleYear: 2021,
  haleEstimated: true,
  gniYear: 2025,
  incomeSource: "GDP",
  homicideYear: 2023,
  freedomYear: 2023,
};

test("compact badges keep the estimated and GDP qualifiers", () => {
  assert.equal(sourceBadge(row, ["haleYear"], 2025, { compact: true }).text, "est. 2021");
  assert.equal(sourceBadge(row, ["gniYear"], 2025, { compact: true }).text, "GDP 2025");
  assert.equal(sourceBadge(row, ["leYear"], 2025, { compact: true }).text, "2024");
});

test("multi-input ranges get an asterisk only when an input is estimated or GDP", () => {
  assert.equal(sourceBadge(row, TOMER, 2025, { compact: true }).text, "2021–2025*");
  assert.equal(
    sourceBadge(row, ["leYear", "haleYear"], 2025, { compact: true }).text,
    "2021–2024*",
  );
  const plain = { ...row, haleEstimated: false, incomeSource: "GNI" };
  assert.equal(sourceBadge(plain, TOMER, 2025, { compact: true }).text, "2021–2025");
  assert.equal(
    sourceBadge({ leYear: 2025, haleYear: 2025 }, ["leYear", "haleYear"], 2025, {
      compact: true,
    }).text,
    "2025",
  );
});

test("estimated HALE explains its source year in the description", () => {
  const badge = sourceBadge(row, ["haleYear"], 2025);
  assert.equal(badge.text, "HALE est. from 2021");
  assert.match(
    badge.description,
    /HALE for 2025 estimated from WHO's 2021 value, adjusted by life expectancy \(2024\)\./,
  );
  assert.match(sourceBadge(row, ["gniYear"], 2025).description, /GDP per person/);
});

test("estimated income is labeled like estimated HALE, from the GNI year it starts from", () => {
  const estimated = { ...row, gniYear: 2024, incomeSource: "GNI", incomeEstimated: true };
  assert.equal(sourceBadge(estimated, ["gniYear"], 2025, { compact: true }).text, "est. 2024");
  const badge = sourceBadge(estimated, ["gniYear"], 2025);
  assert.equal(badge.text, "GNI est. from 2024");
  assert.equal(
    badge.description,
    "Source year: GNI est. from 2024. Income for 2025 estimated from 2024 GNI, adjusted by the change in GDP per person since then.",
  );
  // Both estimates explain themselves, and the range gets its asterisk.
  const both = sourceBadge({ ...estimated, incomeSource: "GNI" }, TOMER, 2025);
  assert.match(both.description, /HALE for 2025 estimated from WHO's 2021 value/);
  assert.match(both.description, /Income for 2025 estimated from 2024 GNI/);
  assert.equal(
    sourceBadge({ ...estimated, haleEstimated: false }, TOMER, 2025, { compact: true }).text,
    "2021–2024*",
  );
  // Published GNI in the shown year needs no badge at all.
  assert.equal(
    sourceYearSummary({ gniYear: 2025, incomeSource: "GNI", incomeEstimated: false }, ["gniYear"], 2025),
    "",
  );
});

test("source years five or more years old are flagged as stale", () => {
  assert.equal(STALE_YEARS, 5);
  const old = { homicideYear: 2008 };
  const badge = sourceBadge(old, ["homicideYear"], 2025, { compact: true });
  assert.equal(badge.stale, true);
  assert.equal(badge.text, "2008");
  assert.match(badge.description, /Latest homicide data is from 2008 \(17 years earlier\)\./);
  assert.equal(sourceBadge({ homicideYear: 2021 }, ["homicideYear"], 2025, { compact: true }).stale, false);
  assert.equal(sourceBadge({ homicideYear: 2020 }, ["homicideYear"], 2025, { compact: true }).stale, true);
});

test("current years are muted, full badges hide them, and groups read as mixed", () => {
  const current = sourceBadge({ freedomYear: 2025 }, ["freedomYear"], 2025, { compact: true });
  assert.equal(current.current, true);
  assert.equal(sourceBadge({ freedomYear: 2025 }, ["freedomYear"], 2025), null);
  assert.equal(sourceBadge(row, ["gniYear"], 2025, { compact: true }).current, false);
  const group = { derivedKind: "world", leYear: "mixed", haleYear: "mixed" };
  const mixed = sourceBadge(group, ["leYear", "haleYear"], 2025, { compact: true });
  assert.equal(mixed.text, "mixed");
  assert.match(mixed.description, /population-weighted average of member countries/);
  assert.equal(sourceBadge({ derivedKind: "region" }, ["leYear"], 2010, { compact: true }).text, "mixed");
});

test("full badges list only differing years, but always the GDP fallback", () => {
  assert.deepEqual(
    sourceYearParts(row, TOMER, 2025).map((part) => part.label),
    ["Life exp.", "HALE est. from", "GDP", "Homicides", "Freedom"],
  );
  assert.equal(
    sourceYearSummary({ ...row, incomeSource: "GNI" }, ["gniYear"], 2025),
    "",
  );
  assert.equal(
    sourceYearSummary({ gniYear: 2025, incomeSource: "mixed" }, ["gniYear"], 2024),
    "GNI/GDP 2025",
  );
});

test("war and road deaths get their own badge labels and stale-data notes", () => {
  const safety = { homicideYear: 2023, warYear: 2024, roadYear: 2019 };
  const keys = ["homicideYear", "warYear", "roadYear"];
  assert.deepEqual(
    sourceYearParts(safety, keys, 2025).map((part) => part.label),
    ["Homicides", "War", "Road"],
  );
  const badge = sourceBadge(safety, keys, 2025, { compact: true });
  assert.equal(badge.text, "2019–2024");
  assert.equal(badge.stale, true);
  assert.match(badge.description, /Latest road death data is from 2019 \(6 years earlier\)\./);
});

test("history gaps are described with canonical labels and year ranges", () => {
  const points = [2000, 2001, 2002, 2003, 2004].map((year) => ({
    year,
    le: 80,
    hale: 70,
    gni: 40000,
    homicidesPer100k: year < 2003 ? null : 1,
    warDeathsPer100k: 0,
    roadDeathsPer100k: year === 2001 ? null : 4,
    freedom: year === 2000 ? null : 90,
    customIndex: year < 2003 ? null : 0.9,
  }));
  const quality = dataQualityForSeries({ points });
  assert.equal(quality.label, "History gaps");
  assert.equal(
    quality.description,
    "Some years between 2000 and 2025 are missing at least one index input (Homicides per 100k: 2000–2002; Road deaths per 100k: 2001; Freedom: 2000).",
  );
  assert.equal(quality.badPoints, 3);
  assert.equal(dataQualityForSeries({ points: points.slice(3) }), null);
});

test("dataQualityForRow rewords stored notes and needs no entry series", () => {
  const qualityByIso = {
    GRC: {
      label: "Incomplete data",
      description: "Homicides /100k and Personal freedom missing for 1 yearly point out of 26 points.",
      badPoints: 1,
      totalPoints: 26,
    },
  };
  const quality = dataQualityForRow({ iso: "GRC" }, null, qualityByIso);
  assert.equal(quality.label, "History gaps");
  assert.equal(
    quality.description,
    "Some years between 2000 and 2025 are missing at least one index input (Homicides per 100k and Freedom missing in 1 of 26 years).",
  );
  assert.equal(dataQualityForRow({ iso: "GRC" }, null, qualityByIso), quality);
  assert.equal(dataQualityForRow({ iso: "JPN" }, null, qualityByIso), null);
  assert.equal(dataQualityForRow({ iso: "JPN" }, null, null), null);
});

test("numbers use en-US formatting and tick precision follows the step", () => {
  assert.equal(formatInt(85732.4), "85,732");
  assert.equal(compactNumber(52522), "52.5K");
  assert.equal(compactNumber(112500, 1), "112.5K");
  assert.equal(stepDecimals(1), 0);
  assert.equal(stepDecimals(2.5), 1);
  assert.equal(stepDecimals(0.25), 2);
  assert.equal(formatTick(7.5, 2.5), "7.5");
  const axis = (key, value, step) =>
    metricDefs.find((metric) => metric.key === key).axis(value, step);
  assert.equal(axis("customIndex", 0.7, 0.1), "70");
  assert.equal(axis("customIndex", 0.725, 0.025), "72.5");
  assert.equal(axis("gni", 50000, 25000), "50K");
  assert.equal(axis("gni", 1250, 250), "1.25K");
});

test("cached weight normalization gives the same scores as normalizing each time", () => {
  const point = { healthIndex: 0.9, safetyIndex: 0.8, freedomIndex: 0.7, abundanceIndex: 0.6 };
  const custom = { health: 10, safety: 20, freedom: 30, abundance: 40 };
  const expected = (weights) => {
    const w = normalizedWeightPoints(weights);
    return (
      1 +
      (w.health * Math.log(0.9) +
        w.safety * Math.log(0.8) +
        w.freedom * Math.log(0.7) +
        w.abundance * Math.log(0.6))
    );
  };
  assert.equal(weightedIndexFromPillars(point, custom), expected(custom));
  assert.equal(weightedIndexFromPillars(point), expected());
  // Same values in a new object, then a changed value: the cache must notice.
  assert.equal(weightedIndexFromPillars(point, { ...custom }), expected(custom));
  const changed = { ...custom, abundance: 0 };
  assert.equal(weightedIndexFromPillars(point, changed), expected(changed));
  assert.ok(Number.isNaN(weightedIndexFromPillars({ ...point, safetyIndex: null }, custom)));
});
