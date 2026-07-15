import { INDEX_WEIGHTS } from "./hdi-core.js";

export const WEIGHT_KEYS = Object.freeze(["health", "safety", "freedom", "abundance"]);

export const DEFAULT_WEIGHT_POINTS = Object.freeze(
  Object.fromEntries(WEIGHT_KEYS.map((key) => [key, INDEX_WEIGHTS[key] * 100]))
);

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

/** Recalculate the index from the four stored absolute pillar indices. */
export function weightedIndexFromPillars(point, weightPoints = DEFAULT_WEIGHT_POINTS) {
  const pillars = {
    health: point?.healthIndex,
    safety: point?.safetyIndex,
    freedom: point?.freedomIndex,
    abundance: point?.abundanceIndex,
  };
  if (!Object.values(pillars).every(Number.isFinite)) return NaN;
  const weights = normalizedWeightPoints(weightPoints);
  return WEIGHT_KEYS.reduce(
    (score, key) => score * Math.pow(pillars[key], weights[key]),
    1
  );
}
