// App fetches go to public/app-data (derived by scripts/split-data.mjs). Its URLs carry
// a content hash and are served as immutable; the /data download links stay revalidated.
export function dataUrl(file) {
  return `/app-data/${file}?v=${process.env.NEXT_PUBLIC_DATA_VERSION ?? "dev"}`;
}

async function fetchJson(file) {
  // The dev server computes the hash once at startup, so skip the cache while developing.
  const res = await fetch(
    dataUrl(file),
    process.env.NODE_ENV === "development" ? { cache: "no-cache" } : undefined,
  );
  if (!res.ok) {
    throw new Error(`Missing public/app-data/${file} (${res.status}). Run: npm run split-data`);
  }
  return res.json();
}

export function loadLeaderboardData() {
  return fetchJson("leaderboard.json");
}

export function loadSeriesData() {
  return fetchJson("series.json");
}

export function loadWorldData() {
  return fetchJson("world.geojson");
}

/** One entry's yearly history: { definition, points }. */
export function loadEntrySeries(iso) {
  return fetchJson(`entry/${encodeURIComponent(iso)}.json`);
}

/** Every entry's point for one year: { [iso]: point }. */
export function loadYearSnapshot(year) {
  return fetchJson(`year/${year}.json`);
}
