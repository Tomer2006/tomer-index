import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  rowsForYear,
  rowsForSnapshot,
  sortedRows,
  readYear,
  readWeights,
  weightQuery,
  readList,
  readIso,
  readPicks,
  readSort,
  isCustomWeights,
  matchesSearch,
  countryRanks,
  tomerRanks,
  kindLabel,
  entryHref,
  matchesIncome,
  columnFor,
} from "../src/view-model.js";
import { DEFAULT_WEIGHT_POINTS } from "../src/index-weights.js";
import { yearSnapshots } from "../src/data-split.js";
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
    "warDeathsPer100k",
    "roadDeathsPer100k",
    "freedom",
    "customIndex",
    "leYear",
    "haleYear",
    "gniYear",
    "homicideYear",
    "warYear",
    "roadYear",
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
  // An empty value falls back to the default instead of meaning zero.
  assert.deepEqual(
    readWeights(new URLSearchParams("w_health=&w_safety=%20&w_freedom=0")),
    { ...DEFAULT_WEIGHT_POINTS, freedom: 0 },
  );
  const custom = { health: 0, safety: 22, freedom: 70, abundance: 8 };
  assert.deepEqual(
    readWeights(new URLSearchParams(weightQuery(custom))),
    custom,
  );
});

test("query readers trim, de-duplicate, upper-case and validate", () => {
  const params = new URLSearchParams(
    "region=UN-154,%20UN-030,UN-154,&iso=%20jpn%20&picks=usa,%20jpn,usa&sort=bogus",
  );
  assert.deepEqual(readList(params, "region"), ["UN-154", "UN-030"]);
  assert.deepEqual(readList(params, "missing"), []);
  assert.equal(readIso(params), "JPN");
  assert.deepEqual(readPicks(params), ["USA", "JPN", "USA"]);
  assert.equal(readSort(params), "tomer");
  assert.equal(readSort(new URLSearchParams("sort=homicides")), "homicides");
  // The death-total column it replaced falls back to the index.
  assert.equal(readSort(new URLSearchParams("sort=deaths")), "tomer");
  assert.equal(entryHref("JPN"), "/entry/JPN");
});

test("custom weights are detected only when the effective shares differ from the defaults", () => {
  assert.equal(isCustomWeights({ ...DEFAULT_WEIGHT_POINTS }), false);
  assert.equal(isCustomWeights({ ...DEFAULT_WEIGHT_POINTS, health: 41 }), true);
  // Proportional points rescale to the published 40/30/20/10.
  assert.equal(
    isCustomWeights({ health: 80, safety: 60, freedom: 40, abundance: 20 }),
    false,
  );
  assert.equal(
    isCustomWeights({ health: 4, safety: 3, freedom: 2, abundance: 1 }),
    false,
  );
  // All zeros fall back to the default weights.
  assert.equal(
    isCustomWeights({ health: 0, safety: 0, freedom: 0, abundance: 0 }),
    false,
  );
  assert.equal(
    isCustomWeights({ health: 0, safety: 0, freedom: 0, abundance: 10 }),
    true,
  );
  // The URL still records the raw slider points.
  assert.deepEqual(
    weightQuery({ health: 80, safety: 60, freedom: 40, abundance: 20 }),
    { w_health: 80, w_safety: 60, w_freedom: 40, w_abundance: 20 },
  );
});

test("ranks count countries only and skip rows missing the sort value", () => {
  const point = (iso, customIndex, extra = {}) => ({
    iso,
    name: iso,
    healthIndex: customIndex,
    safetyIndex: customIndex,
    freedomIndex: customIndex,
    abundanceIndex: customIndex,
    homicidesPer100k: extra.homicidesPer100k,
    ...extra,
  });
  const rows = [
    point("AAA", 0.9),
    point("GRP", 0.8, { derivedKind: "incomeLevel" }),
    point("BBB", 0.7, { homicidesPer100k: 3 }),
    point("CCC", NaN),
  ];
  const { ranks, total } = tomerRanks(rows);
  assert.deepEqual([...ranks], [["AAA", 1], ["BBB", 2]]);
  assert.equal(total, 2);
  const byDeaths = countryRanks(sortedRows(rows, "homicides"), "homicides");
  assert.deepEqual([...byDeaths], [["BBB", 1]]);
  const byName = countryRanks(sortedRows(rows, "name"), "name");
  assert.deepEqual([...byName.keys()], ["AAA", "BBB", "CCC"]);
});

test("tied values share a rank, so reversed sorts never show out-of-order ranks", () => {
  const rows = [
    { iso: "OMN", name: "Oman", homicidesPer100k: 0.1 },
    { iso: "SGP", name: "Singapore", homicidesPer100k: 0.069 },
    { iso: "WLD", name: "World", derivedKind: "world", homicidesPer100k: 0.069 },
    { iso: "QAT", name: "Qatar", homicidesPer100k: 0.069 },
    { iso: "BHR", name: "Bahrain", homicidesPer100k: 0.5 },
  ];
  const ranks = countryRanks(sortedRows(rows, "homicides"), "homicides");
  assert.deepEqual(Object.fromEntries(ranks), {
    QAT: 1,
    SGP: 1,
    OMN: 3,
    BHR: 4,
  });
  // Worst first keeps A–Z inside the tie; the shown ranks still never go up.
  const shown = sortedRows(rows, "homicides", false)
    .filter((row) => ranks.has(row.iso))
    .map((row) => ranks.get(row.iso));
  assert.deepEqual(shown, [4, 3, 1, 1]);
  // Every committed column: ranks are monotonic in both directions.
  const { countries } = JSON.parse(
    readFileSync(new URL("../public/data/leaderboard.json", import.meta.url)),
  );
  for (const key of ["tomer", "le", "hale", "health", "homicides", "freedom", "gni"]) {
    const best = countryRanks(sortedRows(countries, key), key);
    for (const bestFirst of [true, false]) {
      const order = sortedRows(countries, key, bestFirst)
        .filter((row) => best.has(row.iso))
        .map((row) => best.get(row.iso));
      const sorted = [...order].sort((a, b) => (bestFirst ? a - b : b - a));
      assert.deepEqual(order, sorted, `${key} bestFirst=${bestFirst}`);
    }
  }
});

