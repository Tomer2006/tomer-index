import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GEOGRAPHIC_REGIONS,
  geographicRegionForRow,
  matchesRegions,
  regionOptions,
} from "../src/regions.js";
import { rowsForYear } from "../src/view-model.js";

const { countries } = JSON.parse(
  readFileSync(new URL("../public/data/leaderboard.json", import.meta.url)),
);
const { entrySeries } = JSON.parse(
  readFileSync(new URL("../public/data/series.json", import.meta.url)),
);

test("every tracked country has exactly one detailed geographic region", () => {
  const members = GEOGRAPHIC_REGIONS.flatMap((region) => region.members);
  assert.equal(new Set(members).size, members.length);
  for (const country of countries.filter((row) => !row.derivedKind)) {
    assert.ok(geographicRegionForRow(country), country.iso);
  }
  const options = regionOptions(countries);
  assert.equal(options.broad.length, 7);
  assert.equal(options.detailed.length, 20);
  assert.ok(!options.detailed.some((region) => region.name === "Polynesia"));
});

test("geographic filters follow UN membership, including countries spanning broad World Bank groups", () => {
  const byIso = new Map(countries.map((row) => [row.iso, row]));
  assert.ok(matchesRegions(byIso.get("ISR"), ["UN-145"]));
  assert.ok(matchesRegions(byIso.get("TUR"), ["UN-145"]));
  assert.ok(!matchesRegions(byIso.get("IRN"), ["UN-145"]));
  assert.ok(matchesRegions(byIso.get("IRN"), ["UN-034"]));
  assert.ok(matchesRegions(byIso.get("SWE"), ["UN-154", "UN-030"]));
  assert.ok(matchesRegions(byIso.get("JPN"), ["UN-154", "UN-030"]));
  assert.ok(matchesRegions(byIso.get("JPN"), ["EAS"]));
  assert.ok(!matchesRegions(byIso.get("WLD"), ["UN-154"]));
});

test("historical years retain region membership and multi-region URLs never duplicate countries", () => {
  const ids = ["UN-154", "ECS"];
  const latest = countries
    .filter((row) => matchesRegions(row, ids))
    .map((row) => row.iso);
  const earlier = rowsForYear(countries, entrySeries, 2000)
    .filter((row) => matchesRegions(row, ids))
    .map((row) => row.iso);
  assert.deepEqual(earlier.sort(), latest.sort());
  assert.equal(new Set(latest).size, latest.length);
  assert.ok(matchesRegions(countries[0], []));
});
