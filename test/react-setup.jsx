import React, { useSyncExternalStore } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Emulate Next's documented native-history subscription in the DOM test host.
vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(
      useSyncExternalStore(
        (notify) => {
          window.addEventListener("popstate", notify);
          return () => window.removeEventListener("popstate", notify);
        },
        () => window.location.search,
      ),
    ),
  usePathname: () => window.location.pathname,
  useRouter: () => ({
    push: (url) => {
      window.history.pushState(null, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
  }),
}));
vi.mock("next/link", () => ({
  default: ({ children, prefetch, ...props }) => <a {...props}>{children}</a>,
}));

const replaceState = window.history.replaceState.bind(window.history);
beforeEach(() => {
  replaceState(null, "", "/");
  vi.spyOn(window.history, "replaceState").mockImplementation((...args) => {
    replaceState(...args);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
