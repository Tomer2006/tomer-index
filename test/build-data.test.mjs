import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

import {
  byCountryYear,
  haleHistoryByIso,
  incomeRowsWithGdpFallback,
} from "../src/hdi-core.js";

// Every test passes its own fetchImpl. Real fetch stays blocked for the whole file, so a
// broken `import.meta.main` guard can't reach the network or rewrite public/data from here.
globalThis.fetch = async (url) => {
  throw new Error(`build-data tests must not fetch: ${url}`);
};
const pipeline = await import("../scripts/build-data.mjs");

const {
  UNCLASSIFIED_GROUP_IDS,
  observationAsOfYear,
  buildCountrySeries,
  buildDerivedGroupSeries,
  buildFixedCohortSeries,
  groupDefsForCountry,
  countryMetaFromWorldBank,
  fetchJsonWithRetry,
  fetchAllPages,
  fetchAllWhoHale,
  worldBankPayloadError,
  hfiRowsFromColumns,
  hfiColumnsFromText,
  cachedHfiRows,
  cachedFreedomLosses,
  fetchHfiPersonalFreedom,
  cachedHaleRows,
  cachedHaleLosses,
  fetchWhoHaleOrCached,
  datasetStats,
  sanityProblems,
  shrinkRefusalMessage,
} = pipeline;

const NO_WAIT = { retryDelayMs: 0 };

function wbRow(iso, year, value) {
  return { countryiso3code: iso, date: String(year), value, country: { value: iso } };
}

function whoRow(iso, year, value) {
  return {
    SpatialDimType: "COUNTRY",
    SpatialDim: iso,
    Dim1: "SEX_BTSX",
    TimeDim: year,
    NumericValue: value,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** fetch stand-in answering each call from `answers` in order and recording the URLs. */
function scriptedFetch(answers) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? answer(url, init) : answer();
  };
  return { impl, calls };
}

/**
 * Series inputs and HALE history for countries with the same value in every listed year.
 * War deaths default to 0 and road deaths to 5 per 100k; pass null to leave one out.
 */
function inputs(countries) {
  const rows = { le: [], gni: [], homicide: [], war: [], road: [], freedom: [], pop: [] };
  const hale = [];
  for (const c of countries) {
    const values = { war: 0, road: 5, ...c, homicide: c.hom };
    for (const year of c.years) {
      for (const key of Object.keys(rows))
        if (values[key] != null) rows[key].push(wbRow(c.iso, year, values[key]));
      if (c.hale != null) hale.push(whoRow(c.iso, year, c.hale));
    }
  }
  const byCY = Object.fromEntries(
    Object.entries(rows).map(([key, list]) => [key, byCountryYear(list)])
  );
  byCY.gni = byCountryYear(incomeRowsWithGdpFallback(rows.gni, []));
  return [byCY, haleHistoryByIso(hale)];
}

/**
 * Imports `moduleUrl` in a fresh Node process where fetch and the node:fs/promises calls
 * build-data.mjs uses end the process at once, and reports what was touched. Otherwise the
 * process exits when its event loop drains, so work started after an await is caught too.
 */
