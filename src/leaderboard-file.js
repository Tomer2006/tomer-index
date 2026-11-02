// Server-only: reads the committed leaderboard while prerendering (layout
// metadata, footer, sitemap, social image). Client code uses data-loader.js.
import { readFileSync } from "node:fs";
import { join } from "node:path";

let leaderboard;

export function readLeaderboardFile() {
  leaderboard ??= JSON.parse(
    readFileSync(
      join(process.cwd(), "public", "data", "leaderboard.json"),
      "utf8",
    ),
  );
  return leaderboard;
}

export function scoredCountries() {
  return readLeaderboardFile().countries.filter((row) => !row.derivedKind);
}
