# Tomer index

A static site that ranks every country (plus World Bank regions, income
groups, and other aggregates) on four pillars: **abundance**, **safety**,
**health**, and **freedom** for the years **2000–2024**.

```
Health = ½·LEI(life expectancy) + ½·LEI(HALE)        LEI goalposts: 20–85 years
Abundance = log-scaled GNI per capita (PPP), with GDP PPP fallback, $100–$75,000 goalposts
Safety = (60 − homicides per 100k) / 60, clamped
Freedom score = 10 × mean of HFI Personal Freedom categories except Security & Safety (0–100)

Tomer  = Health^0.40 · Safety^0.30 · Freedom^0.20 · Abundance^0.10
```

Each base pillar is converted to its yearly mid-rank country percentile before
the weighted geometric mean, giving every pillar the same empirical distribution.

When WHO HALE is unavailable for a year, HALE is estimated from that year's
life expectancy while preserving the latest reported `life expectancy - HALE`
gap. Estimated values are labeled in the UI.

See [methodology.html](methodology.html) for the full write-up and rationale.

## Pages

| Page | Purpose |
| --- | --- |
| `index.html` | Leaderboard with year slider, search, region/income/type filters, and a population-weighted fixed-cohort trend line |
| `compare.html` | Side-by-side comparison (`?picks=USA,JPN,...` deep links), pillar bars, per-metric charts |
| `map.html` | Choropleth world map with year slider, country search, and detail panel |
| `entry.html` | Per-entry history charts (`?iso=XXX`) |
| `methodology.html` | Formulas, goalposts, weights, sources, limitations |

## Development

```sh
npm install
npm run dev        # vite dev server on :5173
npm test           # node:test unit tests for the index math (src/hdi-core.js)
npm run build      # production build to dist/
```

## Data pipeline

The site is fully static; all data is prebuilt JSON in `public/data/` and
committed so builds work offline.

- `npm run build-data` — fetches live APIs (World Bank indicators
  `SP.DYN.LE00.IN`, `NY.GNP.PCAP.PP.KD`, `NY.GDP.PCAP.PP.KD` (GNI fallback
  only), `VC.IHR.PSRC.P5`, `SP.POP.TOTL`,
  country metadata, plus WHO GHO `WHOSIS_000002` for HALE) and writes:
  - `public/data/leaderboard.json` — latest rows, world series, quality flags (minified)
  - `public/data/series.json` — per-entry yearly history 2000–2024 (minified; the
    leaderboard lazy-loads this only when the year slider leaves the latest year)
  - `data-archive/countries.json` — full pretty-printed payload for inspection
    (gitignored, not shipped)
- `npm run build-world` — converts `world-atlas` countries-110m TopoJSON into
  `public/data/world.geojson` keyed by ISO3 for the map page.

Both scripts need network access; rerun them only when refreshing data.

## Source layout

- `src/hdi-core.js` — pure index math + World Bank/WHO row parsing (shared with the build script; unit-tested)
- `src/main.js`, `src/compare.js`, `src/map.js`, `src/entry.js` — one module per page
- `src/line-chart.js` — shared SVG line-chart primitives (frame, scales, hover, tooltips)
- `src/metric-defs.js` — shared metric definitions/formatters
- `src/data-loader.js`, `src/site-years.js`, `src/index-scale.js`, `src/source-years.js`, `src/data-quality.js`, `src/format.js` — data fetch, year window, 0–1/0–10/0–100 display scale, source-year and data-quality badges, misc formatting
