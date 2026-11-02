import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { geoArea } from "d3-geo";

const read = (file) =>
  JSON.parse(readFileSync(new URL(`../public/data/${file}`, import.meta.url)));
const { countries } = read("leaderboard.json");
const { features } = read("world.geojson");
const ids = new Set(features.map((feature) => feature.id));

test("every leaderboard country has a map shape", () => {
  const missing = countries
    .filter((row) => !row.derivedKind && !ids.has(row.iso))
    .map((row) => row.iso);
  assert.deepEqual(missing, []);
});

test("atlas features without an ISO id stay on the map as unscored land", () => {
  assert.ok(features.every((feature) => feature.id));
  assert.equal(ids.size, features.length);
  for (const id of ["XKX", "SOL", "CYN"]) assert.ok(ids.has(id), id);
});

test("rounded shapes keep their winding (no polygon covers the globe)", () => {
  const inverted = features
    .filter((feature) => geoArea(feature) > 2 * Math.PI)
    .map((feature) => feature.id);
  assert.deepEqual(inverted, []);
  const precise = JSON.stringify(features).match(/\d\.\d{3,}/);
  assert.equal(precise, null);
});
