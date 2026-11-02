import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HistoryChart, {
  SERIES_COLORS,
  niceTicks,
  yearTicks,
} from "../src/components/history-chart";
import {
  DataStatus,
  PillarBars,
  QualityBadge,
  SourceBadge,
  Weights,
  YearControl,
} from "../src/components/shared";
import { metricDefs } from "../src/metric-defs.js";
import { TOPIC_COLORS } from "../src/topic-colors.js";
import { YEAR_MAX, YEAR_MIN } from "../src/site-years.js";

const { entrySeries } = JSON.parse(
  readFileSync(resolve("public/data/series.json")),
);
const metric = (key) => metricDefs.find((item) => item.key === key);
const japan = { iso: "JPN", name: "Japan", points: entrySeries.JPN.points };
const usa = { iso: "USA", name: "United States", points: entrySeries.USA.points };

test("y ticks use 1/2/2.5/5 steps, never repeat, and never go below zero", () => {
  expect(niceTicks(71.1, 73.9)).toEqual({ ticks: [71, 72, 73, 74], step: 1 });
  expect(niceTicks(0.659, 0.96, { max: 1 }).ticks).toEqual([0.6, 0.7, 0.8, 0.9, 1]);
  expect(niceTicks(0.2, 33.6).ticks).toEqual([0, 10, 20, 30, 40]);
  expect(niceTicks(10, 19).step).toBe(2.5);
  expect(niceTicks(88, 99.9, { max: 100 }).ticks.at(-1)).toBe(100);
  expect(niceTicks(5, 5).ticks.length).toBeGreaterThan(1);
  for (const item of metricDefs) {
    for (const entry of Object.values(entrySeries)) {
      const values = entry.points
        .map((point) => point[item.key])
        .filter(Number.isFinite);
      if (!values.length) continue;
      const { ticks, step } = niceTicks(Math.min(...values), Math.max(...values), {
        max: item.max,
      });
      const labels = ticks.map((value) => item.axis(value, step));
      expect(new Set(labels).size).toBe(labels.length);
      expect(ticks[0]).toBeGreaterThanOrEqual(0);
      expect(ticks[0]).toBeLessThanOrEqual(Math.min(...values));
      expect(ticks.at(-1)).toBeGreaterThanOrEqual(Math.max(...values));
    }
  }
  expect(yearTicks(340)).toEqual([2000, 2005, 2010, 2015, 2020, 2025]);
  expect(yearTicks(150)).toEqual([2000, 2010, 2020]);
});

test("series colors are distinct from the topic colors and the Tomer purple", () => {
  expect(SERIES_COLORS).toHaveLength(8);
  expect(new Set(SERIES_COLORS).size).toBe(8);
  for (const reserved of [...Object.values(TOPIC_COLORS), metric("customIndex").color])
    expect(SERIES_COLORS).not.toContain(reserved);
});

test("a chart has one quiet live region, a text summary, and keyboard inspection", () => {
  const { container } = render(
    <HistoryChart series={[japan]} metric={metric("le")} showMarkers={false} />,
  );
  const svg = screen.getByRole("img");
  const summary = document.getElementById(svg.getAttribute("aria-describedby"));
  const first = japan.points[0];
  expect(summary.textContent).toContain(
    `Japan: ${metric("le").value(first.le)} in ${first.year}`,
  );
  expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
  const live = container.querySelector("[aria-live]");
  expect(live.textContent).toBe("");
  fireEvent.pointerMove(svg, { pointerType: "mouse", clientX: 100 });
  expect(live.textContent).toBe("");
  expect(within(container).getByText("2005", { selector: "strong" }));
  fireEvent.pointerLeave(svg, { pointerType: "mouse" });
  fireEvent.keyDown(svg, { key: "ArrowLeft" });
  const point = japan.points.find((item) => item.year === YEAR_MAX - 1);
  expect(within(container).getByText(String(YEAR_MAX - 1), { selector: "strong" }));
  expect(live.textContent).toBe(`${YEAR_MAX - 1}: ${metric("le").value(point.le)}`);
  fireEvent.keyDown(svg, { key: "Home" });
  expect(within(container).getByText(String(YEAR_MIN), { selector: "strong" }));
  fireEvent.blur(svg);
  expect(live.textContent).toBe("");
  expect(container.querySelector(".compare-series-legend")).toBeNull();
});

test("a horizontal drag inspects, a tap or click changes the page year, and a scroll leaves no reading", () => {
  const onYearChange = vi.fn();
  const { container } = render(
    <HistoryChart series={[japan, usa]} metric={metric("customIndex")} year={2010} onYearChange={onYearChange} />,
  );
  const svg = screen.getByRole("img");
  const live = container.querySelector("[aria-live]");
  const shownYear = () => container.querySelector(".metric-chart-readout strong").textContent;
  const touch = { pointerType: "touch", clientY: 100 };
  // jsdom has no layout, so clientX maps straight onto the 400px default width.
  fireEvent.pointerDown(svg, { ...touch, clientX: 300 });
  fireEvent.pointerMove(svg, { ...touch, clientX: 0, buttons: 1 });
  expect(shownYear()).toBe(String(YEAR_MIN));
  expect(live.textContent).toMatch(new RegExp(`^${YEAR_MIN}: Japan .+, United States `));
  fireEvent.pointerUp(svg, { ...touch, clientX: 0 });
  fireEvent.click(svg, { clientX: 0 });
  expect(onYearChange).not.toHaveBeenCalled();
  expect(shownYear()).toBe(String(YEAR_MIN));
  // A press that turns into a vertical page scroll shows nothing and clears the
  // reading when the browser takes the gesture over.
  fireEvent.pointerDown(svg, { ...touch, clientX: 200 });
  fireEvent.pointerMove(svg, { ...touch, clientX: 203, clientY: 140, buttons: 1 });
  fireEvent.pointerCancel(svg, { pointerType: "touch" });
  expect(shownYear()).toBe("2010");
  expect(live.textContent).toBe("");
  fireEvent.pointerDown(svg, { ...touch, clientX: 0 });
  fireEvent.pointerUp(svg, { ...touch, clientX: 2 });
  fireEvent.click(svg, { clientX: 2 });
  expect(onYearChange).toHaveBeenCalledTimes(1);
  expect(onYearChange).toHaveBeenLastCalledWith(YEAR_MIN);
  fireEvent.pointerDown(svg, { pointerType: "mouse", clientX: 0 });
  fireEvent.click(svg, { clientX: 0 });
  expect(onYearChange).toHaveBeenCalledTimes(2);
  const legend = container.querySelector(".compare-series-legend");
  expect(legend.textContent).toBe("JapanUnited States");
  expect(container.querySelectorAll(".metric-chart-readout li")).toHaveLength(2);
});

