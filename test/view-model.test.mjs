import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  rowsForYear,
  sortedRows,
  readYear,
  readWeights,
  weightQuery,
} from "../src/view-model.js";
import { DEFAULT_WEIGHT_POINTS } from "../src/index-weights.js";
import { YEAR_MIN, YEAR_MAX } from "../src/site-years.js";

test("historical snapshots never leak latest metrics or source years into missing observations", () => {
  const latest = [
    {
      iso: "TST",
      name: "Test",
      le: 80,
      hale: 70,
      leYear: 2024,
      haleYear: 2024,
      region: { id: "R" },
    },
  ];
  const series = { TST: { points: [{ year: 2000, le: 65, leYear: 1999 }] } };
  const [point] = rowsForYear(latest, series, 2000);
  assert.equal(point.le, 65);
  assert.equal(point.leYear, 1999);
  assert.equal(point.hale, undefined);
  assert.equal(point.haleYear, undefined);
  assert.equal(point.region.id, "R");
  assert.deepEqual(rowsForYear(latest, series, 2001), []);
  assert.equal(rowsForYear(latest, series, YEAR_MAX), latest);
});

test("every historical snapshot agrees with the committed dataset, including missing values", () => {
  const { countries } = JSON.parse(
    readFileSync(new URL("../public/data/leaderboard.json", import.meta.url)),
  );
  const { entrySeries } = JSON.parse(
    readFileSync(new URL("../public/data/series.json", import.meta.url)),
  );
  const keys = [
    "le",
    "hale",
    "gni",
    "homicidesPer100k",
    "freedom",
    "customIndex",
    "leYear",
    "haleYear",
    "gniYear",
    "homicideYear",
    "freedomYear",
  ];
  for (let year = YEAR_MIN; year < YEAR_MAX; year++) {
    const rows = rowsForYear(countries, entrySeries, year);
    assert.ok(rows.length > 100);
    for (const row of rows) {
      const original = entrySeries[row.iso].points.find(
        (point) => point.year === year,
      );
      for (const key of keys)
        assert.equal(row[key], original[key], `${row.iso}/${year}/${key}`);
    }
  }
});

test("sorting puts missing values last in both directions and honors lower-is-better metrics", () => {
  const rows = [
    { name: "High", homicidesPer100k: 10 },
    { name: "Missing", homicidesPer100k: null },
    { name: "Low", homicidesPer100k: 1 },
  ];
  assert.deepEqual(
    sortedRows(rows, "homicides").map((row) => row.name),
    ["Low", "High", "Missing"],
  );
  assert.deepEqual(
    sortedRows(rows, "homicides", false).map((row) => row.name),
    ["High", "Low", "Missing"],
  );
});

test("shared links validate years and weights and round-trip custom weights", () => {
  assert.equal(readYear(new URLSearchParams("year=1990")), 2000);
  assert.equal(readYear(new URLSearchParams("year=2030")), YEAR_MAX);
  assert.equal(readYear(new URLSearchParams("year=invalid")), YEAR_MAX);
  assert.deepEqual(
    readWeights(
      new URLSearchParams(
        "w_health=-1&w_safety=Infinity&w_freedom=101&w_abundance=no",
      ),
    ),
    DEFAULT_WEIGHT_POINTS,
  );
  const custom = { health: 0, safety: 22, freedom: 70, abundance: 8 };
  assert.deepEqual(
    readWeights(new URLSearchParams(weightQuery(custom))),
    custom,
  );
});
