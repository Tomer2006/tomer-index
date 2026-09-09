function dataUrl(file) {
  return `/data/${file}?v=${process.env.NEXT_PUBLIC_DATA_VERSION ?? "dev"}`;
}

async function fetchJson(file) {
  const res = await fetch(dataUrl(file), { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`Missing public/data/${file} (${res.status}). Run: npm run build-data`);
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
