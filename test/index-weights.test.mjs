import assert from "node:assert/strict";
import test from "node:test";

import { customIndexFromPillarsFull, INDEX_WEIGHTS } from "../src/hdi-core.js";
import {
  DEFAULT_WEIGHT_POINTS,
  normalizedWeightPoints,
  weightedIndexFromPillars,
} from "../src/index-weights.js";

const closeTo = (actual, expected, eps = 1e-12) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} ≈ ${expected}`);

test("default slider points match the published index weights", () => {
  assert.deepEqual(normalizedWeightPoints(DEFAULT_WEIGHT_POINTS), {
    health: INDEX_WEIGHTS.health,
    safety: INDEX_WEIGHTS.safety,
    freedom: INDEX_WEIGHTS.freedom,
    abundance: INDEX_WEIGHTS.abundance,
  });
});

test("custom slider points are normalized to 100 percent", () => {
  assert.deepEqual(normalizedWeightPoints({ health: 1, safety: 1, freedom: 1, abundance: 1 }), {
    health: 0.25,
    safety: 0.25,
    freedom: 0.25,
    abundance: 0.25,
  });
  assert.deepEqual(normalizedWeightPoints({ health: 0, safety: 0, freedom: 0, abundance: 0 }), {
    health: 0.4,
    safety: 0.3,
    freedom: 0.2,
    abundance: 0.1,
  });
});

test("default and custom weights use the same geometric-mean formula", () => {
  const point = {
    healthIndex: 0.8,
    safetyIndex: 0.7,
    freedomIndex: 0.6,
    abundanceIndex: 0.5,
  };
  closeTo(
    weightedIndexFromPillars(point),
    customIndexFromPillarsFull({ abundance: 0.5, safety: 0.7, health: 0.8, freedom: 0.6 })
  );
  closeTo(
    weightedIndexFromPillars(point, { health: 100, safety: 0, freedom: 0, abundance: 0 }),
    0.8
  );
});
