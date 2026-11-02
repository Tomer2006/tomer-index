import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { render, screen, within } from "@testing-library/react";
import MethodologyPage from "../src/app/methodology/page";
import DownloadsPage from "../src/app/downloads/page";
import { SITE_URL } from "../src/site.js";
import { YEAR_MAX, YEAR_MIN } from "../src/site-years.js";

const read = (file) => JSON.parse(readFileSync(resolve("public/data", file)));

test("methodology renders one main with its heading, contents, and readable text", () => {
  const { container } = render(<MethodologyPage />);
  const mains = container.querySelectorAll("main");
  expect(mains).toHaveLength(1);
  expect(mains[0].id).toBe("main");
  expect(
    within(mains[0]).getByRole("heading", { level: 1, name: "Methodology" }),
  ).toBeTruthy();

  // Every table-of-contents link points at a section heading on the page.
  const toc = screen.getByRole("navigation", { name: "On this page" });
  const links = within(toc).getAllByRole("link");
  expect(links[0].textContent).toBe("At a glance");
  for (const link of links) {
    const section = container.querySelector(link.getAttribute("href"));
    expect(section?.querySelector("h2")?.textContent).toBe(link.textContent);
  }

  // JSX line breaks next to inline elements must not glue words together.
  const text = mains[0].textContent;
  for (const phrase of [
    "importance: Health 40%, Safety 30%, Freedom 20%, and Abundance 10%",
    "World Bank SP.DYN.LE00.IN",
    "World Bank VC.IHR.PSRC.P5",
    "labeled est. (for example “HALE est. from",
    "Group rows are population-weighted averages",
  ]) {
    expect(text).toContain(phrase);
  }
  for (const paragraph of mains[0].querySelectorAll("p, li")) {
    expect(paragraph.textContent).not.toMatch(/[a-z][:,;][A-Za-z]|[a-z]—/);
  }
  expect(text).toContain(`from ${YEAR_MIN} to ${YEAR_MAX}`);
  expect(text).not.toMatch(/trend chart|The chart states/i);
});

test("methodology colors each pillar heading with its topic color", () => {
  const { container } = render(<MethodologyPage />);
  const pillars = [...container.querySelectorAll("#pillars h3")];
  expect(pillars.map((h3) => h3.textContent.split(":")[0])).toEqual([
    "Health",
    "Safety",
    "Freedom",
    "Abundance",
  ]);
  expect(pillars.every((h3) => h3.style.getPropertyValue("--topic-color"))).toBe(
    true,
  );
});

test("downloads lists the files, a field guide, and Dataset structured data", () => {
  const { container } = render(<DownloadsPage />);
  const main = container.querySelector("main#main");
  expect(
    within(main).getByRole("heading", { level: 1, name: "Download data" }),
  ).toBeTruthy();

  const hrefs = within(main)
    .getAllByRole("link", { name: /^Download/ })
    .map((link) => link.getAttribute("href"));
  expect(hrefs).toEqual([
    "/downloads/all",
    "/data/leaderboard.json",
    "/data/series.json",
    "/data/world.geojson",
  ]);
  expect(main.textContent).toMatch(/\d+ KB/);
  expect(main.textContent).toContain("gni holds GDP per person");

  const jsonLd = JSON.parse(
    container.querySelector('script[type="application/ld+json"]').textContent,
  );
  expect(jsonLd["@type"]).toBe("Dataset");
  expect(jsonLd.temporalCoverage).toBe(`${YEAR_MIN}/${YEAR_MAX}`);
  expect(jsonLd.url).toBe(`${SITE_URL}/downloads`);
  expect(jsonLd.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(jsonLd).not.toHaveProperty("license");
  expect(jsonLd).not.toHaveProperty("creator");
  expect(
    jsonLd.distribution.every(
      (download) =>
        download["@type"] === "DataDownload" &&
        download.contentUrl.startsWith(`${SITE_URL}/`),
    ),
  ).toBe(true);
});

test("the downloads field guide matches the shipped files", () => {
  const { container } = render(<DownloadsPage />);
  const main = container.querySelector("main#main");
  const text = main.textContent;
  const { countries } = read("leaderboard.json");
  const { entrySeries } = read("series.json");
  const { features } = read("world.geojson");

  // Every field the guide names is in leaderboard rows or series points.
  const points = Object.values(entrySeries).flatMap((entry) => entry.points);
  const fields = new Set(
    [...countries, ...points].flatMap((row) => Object.keys(row)),
  );
  const named = [...main.querySelectorAll(".downloads-fields dt")].flatMap(
    (dt) => dt.textContent.split(", "),
  );
  expect(named.filter((field) => !fields.has(field))).toEqual([]);

  // world.geojson keys each feature by `id`, and `name` is its only property.
  expect(text).not.toContain("iso3");
  expect(text).toContain(
    "feature’s id is its ISO 3166-1 alpha-3 code, which matches iso in the other files, and its only property is name.",
  );
  expect(
    new Set(features.flatMap((feature) => Object.keys(feature.properties))),
  ).toEqual(new Set(["name"]));
  expect(features.every((feature) => typeof feature.id === "string")).toBe(
    true,
  );
  const ids = new Set(features.map((feature) => feature.id));
  for (const id of ["XKX", "SOL", "CYN", "ATA"]) expect(ids.has(id), id).toBe(true);
  expect(countries.some((row) => row.iso === "ATA")).toBe(false);
  expect(text).toMatch(
    /XKX \(Kosovo.*\), SOL \(Somaliland\), and CYN \(Northern Cyprus\)/,
  );
  expect(text).toContain(
    "Natural Earth 1:110m via world-atlas, with a few small states from 1:50m.",
  );
});