test("past-year group rows carry that year's member count", () => {
  const latest = [
    { iso: "WLD", name: "World", derivedKind: "world", memberCount: 146 },
    { iso: "JPN", name: "Japan" },
  ];
  const series = {
    WLD: { points: [{ year: 2000, n: 94, le: 67 }] },
    JPN: { points: [{ year: 2000, le: 81 }] },
  };
  const [world, japan] = rowsForYear(latest, series, 2000);
  assert.equal(world.memberCount, 94);
  assert.equal(japan.memberCount, undefined);
  assert.equal(
    rowsForSnapshot(latest, { WLD: series.WLD.points[0] }, 2000)[0].memberCount,
    94,
  );
  assert.equal(rowsForYear(latest, series, YEAR_MAX)[0].memberCount, 146);
  // The committed data: World averaged 94 countries in 2000.
  const { countries } = JSON.parse(
    readFileSync(new URL("../public/data/leaderboard.json", import.meta.url)),
  );
  const { entrySeries } = JSON.parse(
    readFileSync(new URL("../public/data/series.json", import.meta.url)),
  );
  for (const row of rowsForYear(countries, entrySeries, 2000).filter(
    (row) => row.derivedKind,
  )) {
    const point = entrySeries[row.iso].points.find((p) => p.year === 2000);
    assert.equal(row.memberCount, point.n, row.iso);
  }
});

test("search and kind labels use reader-facing names", () => {
  const group = { iso: "HIC", name: "High income", derivedKind: "incomeLevel" };
  assert.equal(kindLabel(group), "Income group");
  assert.equal(kindLabel({ iso: "JPN", name: "Japan" }), "Country");
  assert.equal(matchesSearch(group, "income group"), true);
  assert.equal(matchesSearch(group, "incomelevel"), false);
  assert.equal(matchesSearch({ iso: "JPN", name: "Japan" }, "  jp "), true);
  assert.equal(matchesSearch({ iso: "JPN", name: "Japan" }, ""), true);
});

test("per-year snapshot files reproduce rowsForYear for every year", () => {
  const leaderboard = JSON.parse(readFileSync(new URL("../public/data/leaderboard.json", import.meta.url), "utf8"));
  const { entrySeries } = JSON.parse(readFileSync(new URL("../public/data/series.json", import.meta.url), "utf8"));
  const years = yearSnapshots(entrySeries);
  for (let year = YEAR_MIN; year <= YEAR_MAX; year++) {
    assert.deepEqual(
      rowsForSnapshot(leaderboard.countries, years[year], year),
      rowsForYear(leaderboard.countries, entrySeries, year),
      `year ${year}`,
    );
  }
});

test("income chips keep the matching income-group row, like region chips", () => {
  const hic = { iso: "HIC", name: "High income", derivedKind: "incomeLevel" };
  const japan = { iso: "JPN", name: "Japan", incomeLevel: { id: "HIC" } };
  const india = { iso: "IND", name: "India", incomeLevel: { id: "LMC" } };
  const world = { iso: "WLD", name: "World", derivedKind: "world" };
  const kept = (ids) =>
    [hic, japan, india, world]
      .filter((row) => matchesIncome(row, ids))
      .map((row) => row.iso);
  assert.deepEqual(kept([]), ["HIC", "JPN", "IND", "WLD"]);
  assert.deepEqual(kept(["HIC"]), ["HIC", "JPN"]);
  assert.deepEqual(kept(["LMC", "HIC"]), ["HIC", "JPN", "IND"]);
});

test("income per person keeps whole-dollar US formatting", () => {
  const { format } = columnFor("gni");
  assert.equal(format(85732.11), "85,732");
  assert.equal(format(999.5), "1,000");
  assert.equal(format(null), "—");
});

test("committed leaderboard ranks 1..N among countries only", () => {
  const { countries } = JSON.parse(
    readFileSync(new URL("../public/data/leaderboard.json", import.meta.url)),
  );
  const ranks = countryRanks(sortedRows(countries), "tomer");
  const scored = countries.filter((row) => !row.derivedKind);
  assert.equal(ranks.size, scored.length);
  // Ranks run 1..N; tied scores (countries at war all score 0) share the first rank of the tie.
  const values = [...ranks.values()];
  values.forEach((rank, i) =>
    assert.ok(rank === i + 1 || rank === values[i - 1], `rank ${rank} at ${i + 1}`),
  );
  for (const row of countries.filter((row) => row.derivedKind))
    assert.equal(ranks.has(row.iso), false, row.iso);
  assert.deepEqual(ranks, tomerRanks(countries).ranks);
});
