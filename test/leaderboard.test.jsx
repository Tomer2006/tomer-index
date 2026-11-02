import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, expect, onTestFinished, test, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Leaderboard, { LeaderboardPreview } from "../src/components/leaderboard";
import LeaderboardSnapshot from "../src/components/leaderboard-snapshot";
import { YEAR_MAX } from "../src/site-years.js";
import {
  loadEntrySeries,
  loadLeaderboardData,
  loadSeriesData,
  loadWorldData,
  loadYearSnapshot,
} from "../src/data-loader.js";
import { yearSnapshots } from "../src/data-split.js";

vi.mock("../src/data-loader.js", () => ({
  loadLeaderboardData: vi.fn(),
  loadSeriesData: vi.fn(),
  loadWorldData: vi.fn(),
  loadEntrySeries: vi.fn(),
  loadYearSnapshot: vi.fn(),
}));
const read = (file) => JSON.parse(readFileSync(resolve("public/data", file)));
const allLeaderboard = read("leaderboard.json"),
  history = read("series.json");
// The top 35 rows include group rows (North America, High income) between countries.
const leaderboard = {
  ...allLeaderboard,
  countries: allLeaderboard.countries.filter(
    (row, index) => index < 35 || ["JPN", "WLD", "HIC"].includes(row.iso),
  ),
};
const countryCount = leaderboard.countries.filter(
  (row) => !row.derivedKind,
).length;
const groupCount = leaderboard.countries.length - countryCount;
beforeAll(() => {
  loadLeaderboardData.mockResolvedValue(leaderboard);
  loadSeriesData.mockResolvedValue(history);
  loadWorldData.mockResolvedValue(read("world.geojson"));
  const years = yearSnapshots(history.entrySeries);
  loadEntrySeries.mockImplementation(async (iso) => history.entrySeries[iso]);
  loadYearSnapshot.mockImplementation(async (year) => years[year]);
});

const rowFor = (table, name) =>
  within(table).getByRole("link", { name }).closest("tr");
// <output> elements are status regions too, so find the results line by class.
const results = () => document.querySelector(".leaderboard-results-count");

test("ranks count countries only; groups are labeled and unranked", async () => {
  render(<Leaderboard />);
  const table = await screen.findByRole("table");
  const high = rowFor(table, "High income");
  expect(high.className).toContain("is-group");
  expect(high.cells[0].textContent).toContain("Group, not ranked");
  expect(high.cells[1].textContent).toContain("Income group · 56 countries");
  const group = table.querySelector("tbody tr.is-group");
  const before = group.previousElementSibling;
  let after = group.nextElementSibling;
  while (after.classList.contains("is-group")) after = after.nextElementSibling;
  expect(before.classList.contains("is-group")).toBe(false);
  expect(Number(after.cells[0].textContent)).toBe(
    Number(before.cells[0].textContent) + 1,
  );
  const ranks = [...table.querySelectorAll("tbody tr:not(.is-group)")].map(
    (row) => Number(row.cells[0].textContent),
  );
  expect(ranks).toEqual(ranks.map((_, i) => i + 1));
  expect(results().textContent).toBe(
    `Showing ${countryCount} countries and ${groupCount} groups.`,
  );
  expect(loadSeriesData).not.toHaveBeenCalled();
});

test("reversing the sort keeps each country's rank", async () => {
  const user = userEvent.setup();
  render(<Leaderboard />);
  const table = await screen.findByRole("table");
  const rankOf = (name) => rowFor(table, name).cells[0].textContent;
  const switzerland = rankOf("Switzerland");
  await user.click(screen.getByRole("button", { name: "Tomer index" }));
  expect(window.location.search).toContain("dir=asc");
  expect(rankOf("Switzerland")).toBe(switzerland);
  expect(table.querySelector("tbody tr:last-child").textContent).toContain(
    "Switzerland",
  );
});

