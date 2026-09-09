import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    pool: "threads",
    environment: "jsdom",
    include: ["test/**/*.test.jsx"],
    setupFiles: ["./test/react-setup.jsx"],
  },
});
