import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, expect, test, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorldMap, { WorldMapPreview } from "../src/components/world-map";
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
const leaderboard = read("leaderboard.json"),
  history = read("series.json"),
  world = read("world.geojson");
const years = yearSnapshots(history.entrySeries);
let releaseLeaderboard;
beforeAll(() => {
  // The first test sees the leaderboard still loading; requests are cached per key.
  loadLeaderboardData.mockImplementation(
    () =>
      new Promise((done) => {
        releaseLeaderboard = () => done(leaderboard);
      }),
  );
  loadSeriesData.mockResolvedValue(history);
  loadWorldData.mockResolvedValue(world);
  loadEntrySeries.mockImplementation(async (iso) => history.entrySeries[iso]);
  loadYearSnapshot.mockImplementation(async (year) => years[year]);
});
const legendText = (container) =>
  container.querySelector(".map-legend").textContent;

test("the legend shows no made-up scale while scores load", async () => {
  window.history.replaceState(null, "", "/map");
  const { container } = render(<WorldMap />);
  expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  expect(container.querySelector("main#main h1")).toBeTruthy();
  expect(container.querySelector(".map-svg-root")).toBeTruthy();
  expect(legendText(container)).toContain("Loading scores…");
  expect(container.querySelector(".map-legend-ticks")).toBeNull();
  releaseLeaderboard();
  await waitFor(() =>
    expect(container.querySelectorAll(".map-legend-ticks span")).toHaveLength(9),
  );
  expect(legendText(container)).toContain(
    "Colors split 2025’s scores into 8 equal-sized groups",
  );
  // Each band's range is text, not only a tooltip.
  const bands = [...container.querySelectorAll(".map-legend-stop")].map(
    (stop) => stop.textContent,
  );
  expect(bands).toHaveLength(8);
  for (const band of bands) expect(band).toMatch(/^\d+\.\d to \d+\.\d$/);
});

test("typing in Find a country never rewrites the text", async () => {
  window.history.replaceState(null, "", "/map");
  const user = userEvent.setup();
  render(<WorldMap />);
  await waitFor(() =>
    expect(document.querySelectorAll("#map-search-list option").length).toBeGreaterThan(100),
  );
  const search = screen.getByRole("combobox", { name: "Find a country" });
  for (const [name, iso] of [
    ["Austria", "AUT"],
    ["Sweden", "SWE"],
  ]) {
    await user.clear(search);
    let typed = "";
    for (const letter of name) {
      typed += letter;
      await user.type(search, letter);
      expect(search.value).toBe(typed);
      if (typed !== name)
        expect(new URLSearchParams(window.location.search).get("iso")).toBeNull();
    }
    expect(new URLSearchParams(window.location.search).get("iso")).toBe(iso);
    expect(screen.getByRole("heading", { name, level: 2 })).toBeTruthy();
  }
});

test("Enter in Find a country takes an ISO code, a unique prefix, or explains", async () => {
  window.history.replaceState(null, "", "/map");
  const user = userEvent.setup();
  const { container } = render(<WorldMap />);
  const search = await screen.findByRole("combobox", { name: "Find a country" });
  await waitFor(() =>
    expect(container.querySelectorAll("path.map-country").length).toBeGreaterThan(150),
  );
  await user.type(search, "jpn{Enter}");
  expect(window.location.search).toContain("iso=JPN");
  expect(document.activeElement).toBe(container.querySelector(".map-detail-panel"));
  await user.clear(search);
  await user.type(search, "Switz{Enter}");
  expect(window.location.search).toContain("iso=CHE");
  // Typing over the selected name keeps the selection until something matches.
  await user.tripleClick(search);
  await user.keyboard("Neverland{Enter}");
  expect(search.value).toBe("Neverland");
  expect(screen.getByText("No country matches “Neverland”.")).toBeTruthy();
  expect(window.location.search).toContain("iso=CHE");
  await user.clear(search);
  await user.type(search, "Ice");
  expect(search.value).toBe("Ice");
  await user.clear(search);
  await user.type(search, "Mal{Enter}");
  expect(
    screen.getByText(/^\d+ countries start with “Mal”\. Keep typing or pick one from the list\.$/),
  ).toBeTruthy();
});

