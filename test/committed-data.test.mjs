// Invariants of the committed public/data files. build-data.mjs needs the network, so these
// catch a stale or hand-edited dataset (or a scoring change that wasn't rebuilt) offline.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  combinedHealthLei,
  customIndexFromPillarsFull,
  freedomIndexFromScore,
  incomeIndexFromGni,
  safetyIndexFromHomicidesPer100k,
} from "../src/hdi-core.js";
import { YEAR_MIN, YEAR_MAX } from "../src/site-years.js";

const leaderboard = JSON.parse(
  readFileSync(new URL("../public/data/leaderboard.json", import.meta.url)),
);
const { entrySeries } = JSON.parse(
  readFileSync(new URL("../public/data/series.json", import.meta.url)),
);
const countries = leaderboard.countries.filter((row) => !row.derivedKind);
const groups = leaderboard.countries.filter((row) => row.derivedKind);

const INPUTS = [
  "le",
  "hale",
  "gni",
  "homicidesPer100k",
  "warDeathsPer100k",
  "roadDeathsPer100k",
  "freedom",
];
const PILLARS = ["abundanceIndex", "safetyIndex", "healthIndex", "freedomIndex"];
const SOURCE_YEARS = [
  "leYear",
  "haleYear",
  "gniYear",
  "homicideYear",
  "warYear",
  "roadYear",
  "freedomYear",
];
const GROUP_KINDS = ["world", "region", "adminregion", "incomeLevel", "lendingType"];

function rounded(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function latestPoint(iso) {
  return entrySeries[iso].points.find((point) => point.year === YEAR_MAX);
}

test("every row has one history and every history belongs to a row", () => {
  const rowIso = leaderboard.countries.map((row) => row.iso);
  assert.equal(new Set(rowIso).size, rowIso.length);
  assert.deepEqual([...rowIso].sort(), Object.keys(entrySeries).sort());
});

test("every scored country has all inputs and pillars in the latest year, matching its row", () => {
  assert.ok(countries.length > 100);
  for (const row of countries) {
    const point = latestPoint(row.iso);
    assert.ok(point, `${row.iso} has no ${YEAR_MAX} point`);
    for (const key of [...INPUTS, ...PILLARS, "customIndex"]) {
      assert.ok(Number.isFinite(point[key]), `${row.iso}/${YEAR_MAX}/${key}`);
      assert.equal(row[key], point[key], `${row.iso} row ${key}`);
    }
    for (const key of SOURCE_YEARS) assert.equal(row[key], point[key], `${row.iso} row ${key}`);
  }
});

test("rows are sorted by Tomer index", () => {
  const scores = leaderboard.countries.map((row) => row.customIndex);
  assert.ok(scores.every((score, i) => i === 0 || score <= scores[i - 1]));
});

test("history years and source years stay inside the window and never come from the future", () => {
  for (const [iso, entry] of Object.entries(entrySeries)) {
    const years = entry.points.map((point) => point.year);
    assert.ok(
      years.every((year, i) => i === 0 || year > years[i - 1]),
      `${iso} years not ascending`,
    );
    for (const point of entry.points) {
      assert.ok(point.year >= YEAR_MIN && point.year <= YEAR_MAX, `${iso}/${point.year}`);
      for (const key of SOURCE_YEARS) {
        if (point[key] == null) continue;
        assert.ok(Number.isInteger(point[key]), `${iso}/${point.year}/${key}`);
        assert.ok(
          point[key] >= YEAR_MIN && point[key] <= point.year,
          `${iso}/${point.year}/${key}=${point[key]}`,
        );
      }
    }
  }
});

test("stored pillars and Tomer index recompute from the stored inputs", () => {
  let checked = 0;
  for (const [iso, entry] of Object.entries(entrySeries)) {
    for (const point of entry.points) {
      if (!Number.isFinite(point.customIndex)) continue;
      const where = `${iso}/${point.year}`;
      const pillars = {
        abundance: rounded(incomeIndexFromGni(point.gni), 6),
        safety: rounded(safetyIndexFromHomicidesPer100k(point.homicidesPer100k), 6),
        health: rounded(combinedHealthLei(point.le, point.hale), 6),
        freedom: rounded(freedomIndexFromScore(point.freedom), 6),
      };
      assert.equal(point.abundanceIndex, pillars.abundance, `${where} abundance`);
      assert.equal(point.safetyIndex, pillars.safety, `${where} safety`);
      assert.equal(point.healthIndex, pillars.health, `${where} health`);
      assert.equal(point.freedomIndex, pillars.freedom, `${where} freedom`);
      assert.equal(point.customIndex, rounded(customIndexFromPillarsFull(pillars), 4), where);
      checked += 1;
    }
  }
  assert.ok(checked > 1000);
});

test("groups are named, typed World Bank groups with members, never 'Not classified'", () => {
  assert.ok(groups.length > 0);
  const names = groups.map((row) => row.name);
  assert.equal(new Set(names).size, names.length, "group names are unique");
  for (const row of groups) {
    assert.ok(!["LNX", "INX"].includes(row.iso), `${row.iso} is a residual World Bank class`);
    assert.notEqual(row.name, "Not classified");
    assert.ok(GROUP_KINDS.includes(row.derivedKind), `${row.iso} kind ${row.derivedKind}`);
    assert.ok(Number.isInteger(row.memberCount) && row.memberCount > 0, `${row.iso} members`);
    assert.equal(latestPoint(row.iso).n, row.memberCount, `${row.iso} member count`);
    assert.ok(Number.isFinite(row.customIndex), `${row.iso} score`);
  }
  const world = groups.find((row) => row.iso === "WLD");
  assert.equal(world.derivedKind, "world");
  assert.ok(groups.every((row) => row.memberCount <= world.memberCount));
});

test("the fixed-cohort trend covers every year with the same scored countries", () => {
  const { cohortSize, cohortIso, points } = leaderboard.globalAverageSeries;
  assert.equal(cohortIso.length, cohortSize);
  const scored = new Set(countries.map((row) => row.iso));
  for (const iso of cohortIso) {
    assert.ok(scored.has(iso), `${iso} in the cohort is not a scored country`);
    const scoredYears = entrySeries[iso].points.filter((point) =>
      Number.isFinite(point.customIndex),
    ).length;
    assert.equal(scoredYears, YEAR_MAX - YEAR_MIN + 1, `${iso} misses a year`);
  }
  assert.deepEqual(
    points.map((point) => point.year),
    Array.from({ length: YEAR_MAX - YEAR_MIN + 1 }, (_, i) => YEAR_MIN + i),
  );
  for (const point of points) {
    assert.equal(point.n, cohortSize);
    assert.ok(Number.isFinite(point.value) && point.value === point.customIndex);
  }
});
