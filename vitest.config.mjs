import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    pool: "threads",
    environment: "jsdom",
    // Page tests render full views (the map draws ~180 shapes per keystroke) and run
    // in parallel; the 5s default is too tight under full-suite load.
    testTimeout: 15000,
    include: ["test/**/*.test.jsx"],
    setupFiles: ["./test/react-setup.jsx"],
  },
});