test("Enter in Find a country never picks a country by substring, region or income", async () => {
  window.history.replaceState(null, "", "/map");
  const user = userEvent.setup();
  const { container } = render(<WorldMap />);
  const search = await screen.findByRole("combobox", { name: "Find a country" });
  await waitFor(() =>
    expect(container.querySelectorAll("path.map-country").length).toBeGreaterThan(150),
  );
  const iso = () => new URLSearchParams(window.location.search).get("iso");
  // Types over the box's text (clearing it would also clear the selection).
  const enter = async (text) => {
    await user.tripleClick(search);
    await user.keyboard(`${text}{Enter}`);
  };
  // Exact codes and names reach unscored land on the map too, never a lookalike.
  for (const [text, code, name] of [
    ["VEN", "VEN", "Venezuela"], // not Slovenia
    ["esh", "ESH", "W. Sahara"], // not Bangladesh
    ["Guinea", "GIN", "Guinea"], // not Guinea-Bissau
    ["Kosovo", "XKX", "Kosovo"],
    ["AFG", "AFG", "Afghanistan"],
    ["Nig", null, null], // Niger and Nigeria
  ]) {
    await enter(text);
    if (!code) continue;
    expect(iso()).toBe(code);
    expect(screen.getByRole("heading", { name, level: 2 })).toBeTruthy();
    expect(screen.getByText(`${name} isn’t scored: the index’s data sources don’t cover it.`)).toBeTruthy();
  }
  expect(iso()).toBe("AFG");
  expect(screen.getByText("2 countries start with “Nig”. Keep typing or pick one from the list.")).toBeTruthy();
  // A unique name prefix still selects.
  await enter("Sloven");
  expect(iso()).toBe("SVN");
  // Region, income-level and mid-name text match nothing.
  for (const text of ["europe", "high income", "lovenia", "Country"]) {
    await enter(text);
    expect(screen.getByText(`No country matches “${text}”.`)).toBeTruthy();
    expect(iso()).toBe("SVN");
  }
});

test("a past year keeps the map mounted, shows the previous colors, and keeps the zoom", async () => {
  window.history.replaceState(null, "", "/map?iso=FRA");
  const user = userEvent.setup();
  const { container } = render(<WorldMap />);
  await screen.findByRole("heading", { name: "France", level: 2 });
  const svg = container.querySelector(".map-svg-root"),
    geography = container.querySelector(".map-geography"),
    france = () => container.querySelector('path.map-country[data-iso="FRA"]');
  await user.click(screen.getByRole("button", { name: "Zoom in" }));
  fireEvent.keyDown(svg, { key: "ArrowLeft" });
  const zoomed = geography.getAttribute("transform");
  expect(zoomed).not.toBe("translate(0,0) scale(1)");
  const colors2025 = france().getAttribute("fill");
  let release;
  loadYearSnapshot.mockImplementationOnce(
    (year) => new Promise((done) => (release = () => done(years[year]))),
  );
  fireEvent.change(screen.getByRole("slider", { name: "Year" }), {
    target: { value: "2010" },
  });
  expect(container.querySelector(".map-svg-root")).toBe(svg);
  expect(france().getAttribute("fill")).toBe(colors2025);
  expect(legendText(container)).toContain("Loading 2010…");
  release();
  await waitFor(() =>
    expect(legendText(container)).toContain("Colors split 2010’s"),
  );
  expect(container.querySelector(".map-svg-root")).toBe(svg);
  expect(geography.getAttribute("transform")).toBe(zoomed);
  expect(screen.getByLabelText("Map zoom").textContent).toBe("150%");
  expect(loadSeriesData).not.toHaveBeenCalled();
});

test("a year that fails to load keeps the map on screen and offers Retry", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  window.history.replaceState(null, "", "/map?iso=SWE");
  const user = userEvent.setup();
  const { container } = render(<WorldMap />);
  await screen.findByRole("heading", { name: "Sweden", level: 2 });
  const sweden = () => container.querySelector('path.map-country[data-iso="SWE"]');
  const colors2025 = sweden().getAttribute("fill"),
    hatched = container.querySelectorAll("path.map-country.is-no-data").length;
  loadYearSnapshot.mockImplementationOnce(() => Promise.reject(new Error("offline")));
  fireEvent.change(screen.getByRole("slider", { name: "Year" }), {
    target: { value: "2003" },
  });
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Couldn't load the data");
  // Nothing claims the countries lack data: the 2025 view stays, named as such.
  expect(sweden().getAttribute("fill")).toBe(colors2025);
  expect(container.querySelectorAll("path.map-country.is-no-data")).toHaveLength(hatched);
  expect(legendText(container)).toContain("Colors split 2025’s");
  expect(legendText(container)).toContain("2003 couldn’t be loaded");
  expect(screen.queryByText(/isn’t scored/)).toBeNull();
  expect(container.querySelector(".map-detail-sub").textContent).toContain("2025");
  await user.click(within(alert).getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(legendText(container)).toContain("Colors split 2003’s"),
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(container.querySelector(".map-detail-sub").textContent).toContain("2003");
  logged.mockRestore();
});

