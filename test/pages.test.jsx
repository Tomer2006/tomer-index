import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, expect, test, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Leaderboard from "../src/components/leaderboard";
import Entry from "../src/components/entry";
import WorldMap from "../src/components/world-map";
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
  history = read("series.json"),
  world = read("world.geojson");
const leaderboard = {
  ...allLeaderboard,
  countries: allLeaderboard.countries.filter(
    (row, index) =>
      index < 15 ||
      ["USA", "JPN", "NOR", "SWE", "FIN", "DNK", "ISL", "WLD"].includes(
        row.iso,
      ),
  ),
};
beforeAll(() => {
  loadLeaderboardData.mockResolvedValue(leaderboard);
  loadSeriesData.mockResolvedValue(history);
  loadWorldData.mockResolvedValue(world);
  const years = yearSnapshots(history.entrySeries);
  loadEntrySeries.mockImplementation(async (iso) => {
    if (!history.entrySeries[iso]) throw new Error(`Missing entry ${iso}`);
    return history.entrySeries[iso];
  });
  loadYearSnapshot.mockImplementation(async (year) => years[year]);
});

test("failed data loads can be retried without a reload", async () => {
  loadLeaderboardData.mockRejectedValueOnce(
    new Error("Temporary network failure"),
  );
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  render(<Leaderboard />);
  // First test in the file: allow for a cold transform cache under full-suite load.
  expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveProperty(
    "textContent",
    expect.stringContaining(
      "Couldn't load the data. Check your connection and try again.",
    ),
  );
  expect(logged.mock.calls.map(String).join("\n")).toContain(
    "Temporary network failure",
  );
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("table", {}, { timeout: 5000 });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(loadSeriesData).not.toHaveBeenCalled();
});

test("leaderboard searches, filters, sorts, changes weights, and restores historical links", async () => {
  const user = userEvent.setup();
  render(<Leaderboard />);
  const table = await screen.findByRole("table");
  expect(table.querySelectorAll("tbody tr")).toHaveLength(
    leaderboard.countries.length,
  );
  await user.type(screen.getByRole("searchbox"), "Japan");
  expect(table.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(window.location.search).toContain("q=Japan");
  expect(
    within(table).getByRole("link", { name: "Japan" }).getAttribute("href"),
  ).toBe("/entry/JPN");
  await user.clear(screen.getByRole("searchbox"));
  await user.click(
    screen.getByRole("checkbox", { name: "Show regions & groups" }),
  );
  expect(table.querySelectorAll("tbody tr")).toHaveLength(
    leaderboard.countries.filter((row) => !row.derivedKind).length,
  );
  const deaths = screen.getByRole("button", { name: "Homicides per 100k" });
  await user.click(deaths);
  expect(window.location.search).toContain("sort=homicides");
  expect(deaths.closest("th").getAttribute("aria-sort")).toBe("ascending");
  expect(table.querySelectorAll("th[aria-sort]")).toHaveLength(1);
  const firstRow = table.querySelector("tbody tr");
  await user.click(deaths);
  expect(deaths.closest("th").getAttribute("aria-sort")).toBe("descending");
  expect(table.querySelector("tbody tr").textContent).not.toBe(
    firstRow.textContent,
  );
  fireEvent.change(screen.getByRole("slider", { name: "Health" }), {
    target: { value: "80" },
  });
  expect(window.location.search).toContain("w_health=80");
  expect(screen.getByText("Weights are rescaled to total 100%.")).toBeTruthy();
  expect(within(table).getByRole("button", { name: "Custom index" })).toBeTruthy();
  const note = screen.getByText(/^Scores use a custom index/);
  expect(note.textContent).toContain("Health 57.1%");
  expect(note.textContent).toContain("The published Tomer index uses 40/30/20/10.");
  await user.click(within(note).getByRole("button", { name: "Reset weights" }));
  expect(window.location.search).not.toContain("w_health");
  expect(within(table).getByRole("button", { name: "Tomer index" })).toBeTruthy();
  expect(screen.queryByText(/^Scores use a custom index/)).toBeNull();
  fireEvent.change(screen.getByRole("slider", { name: "Year" }), {
    target: { value: "2000" },
  });
  await screen.findByText(/ in 2000\.$/);
  expect(screen.getByRole("table")).toBe(table);
  expect(loadSeriesData).not.toHaveBeenCalled();
  expect(loadYearSnapshot).toHaveBeenCalledWith("2000");
  await user.type(screen.getByRole("searchbox"), "Japan");
  const japan = history.entrySeries.JPN.points.find(
    (point) => point.year === 2000,
  );
  expect(screen.getByRole("table").textContent).toContain(japan.le.toFixed(1));
  expect(window.location.search).toContain("year=2000");
}, 20000);

test("detailed region links filter historical rows, combine selections, and reset", async () => {
  window.history.replaceState(null, "", "/?region=UN-154&year=2000");
  const user = userEvent.setup();
  render(<Leaderboard />);
  const table = await screen.findByRole("table");
  expect(within(table).getByRole("link", { name: "Sweden" })).toBeTruthy();
  expect(within(table).queryByRole("link", { name: "Japan" })).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Northern Europe", exact: true })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  await user.click(
    screen.getByRole("button", { name: "Eastern Asia", exact: true }),
  );
  expect(within(table).getByRole("link", { name: "Japan" })).toBeTruthy();
  expect(new URLSearchParams(window.location.search).get("region")).toBe(
    "UN-154,UN-030",
  );
  await user.click(screen.getByRole("button", { name: "Reset filters" }));
  expect(window.location.search).not.toContain("region");
  expect(table.querySelectorAll("tbody tr")).toHaveLength(
    leaderboard.countries.length,
  );
});

