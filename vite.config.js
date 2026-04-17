import { defineConfig } from "vite";

/** Browser → World Bank is often blocked (CORS). Proxy through Vite so fetch is same-origin. */
const worldBankProxy = {
  "/worldbank": {
    target: "https://api.worldbank.org",
    changeOrigin: true,
    secure: true,
    /** Huge pages (e.g. 10k rows) often hit upstream/proxy timeouts → 502 */
    timeout: 120_000,
    proxyTimeout: 120_000,
    rewrite: (path) => path.replace(/^\/worldbank/, ""),
  },
};

export default defineConfig({
  server: {
    port: 5173,
    proxy: worldBankProxy,
  },
  preview: {
    port: 4173,
    proxy: worldBankProxy,
  },
});
