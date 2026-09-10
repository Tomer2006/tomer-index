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
import Compare from "../src/components/compare";
import Entry from "../src/components/entry";
import WorldMap from "../src/components/world-map";
import { YEAR_MAX } from "../src/site-years.js";
import {
  loadLeaderboardData,
  loadSeriesData,
  loadWorldData,
} from "../src/data-loader.js";

vi.mock("../src/data-loader.js", () => ({
  loadLeaderboardData: vi.fn(),
  loadSeriesData: vi.fn(),
  loadWorldData: vi.fn(),
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
});

test("failed data loads can be retried without a reload", async () => {
  loadLeaderboardData.mockRejectedValueOnce(
    new Error("Temporary network failure"),
  );
  render(<Leaderboard />);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("Temporary network failure"),
  );
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("table");
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
  ).toBe("/entry?iso=JPN");
  await user.clear(screen.getByRole("searchbox"));
  await user.click(
    screen.getByRole("checkbox", { name: "Include aggregates" }),
  );
  expect(table.querySelectorAll("tbody tr")).toHaveLength(
    leaderboard.countries.filter((row) => !row.derivedKind).length,
  );
  await user.click(
    screen.getByRole("button", { name: "Sort by Homicides /100k" }),
  );
  expect(window.location.search).toContain("sort=homicides");
  const firstRow = table.querySelector("tbody tr");
  await user.click(
    screen.getByRole("button", {
      name: "Sort by Homicides /100k: click to reverse",
    }),
  );
  expect(table.querySelector("tbody tr").textContent).not.toBe(
    firstRow.textContent,
  );
  fireEvent.change(screen.getByRole("slider", { name: "Health weight" }), {
    target: { value: "80" },
  });
  expect(window.location.search).toContain("w_health=80");
  expect(
    screen.getByText("Normalized to 100% from 140 slider points"),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Reset weights" }));
  expect(window.location.search).not.toContain("w_health");
  fireEvent.change(screen.getByRole("slider", { name: "Year" }), {
    target: { value: "2000" },
  });
  await screen.findByRole("table");
  expect(loadSeriesData).toHaveBeenCalledTimes(1);
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
  await user.click(screen.getByRole("button", { name: "Reset", exact: true }));
  expect(window.location.search).not.toContain("region");
  expect(table.querySelectorAll("tbody tr")).toHaveLength(
    leaderboard.countries.length,
  );
});

test("comparison supports shared selections, searched pickers, presets, and duplicate validation", async () => {
  window.history.replaceState(null, "", "/compare?picks=USA,JPN&year=2010");
  const user = userEvent.setup();
  render(<Compare />);
  await screen.findByRole("table");
  expect(screen.getByRole("link", { name: "United States" })).toBeTruthy();
  expect(screen.getAllByRole("img")).toHaveLength(6);
  expect(screen.getByRole("slider", { name: "Year" }).value).toBe("2010");
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Entry 2" }),
    "USA",
  );
  expect(screen.getByText(/Duplicate entry selected/)).toBeTruthy();
  await user.click(
    screen.getByRole("button", { name: "Nordics", exact: true }),
  );
  expect(screen.getByRole("table").querySelectorAll("thead th")).toHaveLength(
    6,
  );
  await user.click(screen.getByRole("button", { name: "Clear", exact: true }));
  expect(screen.getByText("Pick an entry to begin.")).toBeTruthy();
  await user.type(
    screen.getByRole("searchbox", { name: "Search entry 1" }),
    "Japan",
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Entry 1" }),
    "JPN",
  );
  expect(window.location.search).toContain("picks=JPN");
  await user.click(screen.getByRole("button", { name: "+ Add country" }));
  expect(screen.getAllByRole("combobox")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Remove entry 2" }));
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
}, 20000);

test("entry history shows source labels and keyboard-accessible charts; invalid ids show an error", async () => {
  window.history.replaceState(null, "", "/entry?iso=JPN");
  const view = render(<Entry />);
  await screen.findByRole("heading", { name: "Japan" });
  expect(screen.getAllByRole("img")).toHaveLength(6);
  fireEvent.keyDown(screen.getAllByRole("img")[0], { key: "ArrowLeft" });
  expect(
    within(view.container.querySelector(".metric-card")).getByText(String(YEAR_MAX - 1)),
  ).toBeTruthy();
  expect(document.title).toBe("Japan history — Tomer index");
  expect(
    view.container.querySelectorAll(".source-year-badge").length,
  ).toBeGreaterThan(0);
  view.unmount();
  window.history.replaceState(null, "", "/entry?iso=INVALID");
  render(<Entry />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "No leaderboard entry found for INVALID",
  );
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
  ).toBe("/entry?iso=JPN");
  const search = screen.getByRole("combobox", { name: "Find a country" });
  await user.clear(search);
  await user.type(search, "USA");
  expect(screen.getByRole("heading", { name: "United States" })).toBeTruthy();
  expect(window.location.search).toContain("iso=USA");
  fireEvent.keyDown(screen.getByRole("button", { name: /^Japan:/ }), {
    key: "Enter",
  });
  expect(screen.getByRole("heading", { name: "Japan" })).toBeTruthy();
  fireEvent.change(screen.getByRole("slider", { name: "Health weight" }), {
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
  expect(container.querySelector(".map-page.is-fullscreen")).toBeTruthy();
  expect(document.body.style.overflow).toBe("hidden");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(container.querySelector(".map-page.is-fullscreen")).toBeNull();
  expect(document.body.style.overflow).not.toBe("hidden");
  expect(screen.getByRole("button", { name: "Fullscreen", exact: true })).toBe(document.activeElement);
});

test("comparison preserves blank slots and clears stale searches", async () => {
  const user = userEvent.setup();
  render(<Compare />);
  await screen.findByText("Pick an entry to begin.");
  await user.click(screen.getByRole("button", { name: "+ Add country" }));
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Entry 2" }),
    "JPN",
  );
  expect(screen.getByRole("combobox", { name: "Entry 1" }).value).toBe("");
  expect(screen.getByRole("combobox", { name: "Entry 2" }).value).toBe("JPN");
  await user.click(screen.getByRole("button", { name: "Remove entry 1" }));
  expect(screen.getByRole("combobox", { name: "Entry 1" }).value).toBe("JPN");
  await user.type(
    screen.getByRole("searchbox", { name: "Search entry 1" }),
    "Japan",
  );
  await user.click(screen.getByRole("button", { name: "Clear", exact: true }));
  expect(screen.getByRole("searchbox", { name: "Search entry 1" }).value).toBe(
    "",
  );
  expect(
    screen.getByRole("option", { name: "United States", exact: true }),
  ).toBeTruthy();
});

test("comparison chart follows the year slider after keyboard inspection", async () => {
  window.history.replaceState(null, "", "/compare?picks=JPN&year=2010");
  const { container } = render(<Compare />);
  await screen.findByRole("table");
  fireEvent.keyDown(screen.getAllByRole("img")[0], { key: "ArrowLeft" });
  expect(screen.getByRole("slider", { name: "Year" }).value).toBe("2009");
  fireEvent.change(screen.getByRole("slider", { name: "Year" }), {
    target: { value: "2000" },
  });
  for (const card of container.querySelectorAll(".metric-card")) {
    expect(within(card).getByText("2000", { selector: "strong" })).toBeTruthy();
  }
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
