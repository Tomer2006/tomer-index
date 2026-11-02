import { readLeaderboardFile } from "../leaderboard-file.js";
import { SITE_URL } from "../site.js";
import { entryHref } from "../view-model.js";

const PAGES = ["/", "/compare", "/map", "/methodology", "/downloads", "/entry"];

export default function sitemap() {
  const { generatedAt, countries } = readLeaderboardFile();
  const lastModified = new Date(generatedAt);
  return [
    ...PAGES.map((path) => ({
      url: path === "/" ? SITE_URL : `${SITE_URL}${path}`,
      lastModified,
      priority: path === "/" ? 1 : 0.8,
    })),
    // One page per leaderboard row: every scored country and every group.
    ...countries.map((row) => ({
      url: `${SITE_URL}${entryHref(row.iso)}`,
      lastModified,
      priority: 0.5,
    })),
  ];
}
