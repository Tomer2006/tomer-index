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
import Compare from "../src/components/compare";
import { SERIES_COLORS } from "../src/components/history-chart";
import { rowsForSnapshot, tomerRanks } from "../src/view-model.js";
import {
  loadEntrySeries,
  loadLeaderboardData,
  loadSeriesData,
  loadWorldData,
  loadYearSnapshot,
} from "../src/data-loader.js";
import { yearSnapshots } from "../src/data-split.js";
import { YEAR_MAX, YEAR_MIN } from "../src/site-years.js";

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
const years = yearSnapshots(history.entrySeries);
beforeAll(() => {
  loadLeaderboardData.mockResolvedValue(leaderboard);
  loadEntrySeries.mockImplementation(async (iso) => {
    if (!history.entrySeries[iso]) throw new Error(`Missing entry ${iso}`);
    return history.entrySeries[iso];
  });
  loadYearSnapshot.mockImplementation(async (year) => years[year]);
});

const picksParam = () =>
  new URLSearchParams(window.location.search).get("picks");
const headNames = () =>
  [...screen.getByRole("table").querySelectorAll("thead th")]
    .slice(1)
    .map((th) => th.querySelector("a").textContent);
const addInput = () =>
  screen.getByRole("combobox", { name: "Add a country or group" });

// Runs first: the leaderboard request is cached per module after it resolves.
test("presets stay disabled until the data loads, so shared picks survive", async () => {
  let release;
  loadLeaderboardData.mockImplementationOnce(
    () => new Promise((done) => (release = done)),
  );
  window.history.replaceState(null, "", "/compare?picks=USA,JPN&year=2010");
  render(<Compare />);
  const g7 = screen.getByRole("button", { name: "G7" });
  expect(g7.disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Top 5" }).disabled).toBe(true);
  expect(addInput().disabled).toBe(true);
  fireEvent.click(g7);
  expect(picksParam()).toBe("USA,JPN");
  release(leaderboard);
  await screen.findByRole("table");
  expect(headNames()).toEqual(["United States", "Japan"]);
  expect(g7.disabled).toBe(false);
});

test("comparison adds by list pick, Enter, or ISO code; removes; and explains misses", async () => {
  window.history.replaceState(null, "", "/compare?picks=USA,JPN");
  const user = userEvent.setup();
  render(<Compare />);
  await screen.findByRole("table");
  expect(
    screen.getByRole("link", { name: "United States" }).getAttribute("href"),
  ).toBe("/entry/USA");
  const chips = () =>
    within(
      screen.getByRole("list", { name: "Selected countries and groups" }),
    ).getAllByRole("listitem");
  expect(chips()).toHaveLength(2);
  // Choosing a datalist option (a change without typing) adds it right away.
  fireEvent.change(addInput(), { target: { value: "Norway" } });
  expect(picksParam()).toBe("USA,JPN,NOR");
  expect(addInput().value).toBe("");
  expect(document.getElementById("compare-add-message").textContent).toBe(
    "Added Norway.",
  );
  // Typing a full name waits for Enter ("Niger" must not add on the way to "Nigeria").
  await user.type(addInput(), "Sweden");
  expect(picksParam()).toBe("USA,JPN,NOR");
  await user.keyboard("{Enter}");
  expect(picksParam()).toBe("USA,JPN,NOR,SWE");
  await user.type(addInput(), "fin{Enter}");
  expect(picksParam()).toBe("USA,JPN,NOR,SWE,FIN");
  await user.type(addInput(), "japan{Enter}");
  expect(addInput().getAttribute("aria-describedby")).toBe(
    "compare-add-message",
  );
  expect(document.getElementById("compare-add-message").textContent).toBe(
    "Japan is already selected.",
  );
  // Text that only matches picked rows says so, rather than "no match".
  await user.clear(addInput());
  await user.type(addInput(), "Japa");
  expect(document.getElementById("compare-add-message").textContent).toBe(
    "Japan is already selected.",
  );
  await user.keyboard("{Enter}");
  expect(document.getElementById("compare-add-message").textContent).toBe(
    "Japan is already selected.",
  );
  expect(picksParam()).toBe("USA,JPN,NOR,SWE,FIN");
  await user.clear(addInput());
  await user.type(addInput(), "zzz");
  expect(document.getElementById("compare-add-message").textContent).toBe(
    "No country or group matches “zzz”.",
  );
  await user.clear(addInput());
  // Region names match too, as on the leaderboard; several matches need a choice.
  await user.type(addInput(), "Northern Europe{Enter}");
  expect(document.getElementById("compare-add-message").textContent).toMatch(
    /^\d+ countries and groups match “Northern Europe”/,
  );
  expect(picksParam()).toBe("USA,JPN,NOR,SWE,FIN");
  expect(headNames()).toEqual([
    "United States",
    "Japan",
    "Norway",
    "Sweden",
    "Finland",
  ]);
  expect(
    [...document.querySelectorAll("#compare-add-list option")].some(
      (option) => option.value === "Japan",
    ),
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "Remove Japan" }));
  expect(picksParam()).toBe("USA,NOR,SWE,FIN");
  expect(chips()).toHaveLength(4);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Remove Norway" }),
  );
}, 20000);