function importInFreshProcess(moduleUrl) {
  const probe = `
    import { writeSync } from "node:fs";
    import fsp from "node:fs/promises";
    import { syncBuiltinESMExports } from "node:module";
    const touched = [];
    let exported = [];
    process.on("exit", (code) => writeSync(1, JSON.stringify({ code, touched, exported })));
    const block = (name) => (target) => {
      touched.push(name + " " + String(target));
      process.exit(70);
    };
    globalThis.fetch = block("fetch");
    for (const name of ["readFile", "writeFile", "mkdir", "rename", "stat"]) {
      fsp[name] = block(name);
    }
    syncBuiltinESMExports();
    exported = Object.keys(await import(${JSON.stringify(moduleUrl)}));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.ok(child.stdout, `the import probe printed nothing: ${child.error ?? child.stderr}`);
  return { ...JSON.parse(child.stdout), stderr: child.stderr };
}

test("importing build-data.mjs does not start the build", () => {
  const report = importInFreshProcess(
    new URL("../scripts/build-data.mjs", import.meta.url).href
  );
  assert.deepEqual(report.touched, [], "main() ran on import");
  assert.equal(report.code, 0, report.stderr);
  assert.ok(report.exported.includes("sanityProblems"));
});

test("the import probe catches work a module starts after its import resolves", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "import-probe-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "unguarded.mjs");
  await writeFile(
    file,
    [
      'import { readFile } from "node:fs/promises";',
      "async function main() {",
      "  await new Promise((resolve) => setTimeout(resolve, 20));",
      '  await readFile("committed.json");',
      "}",
      "main();",
      "export const helper = 1;",
    ].join("\n")
  );
  const report = importInFreshProcess(pathToFileURL(file).href);
  assert.deepEqual(report.touched, ["readFile committed.json"]);
  assert.equal(report.code, 70);
});

test("carry-forward uses the latest earlier observation and never a later one", () => {
  const byYear = new Map([
    [2001, { value: 1 }],
    [2005, { value: 5 }],
  ]);
  assert.equal(observationAsOfYear(byYear, 2000, 2000), null);
  assert.deepEqual(observationAsOfYear(byYear, 2003, 2000), { value: 1, year: 2001 });
  assert.deepEqual(observationAsOfYear(byYear, 2005, 2000), { value: 5, year: 2005 });
  assert.equal(observationAsOfYear(byYear, 2003, 2002), null);

  const [byCY] = inputs([
    {
      iso: "AAA",
      years: [2000, 2001, 2002, 2003, 2004, 2005],
      gni: 20000,
      hom: 2,
      freedom: 80,
      pop: 1e6,
    },
  ]);
  // Road deaths stop in 2003 and carry forward, as the World Bank's end in 2019.
  byCY.road = byCountryYear([2000, 2001, 2002, 2003].map((year) => wbRow("AAA", year, 4)));
  byCY.le = byCountryYear([wbRow("AAA", 2001, 70), wbRow("AAA", 2004, 72)]);
  const hale = haleHistoryByIso([whoRow("AAA", 2002, 62)]);
  const points = buildCountrySeries("AAA", byCY, hale, 2000, 2005);
  const byPointYear = new Map(points.map((point) => [point.year, point]));
  assert.equal(byPointYear.get(2000).le, undefined);
  assert.equal(byPointYear.get(2000).customIndex, undefined);
  assert.equal(byPointYear.get(2003).leYear, 2001);
  assert.equal(byPointYear.get(2005).leYear, 2004);
  assert.equal(byPointYear.get(2001).hale, undefined, "HALE from 2002 must not reach 2001");
  assert.ok(Number.isFinite(byPointYear.get(2002).customIndex));
  assert.equal(byPointYear.get(2005).roadYear, 2003);
  assert.equal(byPointYear.get(2005).roadDeathsPer100k, 4);
  const sourceKeys = ["leYear", "haleYear", "gniYear", "homicideYear", "warYear", "roadYear", "freedomYear"];
  for (const point of points) {
    for (const key of sourceKeys) {
      if (point[key] != null) assert.ok(point[key] <= point.year, `${point.year} ${key}`);
    }
  }
  const inputKeys = ["le", "hale", "gni", "homicidesPer100k", "freedom"];
  for (const point of points.filter((p) => Number.isFinite(p.customIndex))) {
    for (const key of inputKeys) {
      assert.ok(Number.isFinite(point[key]), `${point.year} index without ${key}`);
    }
  }
});

const META = {
  AAA: {
    region: { id: "ECS", name: "Europe & Central Asia" },
    incomeLevel: { id: "HIC", name: "High income" },
    lendingType: { id: "LNX", name: "Not classified" },
  },
  BBB: {
    region: { id: "ECS", name: "Europe & Central Asia" },
    incomeLevel: { id: "LMC", name: "Lower middle income" },
    lendingType: { id: "IDX", name: "IDA only" },
  },
  CCC: {
    region: { id: "ECS", name: "Europe & Central Asia" },
    incomeLevel: { id: "LMC", name: "Lower middle income" },
    lendingType: { id: "IDX", name: "IDA only" },
  },
  DDD: {
    region: { id: "ECS", name: "Europe & Central Asia" },
    incomeLevel: { id: "LMC", name: "Lower middle income" },
    lendingType: { id: "IDX", name: "IDA only" },
  },
};

test("group series are population-weighted and skip members missing a scored input", () => {
  const countryMeta = new Map(Object.entries(META));
  const series = buildDerivedGroupSeries(
    ...inputs([
      { iso: "AAA", years: [2020], le: 60, hale: 50, gni: 10000, hom: 4, war: 40, road: 20, freedom: 60, pop: 1e6 },
      { iso: "BBB", years: [2020], le: 80, hale: 70, gni: 30000, hom: 0, road: 4, freedom: 100, pop: 3e6 },
      // CCC lacks freedom, so it counts towards no group. DDD lacks road deaths, which
      // aren't scored: it counts everywhere but the road death average.
      { iso: "CCC", years: [2020], le: 40, hale: 30, gni: 1000, hom: 40, pop: 9e6 },
      { iso: "DDD", years: [2020], le: 40, hale: 30, gni: 1000, hom: 40, road: null, freedom: 50, pop: 4e6 },
    ]),
    countryMeta,
    2020,
    2020
  );
  const [world] = series.get("WLD").points;
  assert.equal(world.n, 3);
  assert.equal(world.population, 8e6);
  assert.equal(world.le, 57.5);
  assert.equal(world.hale, 47.5);
  assert.equal(world.gni, 13000);
  assert.equal(world.homicidesPer100k, 20.5);
  assert.equal(world.warDeathsPer100k, 5);
  assert.equal(world.roadDeathsPer100k, 8);
  assert.equal(world.freedom, 70);
  assert.ok(Number.isFinite(world.customIndex));
  assert.equal(series.get("ECS").points[0].n, 3);
  assert.equal(series.get("HIC").points[0].n, 1);
  assert.equal(series.get("LMC").points[0].le, 57.14);
  assert.equal(series.get("IDA_TOTAL").points[0].n, 2);
  assert.equal(series.get("LMY").points[0].n, 2);
  assert.ok(!series.has("LNX"), "LNX is not a group");
});

test("World Bank 'Not classified' groups never become group rows", () => {
  assert.deepEqual([...UNCLASSIFIED_GROUP_IDS].sort(), ["INX", "LNX"]);
  const defs = (meta) => groupDefsForCountry(meta).map((def) => def.iso);
  assert.deepEqual(defs(META.AAA), ["WLD", "ECS", "HIC"]);
  assert.deepEqual(
    defs({
      region: { id: "LCN", name: "Latin America & Caribbean" },
      incomeLevel: { id: "INX", name: "Not classified" },
      lendingType: { id: "IBD", name: "IBRD only" },
    }),
    ["WLD", "LCN", "IBD", "IDA_IBRD_TOTAL"]
  );
  assert.deepEqual(defs(META.BBB), [
    "WLD",
    "ECS",
    "LMC",
    "LMY",
    "MIC",
    "IDX",
    "IDA_TOTAL",
    "IDA_IBRD_TOTAL",
  ]);
});

test("country metadata skips aggregates and keeps trimmed group names", () => {
  const meta = countryMetaFromWorldBank([
    {
      id: "ABW",
      name: "Aruba",
      region: { id: "LCN", value: "Latin America & Caribbean " },
      adminregion: { id: "", value: "" },
      incomeLevel: { id: "HIC", value: "High income" },
      lendingType: { id: "LNX", value: "Not classified" },
    },
    {
      id: "AFE",
      name: "Africa Eastern and Southern",
      region: { id: "NA", value: "Aggregates" },
      incomeLevel: { id: "NA", value: "Aggregates" },
      lendingType: { id: "", value: "Aggregates" },
    },
    {
      id: "BGD",
      name: "Bangladesh",
      region: { id: "SAS", value: "South Asia" },
      adminregion: { id: "SAS", value: "South Asia" },
      incomeLevel: { id: "LMC", value: "Lower middle income" },
      lendingType: { id: "IDX", value: "IDA" },
    },
  ]);
  assert.deepEqual([...meta.keys()], ["ABW", "BGD"]);
  assert.deepEqual(meta.get("ABW").region, { id: "LCN", name: "Latin America & Caribbean" });
  assert.equal(meta.get("ABW").adminregion, null);
  assert.equal(meta.get("BGD").lendingType.name, "IDA only");
});

test("the fixed cohort keeps only countries with a score in every year", () => {
  const point = (year, value, population) => ({
    year,
    le: value,
    hale: value - 10,
    gni: 20000,
    homicidesPer100k: 1,
    warDeathsPer100k: 0,
    roadDeathsPer100k: 4,
    freedom: 80,
    population,
    customIndex: 0.8,
  });
  const entrySeries = {
    AAA: { points: [point(2000, 70, 1e6), point(2001, 72, 1e6)] },
    BBB: { points: [point(2000, 80, 3e6), point(2001, 80, 3e6)] },
    CCC: { points: [point(2001, 50, 5e6)] },
  };
  const { cohort, points } = buildFixedCohortSeries(
    entrySeries,
    [{ iso: "AAA" }, { iso: "BBB" }, { iso: "CCC" }],
    2000,
    2001
  );
  assert.deepEqual(cohort, ["AAA", "BBB"]);
  assert.deepEqual(
    points.map((p) => [p.year, p.n, p.population, p.le]),
    [
      [2000, 2, 4e6, 77.5],
      [2001, 2, 4e6, 78],
    ]
  );
  assert.ok(points.every((p) => p.value === p.customIndex && Number.isFinite(p.value)));
});

const WB_ERROR = [
  {
    message: [
      { id: "120", key: "Invalid value", value: "The provided parameter value is not valid" },
    ],
  },
];

function wbPage(page, pages, total, rows) {
  return () => jsonResponse([{ page, pages, per_page: 2, total }, rows]);
}

test("World Bank error payloads are recognised", () => {
  assert.match(worldBankPayloadError(WB_ERROR), /120 Invalid value/);
  assert.match(worldBankPayloadError({ value: [] }), /not a JSON array/);
  assert.match(worldBankPayloadError([{ page: 1 }]), /no page metadata/);
  assert.equal(worldBankPayloadError([{ page: 1, pages: 0, total: 0 }, null]), null);
});

test("requests retry transient failures with a timeout signal and fail on the rest", async () => {
  const flaky = scriptedFetch([
    () => jsonResponse("busy", 503),
    new TypeError("fetch failed"),
    () => jsonResponse({ ok: true }),
  ]);
  assert.deepEqual(
    await fetchJsonWithRetry("https://x.test/a", { label: "X", fetchImpl: flaky.impl, ...NO_WAIT }),
    { ok: true }
  );
  assert.equal(flaky.calls.length, 3);
  assert.ok(flaky.calls.every((call) => call.init.signal instanceof AbortSignal));

  for (const status of [400, 404]) {
    const missing = scriptedFetch([() => jsonResponse("nope", status)]);
    await assert.rejects(
      fetchJsonWithRetry("https://x.test/b", { label: "X", fetchImpl: missing.impl, ...NO_WAIT }),
      new RegExp(`X request failed after 1 attempt: HTTP ${status}`)
    );
    assert.equal(missing.calls.length, 1);
  }

  const challenge = scriptedFetch([
    () => new Response("<html><script src=/_Incapsula_Resource></script></html>"),
  ]);
  await assert.rejects(
    fetchJsonWithRetry("https://x.test/c", {
      label: "X",
      attempts: 3,
      fetchImpl: challenge.impl,
      ...NO_WAIT,
    }),
    /after 3 attempts: response is not JSON: <html>/
  );

  const stalled = scriptedFetch([
    (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      }),
  ]);
  await assert.rejects(
    fetchJsonWithRetry("https://x.test/d", {
      label: "X",
      attempts: 2,
      timeoutMs: 10,
      fetchImpl: stalled.impl,
      ...NO_WAIT,
    }),
    /after 2 attempts/
  );
  assert.equal(stalled.calls.length, 2);
});

test("World Bank paging returns every row or throws", async () => {
  const complete = scriptedFetch([
    wbPage(1, 2, 3, [wbRow("AAA", 2020, 1), wbRow("AAA", 2021, 2)]),
    wbPage(2, 2, 3, [wbRow("BBB", 2020, 3)]),
  ]);
  const rows = await fetchAllPages("SP.TEST", "2020:2021", null, {
    fetchImpl: complete.impl,
    ...NO_WAIT,
  });
  assert.equal(rows.length, 3);
  assert.deepEqual(
    complete.calls.map((call) => new URL(call.url).searchParams.get("page")),
    ["1", "2"]
  );

  // The World Bank API returns sporadic HTTP 400s for valid requests: those are retried.
  const sporadic = scriptedFetch([
    wbPage(1, 2, 3, [wbRow("AAA", 2020, 1), wbRow("AAA", 2021, 2)]),
    () => jsonResponse("Bad Request", 400),
    wbPage(2, 2, 3, [wbRow("BBB", 2020, 3)]),
  ]);
  const retried = await fetchAllPages("SP.TEST", "2020:2021", null, {
    fetchImpl: sporadic.impl,
    ...NO_WAIT,
  });
  assert.equal(retried.length, 3);
  assert.equal(sporadic.calls.length, 3);

  const rejected = scriptedFetch([() => jsonResponse("Bad Request", 400)]);
  await assert.rejects(
    fetchAllPages("SP.TEST", "2020:2021", null, { fetchImpl: rejected.impl, ...NO_WAIT }),
    /World Bank SP\.TEST request failed after 5 attempts: HTTP 400/
  );
  assert.equal(rejected.calls.length, 5);

  const notFound = scriptedFetch([() => jsonResponse("nope", 404)]);
  await assert.rejects(
    fetchAllPages("SP.TEST", "2020:2021", null, { fetchImpl: notFound.impl, ...NO_WAIT }),
    /after 1 attempt: HTTP 404/
  );
  assert.equal(notFound.calls.length, 1);

  const errorMidway = scriptedFetch([
    wbPage(1, 3, 5, [wbRow("AAA", 2020, 1), wbRow("AAA", 2021, 2)]),
    () => jsonResponse(WB_ERROR),
  ]);
  await assert.rejects(
    fetchAllPages("SP.TEST", "2020:2021", null, { fetchImpl: errorMidway.impl, ...NO_WAIT }),
    /World Bank SP\.TEST request failed after 5 attempts: World Bank error: 120 Invalid value/
  );

  const short = scriptedFetch([
    wbPage(1, 2, 4, [wbRow("AAA", 2020, 1), wbRow("AAA", 2021, 2)]),
    wbPage(2, 2, 4, [wbRow("BBB", 2020, 3)]),
  ]);
  await assert.rejects(
    fetchAllPages("SP.TEST", "2020:2021", null, { fetchImpl: short.impl, ...NO_WAIT }),
    /received 3 of 4 rows/
  );

  const emptyPage = scriptedFetch([
    wbPage(1, 2, 4, [wbRow("AAA", 2020, 1), wbRow("AAA", 2021, 2)]),
    wbPage(2, 2, 4, []),
  ]);
  await assert.rejects(
    fetchAllPages("SP.TEST", "2020:2021", null, { fetchImpl: emptyPage.impl, ...NO_WAIT }),
    /page 2 of 2 has no rows/
  );

  const changed = scriptedFetch([
    wbPage(1, 2, 4, [wbRow("AAA", 2020, 1), wbRow("AAA", 2021, 2)]),
    wbPage(2, 3, 5, [wbRow("BBB", 2020, 3), wbRow("BBB", 2021, 3)]),
  ]);
  await assert.rejects(
    fetchAllPages("SP.TEST", "2020:2021", null, { fetchImpl: changed.impl, ...NO_WAIT }),
    /changed while paging/
  );

  const none = scriptedFetch([wbPage(1, 0, 0, null)]);
  await assert.rejects(
    fetchAllPages("SP.TEST", "2020:2021", null, { fetchImpl: none.impl, ...NO_WAIT }),
    /returned no rows/
  );
});

test("WHO HALE paging is ordered and rejects error bodies and thin results", async () => {
  const fullPage = Array.from({ length: 1000 }, (_, i) => whoRow(`C${i % 200}`, 2000 + i, 60));
  const paged = scriptedFetch([
    () => jsonResponse({ value: fullPage }),
    () => jsonResponse({ value: [whoRow("ZZZ", 2021, 61)] }),
  ]);
  const rows = await fetchAllWhoHale({ minCountries: 3, fetchImpl: paged.impl, ...NO_WAIT });
  assert.equal(rows.length, 1001);
  assert.match(paged.calls[0].url, /\$orderby=SpatialDim,TimeDim/);
  assert.match(paged.calls[1].url, /\$skip=1000/);

  const odataError = scriptedFetch([() => jsonResponse({ error: { message: "Server busy" } })]);
  await assert.rejects(
    fetchAllWhoHale({ minCountries: 1, attempts: 2, fetchImpl: odataError.impl, ...NO_WAIT }),
    /WHO GHO HALE request failed after 2 attempts: WHO GHO error: Server busy/
  );

  const down = scriptedFetch([() => new Response("<h1>Server Error</h1>", { status: 500 })]);
  await assert.rejects(
    fetchAllWhoHale({ attempts: 2, fetchImpl: down.impl, ...NO_WAIT }),
    /HTTP 500/
  );
  assert.equal(down.calls.length, 2);

  const badRequest = scriptedFetch([() => jsonResponse("Bad Request", 400)]);
  await assert.rejects(
    fetchAllWhoHale({ fetchImpl: badRequest.impl, ...NO_WAIT }),
    /WHO GHO HALE request failed after 1 attempt: HTTP 400/
  );

  const thin =scriptedFetch([() => jsonResponse({ value: [whoRow("AAA", 2021, 60)] })]);
  await assert.rejects(
    fetchAllWhoHale({ minCountries: 150, fetchImpl: thin.impl, ...NO_WAIT }),
    /HALE for only 1 countries/
  );
});

const HFI_COLUMNS = {
  year: { 0: 2022, 1: 2022, 2: 2023, 3: 1999 },
  iso: { 0: "AAA", 1: "BBB", 2: "CCC", 3: "AAA" },
  countries: { 0: "Alpha, Republic of", 1: "Beta", 2: "Gamma", 3: "Alpha, Republic of" },
  pf_score: { 0: 8, 1: null, 2: 7, 3: 8 },
  pf_rol: { 0: 8, 1: 8, 2: 6, 3: 8 },
  pf_movement: { 0: 9, 1: 9, 2: null, 3: 9 },
  pf_religion: { 0: 7, 1: 7, 2: 6, 3: 7 },
  pf_assembly: { 0: 8, 1: 8, 2: 6, 3: 8 },
  pf_expression: { 0: 9, 1: 9, 2: 6, 3: 9 },
  pf_identity: { 0: 7, 1: 7, 2: null, 3: 7 },
};

test("HFI rows keep missing scores missing and average the personal-freedom categories", () => {
  const rows = hfiRowsFromColumns(HFI_COLUMNS);
  assert.deepEqual(rows, [
    { countryiso3code: "AAA", date: "2022", value: 80, country: { value: "Alpha, Republic of" } },
  ]);
});

test("an HFI CSV export parses to the same rows as the JSON download", () => {
  const csv = [
    "\uFEFFyear,ISO,countries,pf_rol,pf_movement,pf_religion,pf_assembly,pf_expression,pf_identity,pf_score",
    "2022,AAA,\"Alpha, Republic of\",8,9,7,8,9,7,8",
    "2022,BBB,Beta,8,9,7,8,9,7,-",
    "2023,CCC,Gamma,6,,6,6,6,-,7",
    "1999,AAA,\"Alpha, Republic of\",8,9,7,8,9,7,8",
  ].join("\r\n");
  assert.deepEqual(hfiRowsFromColumns(hfiColumnsFromText(csv)), hfiRowsFromColumns(HFI_COLUMNS));
  assert.deepEqual(
    hfiRowsFromColumns(hfiColumnsFromText(JSON.stringify(HFI_COLUMNS))),
    hfiRowsFromColumns(HFI_COLUMNS)
  );
});

const COMMITTED_SERIES = {
  generatedAt: "2026-07-15T15:47:33.644Z",
  sourceRefresh: { humanFreedomIndex: { status: "downloaded" } },
  entrySeries: {
    AAA: {
      points: [
        { year: 2022, freedom: 80, freedomYear: 2022 },
        { year: 2023, freedom: 80, freedomYear: 2022 },
      ],
    },
    BBB: { points: [{ year: 2023, freedom: 70.5, freedomYear: 2023 }] },
    WLD: { points: [{ year: 2023, freedom: 75 }] },
  },
};

test("the cached HFI fallback reads exact-year observations and flags any it would lose", () => {
  const rows = cachedHfiRows(COMMITTED_SERIES);
  assert.deepEqual(
    rows.map((row) => [row.countryiso3code, row.date, row.value]),
    [
      ["AAA", "2022", 80],
      ["BBB", "2023", 70.5],
    ]
  );
  assert.deepEqual(cachedFreedomLosses(rows, COMMITTED_SERIES.entrySeries), []);
  assert.deepEqual(cachedFreedomLosses(rows, { AAA: COMMITTED_SERIES.entrySeries.AAA }), [
    "BBB",
  ]);
});

test("a failing WHO API falls back to the committed exact-year HALE and flags any it would lose", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const committed = {
    generatedAt: "2026-09-10T09:09:49.305Z",
    sourceRefresh: { whoHale: { status: "downloaded" } },
    entrySeries: {
      AAA: {
        points: [
          { year: 2021, hale: 70.12, haleYear: 2021 },
          { year: 2022, hale: 70.5, haleYear: 2021, haleEstimated: true },
        ],
      },
      // Groups store no source years, so nothing of theirs is reused.
      WLD: { points: [{ year: 2021, hale: 63.4, haleEstimated: undefined }] },
    },
  };
  const down = scriptedFetch([() => new Response("Server Error 500", { status: 500 })]);
  const fallback = await fetchWhoHaleOrCached(committed, "now", { fetchImpl: down.impl, ...NO_WAIT });
  assert.equal(fallback.status, "cached");
  assert.deepEqual(fallback.rows, [
    { SpatialDimType: "COUNTRY", SpatialDim: "AAA", Dim1: "SEX_BTSX", TimeDim: 2021, NumericValue: 70.12 },
  ]);
  assert.equal(fallback.retrievedAt, committed.generatedAt);
  assert.match(fallback.reason, /HTTP 500/);
  assert.match(warn.mock.calls[0].arguments[0], /WARNING: WHO GHO HALE download failed/);
  // The rows read back exactly as WHO rows would.
  assert.deepEqual(haleHistoryByIso(fallback.rows).get("AAA"), [{ year: 2021, value: 70.12 }]);
  assert.deepEqual(cachedHaleLosses(fallback.rows, committed.entrySeries), []);
  assert.deepEqual(cachedHaleLosses(fallback.rows, { WLD: committed.entrySeries.WLD }), ["AAA"]);
  assert.deepEqual(cachedHaleRows(null), []);
});

test("a blocked HFI download falls back loudly and records the reused data's date", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const challenge = scriptedFetch([() => new Response("<html>challenge</html>")]);
  const http = { fetchImpl: challenge.impl, ...NO_WAIT };
  const now = "2026-10-31T00:00:00.000Z";

  const fallback = await fetchHfiPersonalFreedom(COMMITTED_SERIES, now, http);
  assert.equal(fallback.status, "cached");
  assert.equal(fallback.rows.length, 2);
  assert.equal(fallback.retrievedAt, COMMITTED_SERIES.generatedAt);
  assert.equal(fallback.cachedFrom, COMMITTED_SERIES.generatedAt);
  assert.match(fallback.reason, /not JSON/);
  assert.match(warn.mock.calls[0].arguments[0], /WARNING: Human Freedom Index download failed/);

  const again = await fetchHfiPersonalFreedom(
    {
      ...COMMITTED_SERIES,
      generatedAt: "2026-09-10T09:09:49.305Z",
      sourceRefresh: { humanFreedomIndex: { status: "cached", retrievedAt: fallback.retrievedAt } },
    },
    now,
    http
  );
  assert.equal(again.retrievedAt, COMMITTED_SERIES.generatedAt, "the original date carries over");

  await assert.rejects(
    fetchHfiPersonalFreedom(null, now, http),
    /Human Freedom Index request failed/
  );
});

test("HFI_FILE overrides the download and never falls back", async (t) => {
  t.mock.method(console, "log", () => {});
  const dir = await mkdtemp(join(tmpdir(), "hfi-"));
  const previous = process.env.HFI_FILE;
  t.after(async () => {
    if (previous === undefined) delete process.env.HFI_FILE;
    else process.env.HFI_FILE = previous;
    await rm(dir, { recursive: true, force: true });
  });
  const unused = scriptedFetch([new Error("must not fetch")]);
  const http = { fetchImpl: unused.impl, ...NO_WAIT };

  process.env.HFI_FILE = join(dir, "hfi.json");
  await writeFile(process.env.HFI_FILE, JSON.stringify(HFI_COLUMNS));
  const result = await fetchHfiPersonalFreedom(COMMITTED_SERIES, "now", http);
  assert.equal(result.status, "file");
  assert.equal(result.file, "hfi.json");
  assert.equal(result.rows.length, 1);
  assert.ok(!Number.isNaN(Date.parse(result.retrievedAt)));

  process.env.HFI_FILE = join(dir, "empty.csv");
  await writeFile(process.env.HFI_FILE, "year,ISO,pf_score\n");
  await assert.rejects(fetchHfiPersonalFreedom(COMMITTED_SERIES, "now", http), /no usable/);
  assert.equal(unused.calls.length, 0);
});

function fixtureData({ countries = ["AAA", "BBB", "CCC"], freedomYears = [2024, 2025] } = {}) {
  const rows = countries.map((iso) => ({ iso, name: iso, customIndex: 0.8 }));
  rows.push({ iso: "WLD", name: "World", derivedKind: "world", memberCount: 3, customIndex: 0.8 });
  const entrySeries = {};
  for (const iso of countries) {
    entrySeries[iso] = {
      points: [2024, 2025].map((year) => ({
        year,
        le: 80,
        leYear: year,
        hale: 70,
        haleYear: 2024,
        gni: 30000,
        gniYear: year,
        homicidesPer100k: 1,
        homicideYear: year,
        freedom: 90,
        freedomYear: freedomYears.includes(year) ? year : freedomYears.at(-1),
        customIndex: 0.8,
      })),
    };
  }
  entrySeries.WLD = { points: [{ year: 2025, customIndex: 0.8 }] };
  return {
    leaderboard: {
      countries: rows,
      globalAverageSeries: { cohortSize: countries.length, points: [{ year: 2025, value: 0.8 }] },
    },
    series: { entrySeries },
  };
}

function stats(data) {
  return datasetStats(data.leaderboard, data.series);
}

test("the pre-write guard passes an unchanged build", () => {
  const baseline = stats(fixtureData());
  assert.equal(baseline.scoredIso.length, 3);
  assert.equal(baseline.countries.freedom, 3);
  assert.equal(baseline.observations.freedom, 6);
  assert.equal(baseline.observations.hale, 3);
  assert.deepEqual(sanityProblems(baseline, stats(fixtureData())), []);
  assert.deepEqual(sanityProblems(null, baseline), []);
});

test("the pre-write guard refuses shrinking coverage, lost groups and unusable results", () => {
  const baseline = stats(fixtureData());

  const fewer = sanityProblems(baseline, stats(fixtureData({ countries: ["AAA", "BBB"] })));
  assert.ok(fewer.some((p) => /scored countries fell from 3 to 2 \(dropped: CCC\)/.test(p)));
  assert.ok(fewer.some((p) => /fixed-cohort size fell/.test(p)));

  const staleFreedom = sanityProblems(baseline, stats(fixtureData({ freedomYears: [2024] })));
  assert.deepEqual(staleFreedom, ["freedom observations fell from 6 to 3"]);

  const noGroup = fixtureData();
  noGroup.leaderboard.countries = noGroup.leaderboard.countries.filter((r) => !r.derivedKind);
  assert.deepEqual(sanityProblems(baseline, stats(noGroup)), ["groups missing: WLD"]);

  const broken = fixtureData();
  broken.leaderboard.countries[0].customIndex = null;
  broken.leaderboard.globalAverageSeries.points[0].value = NaN;
  const problems = sanityProblems(null, stats(broken));
  assert.ok(problems.includes("rows without a Tomer index: AAA"));
  assert.ok(problems.includes("the fixed-cohort trend is empty or has non-finite values"));
});

test("a refused write points at the npm script, which also runs build-world and split-data", () => {
  const message = shrinkRefusalMessage(["groups missing: WLD", "freedom observations fell"]);
  assert.match(message, /:\n {2}- groups missing: WLD\n {2}- freedom observations fell\n/);
  assert.match(message, /`npm run build-data -- --force`/);
  assert.doesNotMatch(message, /node scripts\/build-data\.mjs|npm run split-data/);
  const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).scripts;
  assert.match(scripts["postbuild-data"], /build-world.*split-data/);
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.ok(readme.includes("`npm run build-data -- --force`"));
});

test("the pre-write guard tolerates small coverage changes", () => {
  const many = Array.from({ length: 100 }, (_, i) => `C${String(i).padStart(2, "0")}`);
  const baseline = stats(fixtureData({ countries: many }));
  assert.deepEqual(sanityProblems(baseline, stats(fixtureData({ countries: many.slice(2) }))), []);
  assert.equal(
    sanityProblems(baseline, stats(fixtureData({ countries: many.slice(3) }))).length > 0,
    true
  );
});

test("the committed data passes its own pre-write guard", () => {
  const leaderboard = JSON.parse(
    readFileSync(new URL("../public/data/leaderboard.json", import.meta.url))
  );
  const series = JSON.parse(readFileSync(new URL("../public/data/series.json", import.meta.url)));
  const committed = datasetStats(leaderboard, series);
  assert.ok(committed.scoredIso.length > 100);
  assert.deepEqual(sanityProblems(committed, committed), []);
});
