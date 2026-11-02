import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Navigation from "../src/components/navigation";
import SiteFooter from "../src/components/site-footer";
import NotFound from "../src/app/not-found";
import ErrorPage from "../src/app/error";
import { REPO_URL } from "../src/site.js";

const leaderboard = JSON.parse(
  readFileSync(resolve("public/data/leaderboard.json")),
);

test("navigation has a home brand link and marks only the current page", () => {
  window.history.replaceState(null, "", "/map");
  render(<Navigation />);
  expect(
    screen.getByRole("link", { name: "Tomer index" }).getAttribute("href"),
  ).toBe("/");
  const nav = screen.getByRole("navigation", { name: "Main" });
  const current = within(nav)
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page");
  expect(current.map((link) => link.textContent)).toEqual(["Map"]);
});

test("footer credits the sources, the data date, and the repo", () => {
  render(<SiteFooter />);
  const footer = screen.getByRole("contentinfo");
  for (const name of [
    "World Bank Open Data",
    "WHO Global Health Observatory",
    "Uppsala Conflict Data Program",
    "Cato Human Freedom Index",
    "Methodology",
    "Downloads",
  ])
    expect(within(footer).getByRole("link", { name })).toBeTruthy();
  expect(
    within(footer)
      .getByRole("link", { name: "Source on GitHub" })
      .getAttribute("href"),
  ).toBe(REPO_URL);
  expect(footer.querySelector("time").getAttribute("dateTime")).toBe(
    leaderboard.generatedAt,
  );
  expect(footer.textContent).toContain("not endorsed by UNDP");
});

test("404 page keeps its heading inside main and links back into the site", () => {
  render(<NotFound />);
  const main = screen.getByRole("main");
  expect(main.id).toBe("main");
  expect(
    within(main).getByRole("heading", { level: 1, name: "Page not found" }),
  ).toBeTruthy();
  for (const name of [
    "Leaderboard",
    "World map",
    "Compare countries",
    "Methodology",
  ])
    expect(within(main).getByRole("link", { name })).toBeTruthy();
});

test("error page retries the segment", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const retry = vi.fn();
  render(<ErrorPage error={new Error("boom")} retry={retry} />);
  const main = screen.getByRole("main");
  expect(within(main).getByRole("heading", { level: 1 }).textContent).toBe(
    "Something went wrong",
  );
  expect(main.textContent).not.toContain("boom");
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledOnce();
});