test("entry history shows source labels and keyboard-accessible charts; invalid ids show an error", async () => {
  const view = render(<Entry iso="JPN" />);
  await screen.findByRole("heading", { level: 1, name: "Japan" });
  expect(await screen.findAllByRole("img")).toHaveLength(8);
  expect(loadEntrySeries).toHaveBeenCalledWith("JPN");
  fireEvent.keyDown(screen.getAllByRole("img")[0], { key: "ArrowLeft" });
  expect(
    within(view.container.querySelector(".metric-card")).getByText(String(YEAR_MAX - 1)),
  ).toBeTruthy();
  expect(
    view.container.querySelectorAll(".source-year-badge").length,
  ).toBeGreaterThan(0);
  view.unmount();
  render(<Entry iso="INVALID" />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "No country or group matches “INVALID”.",
  );
  expect(
    screen.getByRole("heading", { level: 1, name: "Country not found" }),
  ).toBeTruthy();
});

test("map supports shared country selection, searching, keyboard selection, and weights", async () => {
  window.history.replaceState(null, "", "/map?iso=JPN&year=2010");
  const user = userEvent.setup();
  const { container } = render(<WorldMap />);
  await screen.findByRole("heading", { name: "Japan" });
  expect(container.querySelectorAll("path.map-country").length).toBeGreaterThan(
    150,
  );
  expect(
    screen.getByRole("link", { name: "View history →" }).getAttribute("href"),
  ).toBe("/entry/JPN");
  // Country shapes are not tab stops; keyboard selection goes through the search box.
  expect(container.querySelectorAll(".map-geography [tabindex]")).toHaveLength(0);
  const search = screen.getByRole("combobox", { name: "Find a country" });
  await user.clear(search);
  await user.type(search, "USA{Enter}");
  expect(screen.getByRole("heading", { name: "United States" })).toBeTruthy();
  expect(window.location.search).toContain("iso=USA");
  expect(document.activeElement).toBe(
    container.querySelector(".map-detail-panel"),
  );
  fireEvent.click(container.querySelector('path.map-country[data-iso="JPN"]'));
  expect(screen.getByRole("heading", { name: "Japan" })).toBeTruthy();
  fireEvent.change(screen.getByRole("slider", { name: /^Health/ }), {
    target: { value: "0" },
  });
  expect(window.location.search).toContain("w_health=0");
  await user.click(screen.getByRole("button", { name: "Reset weights" }));
  expect(window.location.search).not.toContain("w_health");
}, 20000);