test("presets replace the selection, Clear empties it, and the chart count follows the metrics", async () => {
  window.history.replaceState(null, "", "/compare?picks=USA&year=2010");
  const user = userEvent.setup();
  render(<Compare />);
  await screen.findByRole("table");
  expect(screen.getByRole("group", { name: /Presets/ }).textContent).toContain(
    "replace the selection",
  );
  expect(await screen.findAllByRole("img")).toHaveLength(8);
  expect(screen.getByRole("slider", { name: "Year" }).value).toBe("2010");
  await user.click(screen.getByRole("button", { name: "Nordics" }));
  expect(picksParam()).toBe("NOR,SWE,FIN,DNK,ISL");
  expect(headNames()).toHaveLength(5);
  await user.click(screen.getByRole("button", { name: "Top 5" }));
  const rows2010 = rowsForSnapshot(leaderboard.countries, years[2010], 2010);
  const top = [...tomerRanks(rows2010).ranks.keys()].slice(0, 5);
  expect(picksParam()).toBe(top.join(","));
  await user.click(screen.getByRole("button", { name: "Clear" }));
  expect(picksParam()).toBeNull();
  // Clear unmounts itself, so focus moves to the add field instead of the page.
  expect(document.activeElement).toBe(addInput());
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getByText(/Add a country or group above/)).toBeTruthy();
  expect(loadSeriesData).not.toHaveBeenCalled();
});

test("unknown and repeated picks are reported once, and table swatches match chart lines", async () => {
  window.history.replaceState(null, "", "/compare?picks=XXX,USA,JPN,USA");
  const { container } = render(<Compare />);
  await screen.findByRole("table");
  expect(screen.getByText("Unknown country code XXX ignored.")).toBeTruthy();
  expect(
    screen.getByText(/United States was picked more than once/),
  ).toBeTruthy();
  expect(headNames()).toEqual(["United States", "Japan"]);
  expect(screen.queryByText("XXX")).toBeNull();
  await screen.findAllByRole("img");
  const swatches = (selector) =>
    [...container.querySelectorAll(selector)].map((node) =>
      node.style.getPropertyValue("--series-color"),
    );
  expect(swatches(".compare-head-swatch")).toEqual(SERIES_COLORS.slice(0, 2));
  expect(swatches(".compare-chip-swatch")).toEqual(SERIES_COLORS.slice(0, 2));
  const legend = container.querySelector(".metric-card .compare-series-legend");
  expect(legend.textContent).toBe("United StatesJapan");
  expect(
    [...legend.querySelectorAll(".compare-series-swatch")].map((node) =>
      node.style.getPropertyValue("--series-color"),
    ),
  ).toEqual(SERIES_COLORS.slice(0, 2));
  expect(loadEntrySeries).not.toHaveBeenCalledWith("XXX");
});

