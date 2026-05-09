import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { statSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function dataVersion() {
  try {
    const mtime = statSync(resolve(__dirname, "public/data/countries.json")).mtimeMs;
    return JSON.stringify(String(Math.round(mtime)));
  } catch {
    return JSON.stringify(String(Date.now()));
  }
}

export default defineConfig({
  define: {
    __DATA_VERSION__: dataVersion(),
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        compare: resolve(__dirname, "compare.html"),
        entry: resolve(__dirname, "entry.html"),
        methodology: resolve(__dirname, "methodology.html"),
        map: resolve(__dirname, "map.html"),
      },
    },
  },
});