test("map zoom is bounded, keyboard panning resets, and fullscreen can be exited", async () => {
  window.history.replaceState(null, "", "/map?iso=JPN");
  const user = userEvent.setup();
  const { container } = render(<WorldMap />);
  await screen.findByRole("heading", { name: "Japan" });
  const svg = container.querySelector(".map-svg-root");
  const geography = container.querySelector(".map-geography");
  expect(screen.getByRole("button", { name: "Zoom out" }).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(screen.getByLabelText("Map zoom").textContent).toBe("150%");
  const beforePan = geography.getAttribute("transform");
  fireEvent.keyDown(svg, { key: "ArrowRight" });
  expect(geography.getAttribute("transform")).not.toBe(beforePan);
  for (let i = 0; i < 8; i++) fireEvent.keyDown(svg, { key: "+" });
  expect(screen.getByLabelText("Map zoom").textContent).toBe("800%");
  expect(screen.getByRole("button", { name: "Zoom in" }).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Reset view" }));
  expect(geography.getAttribute("transform")).toBe("translate(0,0) scale(1)");
  expect(window.location.search).toContain("iso=JPN");
  await user.click(screen.getByRole("button", { name: "Fullscreen", exact: true }));
  const fullscreenMap = container.querySelector(".map-wrap.is-fullscreen");
  expect(fullscreenMap).toBeTruthy();
  expect(fullscreenMap.contains(svg)).toBe(true);
  expect(within(fullscreenMap).getByRole("button", { name: "Exit fullscreen" })).toBeTruthy();
  expect(fullscreenMap.querySelector(".map-controls")).toBeNull();
  expect(fullscreenMap.querySelector(".map-detail-panel")).toBeNull();
  expect(document.body.style.overflow).toBe("hidden");
  // Keyboard users can still pick a country: Find a country moves into the fullscreen view.
  const search = within(fullscreenMap).getByRole("combobox", { name: "Find a country" });
  expect(screen.getAllByRole("combobox", { name: "Find a country" })).toHaveLength(1);
  await user.tripleClick(search);
  await user.keyboard("Kenya{Enter}");
  expect(window.location.search).toContain("iso=KEN");
  expect(document.activeElement).toBe(search);
  expect(fullscreenMap.querySelector(".map-fs-detail").textContent).toContain("Kenya");
  expect(screen.getByText("Kenya selected.", { exact: false })).toBeTruthy();
  // Tab from the last control wraps to the search box.
  const targets = fullscreenMap.querySelectorAll('button:not(:disabled), input, a[href], [tabindex="0"]');
  targets[targets.length - 1].focus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(document.activeElement).toBe(search);
  fireEvent.keyDown(search, { key: "Escape" });
  expect(container.querySelector(".map-wrap.is-fullscreen")).toBeNull();
  expect(document.body.style.overflow).not.toBe("hidden");
  expect(screen.getByRole("button", { name: "Fullscreen", exact: true })).toBe(document.activeElement);
  expect(window.location.search).toContain("iso=KEN");
  expect(
    container.querySelector(".map-controls").contains(
      screen.getByRole("combobox", { name: "Find a country" }),
    ),
  ).toBe(true);
});

test("card sorting controls update the shared leaderboard order", async () => {
  const user = userEvent.setup();
  render(<Leaderboard />);
  const table = await screen.findByRole("table");
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Sort by" }),
    "name",
  );
  const firstName = table.querySelector("tbody tr a").textContent;
  await user.click(screen.getByRole("button", { name: "A–Z", exact: true }));
  expect(table.querySelector("tbody tr a").textContent).not.toBe(firstName);
  expect(window.location.search).toContain("dir=asc");
});