test("filters live in a collapsed panel that opens when a filter is active", async () => {
  const user = userEvent.setup();
  const view = render(<Leaderboard />);
  await screen.findByRole("table");
  const filters = () => screen.getByText("Filters").closest("details");
  expect(filters().open).toBe(false);
  expect(screen.getByText("Custom weights").closest("details").open).toBe(
    false,
  );
  view.unmount();
  window.history.replaceState(null, "", "/?income=HIC&quality=incomplete");
  render(<Leaderboard />);
  const table = await screen.findByRole("table");
  expect(filters().open).toBe(true);
  expect(filters().querySelector("summary").textContent).toBe(
    "Filters2 active",
  );
  expect(
    screen
      .getByRole("button", { name: "History gaps" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  // The income chip keeps the matching income-group row, like region chips do.
  await user.click(screen.getByRole("button", { name: "All", exact: true }));
  expect(rowFor(table, "High income")).toBeTruthy();
  expect(within(table).queryByRole("link", { name: "World" })).toBeNull();
});

test("custom weights relabel the score and open their panel on shared links", async () => {
  window.history.replaceState(null, "", "/?w_health=100&year=2010");
  render(<Leaderboard />);
  const table = await screen.findByRole("table");
  expect(screen.getByText("Custom weights").closest("details").open).toBe(true);
  expect(
    within(table).getByRole("button", { name: "Custom index" }),
  ).toBeTruthy();
  expect(results().textContent).toMatch(
    / in 2010, with custom weights\.$/,
  );
  expect(screen.getByText(/^Scores use a custom index/).textContent).toContain(
    "Health 62.5% · Safety 18.8% · Freedom 12.5% · Abundance 6.3%",
  );
});

test("empty results offer a reset", async () => {
  window.history.replaceState(null, "", "/?q=zzzz");
  const user = userEvent.setup();
  render(<Leaderboard />);
  const table = await screen.findByRole("table");
  const empty = table.querySelector("td.empty");
  expect(empty.colSpan).toBe(table.querySelectorAll("thead th").length);
  expect(results().textContent).toBe(
    "No countries or groups match these filters.",
  );
  await user.click(
    within(empty).getByRole("button", { name: "Reset filters" }),
  );
  expect(screen.getByRole("searchbox").value).toBe("");
  expect(table.querySelectorAll("tbody tr")).toHaveLength(
    leaderboard.countries.length,
  );
});

test("phones get compact, fully tappable cards instead of the table", async () => {
  // jsdom has no matchMedia; without it the page renders the table.
  window.matchMedia = (query) => ({
    matches: query === "(max-width: 560px)",
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  onTestFinished(() => delete window.matchMedia);
  render(<Leaderboard />);
  await screen.findByText(/^Showing /);
  expect(screen.queryByRole("table")).toBeNull();
  const cards = document.querySelectorAll(".leaderboard-card");
  expect(cards).toHaveLength(leaderboard.countries.length);
  expect(cards[0].textContent).toMatch(/^#1Switzerland/);
  expect(within(cards[0]).getByRole("link").getAttribute("href")).toBe(
    "/entry/CHE",
  );
  expect(cards[0].querySelector(".leaderboard-card-pillars").textContent).toBe(
    "Health 89 · Safety 97 · Freedom 98 · Abundance 101",
  );
  const world = within(document.body)
    .getByRole("link", { name: "World" })
    .closest(".leaderboard-card");
  expect(world.querySelector(".leaderboard-card-rank").textContent).toBe(
    "World · 146 countries",
  );
});

// useId ids differ between two renders; nothing else may.
const markup = (elements) =>
  [...elements].map((el) =>
    el.outerHTML.replace(/ (id|aria-describedby)="[^"]*"/g, ""),
  );

test("the prerendered snapshot's rows and cards are the live view's first 25, markup for markup", async () => {
  // So nothing on screen changes when the live view replaces the snapshot.
  const snapshot = render(<LeaderboardSnapshot />).container;
  const snapshotRows = snapshot.querySelectorAll(".leaderboard-table tbody tr");
  const snapshotCards = snapshot.querySelectorAll(".leaderboard-card");
  expect(snapshotRows).toHaveLength(25);
  expect(snapshotCards).toHaveLength(25);
  expect(
    [...snapshot.querySelectorAll(".leaderboard-table thead th")].map((th) => th.textContent),
  ).toEqual(["Rank", "Place", "Tomer index↓", "Life exp.", "HALE", "Health score", "Violent & road deaths per 100k", "Freedom", "Income per person"]);

  const table = render(<Leaderboard />);
  await screen.findByRole("table");
  const liveRows = [...table.container.querySelectorAll(".leaderboard-table tbody tr")];
  expect(markup(liveRows.slice(0, 25))).toEqual(markup(snapshotRows));
  table.unmount();

  window.matchMedia = (query) => ({
    matches: query === "(max-width: 560px)",
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  onTestFinished(() => delete window.matchMedia);
  const cards = render(<Leaderboard />);
  await screen.findByText(/^Showing /);
  const liveCards = [...cards.container.querySelectorAll(".leaderboard-card")];
  expect(markup(liveCards.slice(0, 25))).toEqual(markup(snapshotCards));
});

const snapshotTable = <p data-testid="snapshot">Top 25 of 146 countries.</p>;

test("the prerendered snapshot stays on screen until the data loads", async () => {
  render(<Leaderboard placeholder={snapshotTable} />);
  // First client render: controls and the snapshot, no table blink or loading line.
  expect(screen.getByTestId("snapshot")).toBeTruthy();
  expect(screen.queryByText("Loading data…")).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getByRole("searchbox")).toBeTruthy();
  const table = await screen.findByRole("table");
  expect(screen.queryByTestId("snapshot")).toBeNull();
  expect(table.querySelectorAll("tbody tr")).toHaveLength(
    leaderboard.countries.length,
  );
});

test("a failed load keeps the snapshot and still offers Retry", async () => {
  loadYearSnapshot.mockRejectedValueOnce(new Error("Temporary network failure"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  window.history.replaceState(null, "", "/?year=2001");
  render(<Leaderboard placeholder={snapshotTable} />);
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Couldn't load the data.");
  expect(screen.getByTestId("snapshot")).toBeTruthy();
  await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
  await screen.findByRole("table");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByTestId("snapshot")).toBeNull();
  expect(results().textContent).toMatch(/ in 2001\.$/);
});

test("the server preview shows the default view with inert controls and loads nothing", async () => {
  // The prerender can't see the URL, so the preview ignores it.
  window.history.replaceState(null, "", "/?year=2000&q=japan&w_health=100");
  loadLeaderboardData.mockClear();
  loadYearSnapshot.mockClear();
  render(<LeaderboardPreview placeholder={snapshotTable} />);
  await act(() => Promise.resolve());
  const controls = screen.getByRole("region", { name: "Leaderboard controls" });
  expect(controls.hasAttribute("inert")).toBe(true);
  expect(document.querySelector(".mobile-sort").hasAttribute("inert")).toBe(
    true,
  );
  expect(document.querySelector(".year-output").textContent).toBe(
    String(YEAR_MAX),
  );
  expect(document.querySelector("#search-input").value).toBe("");
  expect(screen.getByText("Custom weights").closest("details").open).toBe(
    false,
  );
  expect(screen.getByTestId("snapshot")).toBeTruthy();
  expect(screen.queryByText("Loading data…")).toBeNull();
  expect(loadLeaderboardData).not.toHaveBeenCalled();
  expect(loadYearSnapshot).not.toHaveBeenCalled();
});

test("past-year group rows show that year's member count", async () => {
  window.history.replaceState(null, "", "/?year=2000&type=derived,income");
  render(<Leaderboard />);
  const table = await screen.findByRole("table");
  await screen.findByText(/ in 2000\.$/);
  const count = (iso) =>
    history.entrySeries[iso].points.find((point) => point.year === 2000).n;
  expect(rowFor(table, "World").cells[1].textContent).toContain(
    `World · ${count("WLD")} countries`,
  );
  expect(rowFor(table, "High income").cells[1].textContent).toContain(
    `Income group · ${count("HIC")} countries`,
  );
  expect(count("WLD")).not.toBe(
    leaderboard.countries.find((row) => row.iso === "WLD").memberCount,
  );
});

test("weights that rescale to the published split are not a custom index", async () => {
  for (const query of [
    "w_health=80&w_safety=60&w_freedom=40&w_abundance=20",
    "w_health=0&w_safety=0&w_freedom=0&w_abundance=0",
  ]) {
    window.history.replaceState(null, "", `/?${query}`);
    const view = render(<Leaderboard />);
    const table = await screen.findByRole("table");
    expect(
      within(table).getByRole("button", { name: "Tomer index" }),
    ).toBeTruthy();
    expect(results().textContent).toBe(
      `Showing ${countryCount} countries and ${groupCount} groups.`,
    );
    expect(screen.queryByText(/^Scores use a custom index/)).toBeNull();
    view.unmount();
  }
});