test("without a page year to change, a tap reads that year aloud", () => {
  const { container } = render(<HistoryChart series={[japan]} metric={metric("le")} />);
  const svg = screen.getByRole("img");
  fireEvent.pointerDown(svg, { pointerType: "touch", clientX: 0, clientY: 50 });
  fireEvent.pointerUp(svg, { pointerType: "touch", clientX: 0, clientY: 50 });
  const first = japan.points.find((point) => point.year === YEAR_MIN);
  expect(within(container).getByText(String(YEAR_MIN), { selector: "strong" }));
  expect(container.querySelector("[aria-live]").textContent).toBe(
    `${YEAR_MIN}: ${metric("le").value(first.le)}`,
  );
});

test("compact source badges stay out of the Tab order but keep their description", () => {
  const row = { leYear: 2024, haleYear: 2021, haleEstimated: true };
  const { container } = render(
    <>
      <SourceBadge row={row} sources={["haleYear"]} year={2025} compact />
      <SourceBadge row={row} sources={["leYear", "haleYear"]} year={2025} />
      <QualityBadge quality={{ label: "History gaps", description: "Some years are missing." }} />
    </>,
  );
  const [compact, full] = container.querySelectorAll(".source-year-badge");
  expect(compact.hasAttribute("tabindex")).toBe(false);
  expect(compact.hasAttribute("aria-label")).toBe(false);
  expect(compact.querySelector("[aria-hidden]").textContent).toBe("est. 2021");
  expect(compact.querySelector(".visually-hidden").textContent).toMatch(
    /^Source year: HALE est\. from 2021\. HALE for 2025 estimated/,
  );
  expect(full.getAttribute("tabindex")).toBe("0");
  expect(full.textContent).toContain("Life exp. 2024, HALE est. from 2021");
  const description = document.getElementById(full.getAttribute("aria-describedby"));
  expect(description.textContent).toBe(full.dataset.tip);
  const quality = container.querySelector(".data-quality-badge");
  expect(quality.getAttribute("tabindex")).toBe("0");
  expect(
    document.getElementById(quality.getAttribute("aria-describedby")).textContent,
  ).toBe("Some years are missing.");
  quality.focus();
  fireEvent.keyDown(quality, { key: "Escape" });
});

test("weight sliders are named by pillar and speak the effective percentage", () => {
  const onChange = vi.fn();
  render(
    <Weights
      label="Tomer index"
      weights={{ health: 40, safety: 30, freedom: 20, abundance: 50 }}
      onChange={onChange}
    />,
  );
  const sliders = screen.getAllByRole("slider");
  expect(sliders.map((slider) => slider.getAttribute("aria-valuetext"))).toEqual([
    "28.6 percent",
    "21.4 percent",
    "14.3 percent",
    "35.7 percent",
  ]);
  expect(screen.getByRole("slider", { name: "Health" })).toBe(sliders[0]);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByText("Weights are rescaled to total 100%.")).toBeTruthy();
});

test("year control shows its range and pillar bars read in weight order", () => {
  render(
    <>
      <YearControl year={2010} onChange={() => {}} />
      <PillarBars
        row={{ healthIndex: 0.9, safetyIndex: 0.5, freedomIndex: 0.25, abundanceIndex: 1.067 }}
      />
    </>,
  );
  expect(screen.getByRole("slider", { name: "Year" }).value).toBe("2010");
  expect(screen.getByText(String(YEAR_MIN))).toBeTruthy();
  expect(screen.getByText(String(YEAR_MAX))).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  const bars = [...document.querySelectorAll(".pillar-bar")].map(
    (bar) => bar.textContent,
  );
  expect(bars).toEqual(["Health90", "Safety50", "Freedom25", "Abundance107"]);
  // A pillar past its goalpost fills its bar without overflowing it.
  const widths = [...document.querySelectorAll(".pillar-bar-fill")].map(
    (fill) => fill.style.width,
  );
  expect(widths).toEqual(["90%", "50%", "25%", "100%"]);
});

test("a load error shows visitor copy and Retry reloads every failed dataset", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const first = { error: "Missing public/app-data/leaderboard.json (503)", retry: vi.fn() },
    second = { error: "Failed to fetch", retry: vi.fn() };
  render(<DataStatus datasets={[first, { data: {} }, second]} />);
  expect(screen.getByRole("alert").textContent).toBe(
    "Couldn't load the data. Check your connection and try again. Retry",
  );
  expect(logged.mock.calls.map(String).join("\n")).toContain("(503)");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(first.retry).toHaveBeenCalledTimes(1);
  expect(second.retry).toHaveBeenCalledTimes(1);
});
