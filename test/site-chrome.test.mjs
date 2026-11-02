import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import robots from "../src/app/robots.js";
import sitemap from "../src/app/sitemap.js";
import { SITE_URL } from "../src/site.js";

const leaderboard = JSON.parse(
  readFileSync(new URL("../public/data/leaderboard.json", import.meta.url)),
);

test("sitemap lists every page and one entry page per leaderboard row", () => {
  const entries = sitemap();
  const urls = entries.map((entry) => entry.url);
  for (const path of ["/compare", "/map", "/methodology", "/downloads", "/entry"])
    assert.ok(urls.includes(`${SITE_URL}${path}`), path);
  assert.ok(urls.includes(SITE_URL));
  for (const row of leaderboard.countries)
    assert.ok(urls.includes(`${SITE_URL}/entry/${row.iso}`), row.iso);
  assert.equal(new Set(urls).size, urls.length);
  assert.equal(urls.length, 6 + leaderboard.countries.length);
  for (const entry of entries)
    assert.equal(
      entry.lastModified.toISOString(),
      new Date(leaderboard.generatedAt).toISOString(),
    );
});

test("robots allows crawling and points at the absolute sitemap", () => {
  assert.deepEqual(robots(), {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  });
});