test("ranks count countries only, groups are unranked, and best values are marked in text", async () => {
  window.history.replaceState(null, "", "/compare?picks=USA,WLD,JPN");
  render(<Compare />);
  const table = await screen.findByRole("table");
  const { ranks, total } = tomerRanks(leaderboard.countries);
  const rankRow = within(table).getByRole("row", {
    name: new RegExp(`^Rank \\(of ${total} countries\\)`),
  });
  const cells = within(rankRow).getAllByRole("cell");
  expect(cells[0].textContent).toBe(String(ranks.get("USA")));
  expect(cells[1].textContent).toBe("Group, not ranked");
  expect(within(cells[1]).getByText("Group")).toBeTruthy();
  expect(cells[2].textContent).toBe(String(ranks.get("JPN")));
  const tomerRow = table.querySelector('tr[data-metric="tomer"]');
  expect(within(tomerRow).getAllByText("(best)")).toHaveLength(1);
  expect(tomerRow.querySelectorAll(".compare-best")).toHaveLength(1);
  // The compact badges aren't focusable, so the note under the table explains them.
  const note = document.querySelector(".compare-table-note").textContent;
  for (const text of [
    "marks the best value",
    "“est.” = estimated from an earlier year’s value",
    "“GDP” = GDP used before a country’s GNI starts",
    "“*” = at least one input estimated or GDP",
    `Amber years are 5+ years older than ${YEAR_MAX}.`,
  ])
    expect(note).toContain(text);
});

test("the table's hidden text stays inside its sideways scroller", () => {
  // Visually hidden spans are position: absolute; if the scroller isn't their
  // containing block they escape its overflow and widen the whole page.
  const css = readFileSync(resolve("src/style.css"), "utf8");
  const wrap = css.match(/\n\.compare-table-wrap \{([^}]*)\}/)[1];
  expect(wrap).toMatch(/position:\s*relative/);
  expect(wrap).toMatch(/overflow-x:\s*auto/);
});

test("past years load one snapshot and keep the previous year visible while the next loads", async () => {
  window.history.replaceState(null, "", "/compare?picks=JPN&year=2012");
  const { container } = render(<Compare />);
  await screen.findByRole("table");
  expect(loadYearSnapshot).toHaveBeenCalledWith("2012");
  let release;
  loadYearSnapshot.mockImplementationOnce(
    () => new Promise((done) => (release = () => done(years[2003]))),
  );
  fireEvent.change(screen.getByRole("slider", { name: "Year" }), {
    target: { value: "2003" },
  });
  expect(screen.getByRole("table")).toBeTruthy();
  expect(container.querySelector(".compare-summary").textContent).toBe(
    "Showing Japan in 2012. Add another country or group to compare. Loading 2003…",
  );
  release();
  await waitFor(() =>
    expect(container.querySelector(".compare-summary").textContent).toBe(
      "Showing Japan in 2003. Add another country or group to compare.",
    ),
  );
  expect(loadSeriesData).not.toHaveBeenCalled();
});

test("comparison chart follows the year slider after keyboard inspection", async () => {
  window.history.replaceState(null, "", "/compare?picks=JPN&year=2010");
  const { container } = render(<Compare />);
  await screen.findByRole("table");
  fireEvent.keyDown((await screen.findAllByRole("img"))[0], {
    key: "ArrowLeft",
  });
  expect(screen.getByRole("slider", { name: "Year" }).value).toBe("2009");
  fireEvent.change(screen.getByRole("slider", { name: "Year" }), {
    target: { value: "2000" },
  });
  for (const card of container.querySelectorAll(".metric-card")) {
    expect(within(card).getByText("2000", { selector: "strong" })).toBeTruthy();
  }
});

test("tapping a chart changes the page year, as the copy says", async () => {
  window.history.replaceState(null, "", "/compare?picks=USA,JPN");
  render(<Compare />);
  await screen.findByRole("table");
  expect(
    screen.getByText(/Click or tap a chart to change the year\./),
  ).toBeTruthy();
  const chart = (await screen.findAllByRole("img"))[0];
  // jsdom has no layout, so clientX 0 lands left of the plot: the first year.
  fireEvent.pointerDown(chart, { pointerType: "touch", clientX: 0, clientY: 50 });
  fireEvent.pointerUp(chart, { pointerType: "touch", clientX: 0, clientY: 50 });
  expect(screen.getByRole("slider", { name: "Year" }).value).toBe(
    String(YEAR_MIN),
  );
  expect(new URLSearchParams(window.location.search).get("year")).toBe(
    String(YEAR_MIN),
  );
});
