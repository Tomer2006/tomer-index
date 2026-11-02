import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const hash = createHash("sha256");
for (const file of [
  "public/data/leaderboard.json",
  "public/data/series.json",
  "public/data/world.geojson",
  "scripts/split-data.mjs",
  "src/data-split.js",
]) {
  hash.update(readFileSync(new URL(`./${file}`, import.meta.url)));
}

export default {
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  env: { NEXT_PUBLIC_DATA_VERSION: hash.digest("hex").slice(0, 12) },
  async headers() {
    // App data URLs carry the content hash (?v=), so browsers may cache them forever.
    return [
      {
        source: "/app-data/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
  async redirects() {
    // Old query-string entry links (/entry?iso=JPN) move to the static /entry/JPN pages
    // in one hop. Redirects can't change case, so /entry upper-cases ?iso=jpn itself.
    const entryIso = [
      { type: "query", key: "iso", value: "(?<iso>[A-Z0-9_]+)" },
    ];
    return [
      ...["/entry", "/entry.html"].map((source) => ({
        source,
        has: entryIso,
        destination: "/entry/:iso",
        permanent: true,
      })),
      ...["index", "compare", "map", "entry", "methodology"].map((page) => ({
        source: `/${page}.html`,
        destination: page === "index" ? "/" : `/${page}`,
        permanent: true,
      })),
    ];
  },
};
