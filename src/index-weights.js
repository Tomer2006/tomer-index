import { INDEX_WEIGHTS } from "./hdi-core.js";

export const WEIGHT_KEYS = Object.freeze(["health", "safety", "freedom", "abundance"]);

export const DEFAULT_WEIGHT_POINTS = Object.freeze(
  Object.fromEntries(WEIGHT_KEYS.map((key) => [key, INDEX_WEIGHTS[key] * 100]))
);

const PILLAR_FIELDS = {
  health: "healthIndex",
  safety: "safetyIndex",
  freedom: "freedomIndex",
  abundance: "abundanceIndex",
};

/** Normalize arbitrary non-negative slider points to weights that sum to one. */
export function normalizedWeightPoints(weightPoints = DEFAULT_WEIGHT_POINTS) {
  const clean = Object.fromEntries(
    WEIGHT_KEYS.map((key) => {
      const value = Number(weightPoints?.[key]);
      return [key, Number.isFinite(value) && value >= 0 ? value : 0];
    })
  );
  const total = Object.values(clean).reduce((sum, value) => sum + value, 0);
  const source = total > 0 ? clean : DEFAULT_WEIGHT_POINTS;
  const denominator = Object.values(source).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(WEIGHT_KEYS.map((key) => [key, source[key] / denominator]));
}

// A page scores every row with the same slider values, so remember the last
// normalization instead of redoing it for each row (and each sort comparison).
const cachedPoints = WEIGHT_KEYS.map(() => undefined);
let cachedWeights = null;
function cachedNormalizedWeights(weightPoints) {
  const hit =
    cachedWeights &&
    WEIGHT_KEYS.every((key, i) => Object.is(weightPoints?.[key], cachedPoints[i]));
  if (!hit) {
    WEIGHT_KEYS.forEach((key, i) => (cachedPoints[i] = weightPoints?.[key]));
    cachedWeights = normalizedWeightPoints(weightPoints);
  }
  return cachedWeights;
}

/** Recalculate the index from the four stored absolute pillar indices. */
export function weightedIndexFromPillars(point, weightPoints = DEFAULT_WEIGHT_POINTS) {
  const weights = cachedNormalizedWeights(weightPoints);
  let score = 1;
  for (const key of WEIGHT_KEYS) {
    const pillar = point?.[PILLAR_FIELDS[key]];
    if (!Number.isFinite(pillar)) return NaN;
    score *= Math.pow(pillar, weights[key]);
  }
  return score;
}