test("while a year loads, the map keeps the view that was on screen", async () => {
  window.history.replaceState(null, "", "/map?year=2005&iso=NGA");
  const { container } = render(<WorldMap />);
  await waitFor(() =>
    expect(legendText(container)).toContain("Colors split 2005’s"),
  );
  const slider = screen.getByRole("slider", { name: "Year" }),
    nigeria = () =>
      container.querySelector('path.map-country[data-iso="NGA"]').getAttribute("fill");
  fireEvent.change(slider, { target: { value: String(YEAR_MAX) } });
  expect(legendText(container)).toContain(`Colors split ${YEAR_MAX}’s`);
  const latestFill = nigeria();
  expect(latestFill).not.toBe("url(#map-no-data)");
  let release;
  loadYearSnapshot.mockImplementationOnce(
    (year) => new Promise((done) => (release = () => done(years[year]))),
  );
  fireEvent.change(slider, { target: { value: String(YEAR_MAX - 1) } });
  // Not 2005, the last year file that happened to load.
  expect(legendText(container)).toContain(`Colors split ${YEAR_MAX}’s`);
  expect(legendText(container)).toContain(`Loading ${YEAR_MAX - 1}…`);
  expect(nigeria()).toBe(latestFill);
  expect(container.querySelector(".map-svg-root").getAttribute("aria-label")).toContain(
    `${YEAR_MAX}.`,
  );
  release();
  await waitFor(() =>
    expect(legendText(container)).toContain(`Colors split ${YEAR_MAX - 1}’s`),
  );
});

test("custom weights rename the score, and the pill names the index", async () => {
  window.history.replaceState(null, "", "/map?iso=CHE");
  const { container } = render(<WorldMap />);
  await screen.findByRole("heading", { name: "Switzerland", level: 2 });
  const pill = () => container.querySelector(".map-detail-panel .map-detail-pill");
  expect(pill().textContent).toMatch(/^Tomer index \d+\.\d\d$/);
  fireEvent.change(screen.getByRole("slider", { name: /^Health/ }), {
    target: { value: "80" },
  });
  expect(pill().textContent).toMatch(/^Custom index \d+\.\d\d$/);
  expect(legendText(container)).toContain("Colors split 2025’s Custom index scores");
  expect(legendText(container)).toContain(
    "the published Tomer index uses health 40%, safety 30%, freedom 20%, abundance 10%.",
  );
  fireEvent.pointerMove(
    container.querySelector('path.map-country[data-iso="JPN"]'),
  );
  expect(container.querySelector(".map-tooltip").textContent).toMatch(
    /^JapanCustom index: \d+\.\d\d/,
  );
});

