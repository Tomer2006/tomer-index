import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import Entry from "../src/components/entry";
import EntryPage, {
  dynamicParams,
  generateMetadata,
  generateStaticParams,
} from "../src/app/entry/[iso]/page.jsx";
import EntryIndexPage from "../src/app/entry/page.jsx";
import {
  entryDescription,
  entrySummary,
  ordinal,
} from "../src/entry-summary.js";
import { weightedIndexFromPillars } from "../src/index-weights.js";
import {
  loadEntrySeries,
  loadLeaderboardData,
  loadSeriesData,
} from "../src/data-loader.js";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
  useRouter: () => ({ replace }),
}));
vi.mock("../src/data-loader.js", async (importOriginal) => ({
  ...(await importOriginal()),
  loadLeaderboardData: vi.fn(),
  loadSeriesData: vi.fn(),
  loadWorldData: vi.fn(),
  loadEntrySeries: vi.fn(),
  loadYearSnapshot: vi.fn(),
}));
const read = (file) => JSON.parse(readFileSync(resolve("public/data", file)));
const leaderboard = read("leaderboard.json"),
  history = read("series.json");
const countries = leaderboard.countries.filter((row) => !row.derivedKind);
const params = (iso) => ({ params: Promise.resolve({ iso }) });
beforeAll(() => {
  loadLeaderboardData.mockResolvedValue(leaderboard);
  loadEntrySeries.mockImplementation(async (iso) => {
    if (!history.entrySeries[iso]) throw new Error(`Missing entry ${iso}`);
    return history.entrySeries[iso];
  });
});

test("ordinals cover the English irregulars", () => {
  expect(
    [1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111, 146].map(ordinal).join(" "),
  ).toBe("1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 101st 111th 146th");
});

test("entry ranks count countries only and follow the leaderboard's score order", () => {
  const byScore = [...countries].sort(
    (a, b) =>
      weightedIndexFromPillars(b) - weightedIndexFromPillars(a) ||
      a.name.localeCompare(b.name),
  );
  byScore.forEach((row, index) => {
    const summary = entrySummary(leaderboard, row.iso);
    expect(summary.rank, row.iso).toBe(index + 1);
    expect(summary.total).toBe(countries.length);
  });
  for (const group of leaderboard.countries.filter((row) => row.derivedKind))
    expect(entrySummary(leaderboard, group.iso).rank, group.iso).toBeNull();
  expect(entrySummary(leaderboard, "NOPE")).toBeNull();
});

test("country page leads with the Tomer index, its country rank and onward links", async () => {
  const view = render(<Entry iso="JPN" />);
  const heading = await screen.findByRole("heading", {
    level: 1,
    name: "Japan",
  });
  const main = view.container.querySelector("main#main");
  expect(main.contains(heading)).toBe(true);
  const { row, rank, total } = entrySummary(leaderboard, "JPN");
  expect(main.querySelector(".entry-headline-value").textContent).toBe(
    (weightedIndexFromPillars(row) * 100).toFixed(2),
  );
  expect(main.querySelector(".entry-headline-rank").textContent).toBe(
    `${ordinal(rank)} of ${total} countries`,
  );
  expect(main.querySelector(".kicker").textContent).toBe(
    "East Asia & Pacific · JPN",
  );
  const actions = within(
    screen.getByRole("navigation", { name: "More on Japan" }),
  );
  const href = (name) => actions.getByRole("link", { name }).getAttribute("href");
  expect(href("Compare with others")).toBe("/compare?picks=JPN");
  expect(href("View on map")).toBe("/map?iso=JPN");
  expect(href(/leaderboard/)).toBe("/");
  expect(await screen.findAllByRole("img")).toHaveLength(6);
  expect(loadSeriesData).not.toHaveBeenCalled();
});

test("group pages use reader-facing kinds and are not ranked", async () => {
  const view = render(<Entry iso="HIC" />);
  await screen.findByRole("heading", { level: 1, name: "High income" });
  const main = view.container.querySelector("main#main");
  expect(main.querySelector(".kicker").textContent).toBe(
    "Income group · 56 countries",
  );
  expect(main.querySelector(".entry-headline-rank").textContent).toBe(
    "Group of 56 countries",
  );
  expect(main.textContent).not.toMatch(/incomeLevel|derived|aggregate/);
  expect(screen.queryByRole("link", { name: "View on map" })).toBeNull();
  expect(
    screen
      .getByRole("link", { name: "Compare with others" })
      .getAttribute("href"),
  ).toBe("/compare?picks=HIC");
});

test("a prerendered summary shows at once and only the history is fetched", () => {
  loadLeaderboardData.mockClear();
  const view = render(
    <Entry iso="NOR" summary={entrySummary(leaderboard, "NOR")} />,
  );
  expect(
    screen.getByRole("heading", { level: 1, name: "Norway" }),
  ).toBeTruthy();
  expect(
    view.container.querySelector(".entry-headline-rank").textContent,
  ).toMatch(/ of 146 countries$/);
  expect(screen.getByRole("status").textContent).toContain("Loading");
  expect(loadLeaderboardData).not.toHaveBeenCalled();
  expect(loadEntrySeries).toHaveBeenCalledWith("NOR");
});

test("static entry routes cover every row with per-row metadata", async () => {
  expect(dynamicParams).toBe(false);
  expect(generateStaticParams()).toEqual(
    leaderboard.countries.map((row) => ({ iso: row.iso })),
  );
  const japan = await generateMetadata(params("JPN"));
  expect(japan.title).toBe("Japan");
  expect(japan.alternates.canonical).toBe("/entry/JPN");
  expect(japan.description).toMatch(
    /^Japan scores \d+\.\d\d on the Tomer index \(\d+(st|nd|rd|th) of 146 countries, 2025\)\./,
  );
  expect((await generateMetadata(params("HIC"))).description).toMatch(
    /^High income \(income group of 56 countries\) scores /,
  );
  expect(entryDescription(entrySummary(leaderboard, "WLD"))).toMatch(
    /^World \(146 countries\) scores /,
  );
  render(await EntryPage(params("JPN")));
  expect(
    screen.getByRole("heading", { level: 1, name: "Japan" }),
  ).toBeTruthy();
  // Data preload hints ride along in prefetched route payloads, so every page that
  // links here would download this file; entry pages must not emit them.
  expect(
    document.head.querySelector('link[rel="preload"][href*="/app-data/"]'),
  ).toBeNull();
});

test("the entry index links every row and upper-cases legacy ?iso= links", () => {
  window.history.replaceState(null, "", "/entry");
  const view = render(<EntryIndexPage />);
  expect(view.container.querySelectorAll("main#main")).toHaveLength(1);
  expect(
    screen.getByRole("heading", { level: 2, name: /^Countries/ }).textContent,
  ).toContain(`(${countries.length})`);
  expect(view.container.querySelectorAll("main a")).toHaveLength(
    leaderboard.countries.length,
  );
  expect(
    screen.getByRole("link", { name: "Japan" }).getAttribute("href"),
  ).toBe("/entry/JPN");
  expect(replace).not.toHaveBeenCalled();
  view.unmount();
  window.history.replaceState(null, "", "/entry?iso=jpn");
  render(<EntryIndexPage />);
  expect(replace).toHaveBeenCalledWith("/entry/JPN");
});
