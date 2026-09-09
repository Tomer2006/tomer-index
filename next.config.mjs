import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const hash = createHash("sha256");
for (const file of ["leaderboard.json", "series.json", "world.geojson"]) {
  hash.update(readFileSync(new URL(`./public/data/${file}`, import.meta.url)));
}

export default {
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  env: { NEXT_PUBLIC_DATA_VERSION: hash.digest("hex").slice(0, 12) },
  async redirects() {
    return ["index", "compare", "map", "entry", "methodology"].map((page) => ({
      source: `/${page}.html`,
      destination: page === "index" ? "/" : `/${page}`,
      permanent: true,
    }));
  },
};