test("tiny countries get a clickable dot and unscored land is drawn as no data", async () => {
  window.history.replaceState(null, "", "/map");
  const { container } = render(<WorldMap />);
  await waitFor(() =>
    expect(container.querySelector('.map-dot[data-iso="MLT"]')).toBeTruthy(),
  );
  for (const iso of ["MLT", "SGP", "BHR"]) {
    const dot = container.querySelector(`.map-dot[data-iso="${iso}"]`);
    expect(dot.getAttribute("stroke")).toMatch(/^#/);
  }
  // Landlocked Luxembourg gets no dot: it would sit on Belgium, Germany and France.
  expect(container.querySelector('path.map-country[data-iso="LUX"]')).toBeTruthy();
  expect(container.querySelector('.map-dot[data-iso="LUX"]')).toBeNull();
  // Dots are drawn under every country, so a dot never takes a neighbour's clicks,
  // and only the dot itself (not its halo) names a country.
  const firstCountry = container.querySelector("path.map-country");
  for (const dot of container.querySelectorAll(".map-dot, .map-dot-halo"))
    expect(
      dot.compareDocumentPosition(firstCountry) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  for (const halo of container.querySelectorAll(".map-dot-halo"))
    expect(halo.hasAttribute("data-iso")).toBe(false);
  const kosovo = container.querySelector('path.map-country[data-iso="XKX"]');
  expect(kosovo.getAttribute("class")).toContain("is-no-data");
  expect(kosovo.getAttribute("fill")).toBe("url(#map-no-data)");
  fireEvent.click(container.querySelector('.map-dot[data-iso="MLT"]'));
  expect(
    await screen.findByRole("heading", { name: "Malta", level: 2 }),
  ).toBeTruthy();
  expect(screen.getByText("Malta selected.", { exact: false })).toBeTruthy();
});

test("a tap picks what is under the finger, not the browser's adjusted target", async () => {
  window.history.replaceState(null, "", "/map");
  const { container } = render(<WorldMap />);
  await waitFor(() =>
    expect(container.querySelector('.map-dot[data-iso="SGP"]')).toBeTruthy(),
  );
  const shape = (code) => container.querySelector(`path.map-country[data-iso="${code}"]`);
  const iso = () => new URLSearchParams(window.location.search).get("iso");
  // jsdom has no layout: put Singapore's dot at (100, 100) and every other dot far away.
  for (const dot of container.querySelectorAll(".map-dot"))
    dot.getBoundingClientRect = () =>
      dot.getAttribute("data-iso") === "SGP"
        ? { x: 100, y: 100, width: 0, height: 0 }
        : { x: 500, y: 500, width: 0, height: 0 };
  let underFinger;
  const original = document.elementFromPoint;
  document.elementFromPoint = () => underFinger;
  // Browsers report the adjusted target (here Malaysia) for the whole tap.
  const tap = (target, [x, y], end = [x, y]) => {
    const touch = { pointerType: "touch", isPrimary: true, pointerId: 7 };
    fireEvent.pointerDown(target, { ...touch, clientX: x, clientY: y });
    fireEvent.pointerUp(target, { ...touch, clientX: end[0], clientY: end[1] });
    if (end[0] === x && end[1] === y) fireEvent.click(target, { clientX: x, clientY: y });
  };
  try {
    // Sea, 6px from Singapore's dot.
    underFinger = container.querySelector(".map-ocean");
    tap(shape("MYS"), [106, 100]);
    expect(iso()).toBe("SGP");
    // Land under the finger wins.
    underFinger = shape("FRA");
    tap(shape("GBR"), [300, 300]);
    expect(iso()).toBe("FRA");
    // Open sea, far from any dot, clears the selection, as a click there does.
    underFinger = container.querySelector(".map-ocean");
    tap(shape("BRA"), [250, 250]);
    expect(iso()).toBeNull();
    // A finger that moves is panning or scrolling, not picking.
    underFinger = shape("JPN");
    tap(shape("JPN"), [300, 300], [340, 300]);
    expect(iso()).toBeNull();
  } finally {
    document.elementFromPoint = original;
  }
  // Mouse clicks still go to the clicked shape.
  fireEvent.pointerDown(shape("JPN"), { pointerType: "mouse", isPrimary: true });
  fireEvent.click(shape("JPN"));
  expect(iso()).toBe("JPN");
});

test("the prerendered preview is the map's own loading state, inert, and loads nothing", async () => {
  // The prerender can't see the URL, so the preview ignores it.
  window.history.replaceState(null, "", "/map?year=2005&iso=JPN");
  for (const load of [loadLeaderboardData, loadWorldData, loadYearSnapshot]) load.mockClear();
  const { container } = render(<WorldMapPreview description="About the map." />);
  await act(() => Promise.resolve());
  expect(container.querySelector(".map-page").hasAttribute("inert")).toBe(true);
  expect(container.querySelector(".year-output").textContent).toBe(String(YEAR_MAX));
  expect(container.querySelector(".map-detail-empty")).toBeTruthy();
  expect(legendText(container)).toContain("Loading scores…");
  // An empty bar holds the scale's place, so the legend keeps its size; no ticks are made up.
  const bar = container.querySelector(".map-legend-scale .map-legend-bar");
  expect(bar.children).toHaveLength(0);
  expect(bar.getAttribute("aria-hidden")).toBe("true");
  expect(container.querySelector(".map-legend-ticks")).toBeNull();
  for (const load of [loadLeaderboardData, loadWorldData, loadYearSnapshot])
    expect(load).not.toHaveBeenCalled();
});
