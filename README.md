# Tomer index

![Data coverage](https://img.shields.io/badge/data-2000--2025-0f766e)
![Scoring](https://img.shields.io/badge/scoring-absolute-2563eb)
![Next.js](https://img.shields.io/badge/Next.js-16.3.4-black?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19.2.8-149eca?logo=react)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.3.3-06b6d4?logo=tailwindcss)

**Live site: [tomer-index.netlify.app](https://tomer-index.netlify.app/)**

An interactive country index built around four dimensions of a good society:
**health, safety, freedom, and abundance**.

The project turns public data into a transparent, reproducible score for countries,
the World, World Bank regions, income groups, and lending groups from **2000 through 2025**.
Explore the results as a sortable leaderboard, a choropleth map, country histories,
or side-by-side comparisons.

> **Scores are absolute, not relative.** A country's score is calculated against
> fixed goalposts and never changes merely because another country improves or
> declines.

## What you can explore

- Rank and filter countries by year, region, income level, row type, or data quality.
- Use 20 detailed geographic region filters alongside the seven broad World Bank groups.
  Membership follows [UN M49](https://unstats.un.org/unsd/methodology/m49/), including
  its intermediate regions. These filters select countries; the regional group rows
  keep their World Bank definitions. Multiple region selections are combined.
- Compare several countries across the full index, individual pillars, and raw inputs.
- Experiment with custom pillar weights on either the leaderboard or world map; the
  result is labeled "Custom index".
- Explore the Equal Earth map in fullscreen, zoom up to 8×, and pan by dragging.
  Use scroll or pinch to zoom, or focus the map and use +/−, arrow keys, and Home.
- Open a country or group page to inspect its score and input history from 2000–2025.
- See source-year badges, estimated HALE labels, and history-gap warnings.
- Download every dataset, with a field guide, from `/downloads`.

## How the score works

```text
Raw observations → fixed goalpost normalization → weighted geometric mean
```

| Pillar | Weight | Input | Fixed normalization |
| --- | ---: | --- | --- |
| **Health** | 40% | Life expectancy + healthy life expectancy (HALE) | Mean of two life-expectancy indices, each scoring 0 at 20 years and 1 at 85, with no cap above 85 |
| **Safety** | 30% | Homicides per 100k (intentional homicides per 100,000 people) | Linear inversion from 0 (best) to 60 (floor) |
| **Freedom** | 20% | Personal freedom: HFI Personal Freedom categories, excluding Security and Safety | Rescaled from 0–100 to 0–1 |
| **Abundance** | 10% | Income per person (PPP $): GNI per capita, extended by GDP per capita growth where GNI isn't published | Log scale scoring 0 at $100 and 1 at $75,000, with no cap above $75,000 |

```text
LEI(years) = (max(years, 20) − 20) / (85 − 20)
Health    = ½·LEI(life expectancy) + ½·LEI(HALE)
Safety    = (60 − clamp(homicides per 100k, 0, 60)) / 60
Freedom   = personal freedom score / 100
Abundance = ln(max(income, 100) / 100) / ln(75000 / 100)

Tomer = Health^0.40 · Safety^0.30 · Freedom^0.20 · Abundance^0.10
```

The geometric mean penalizes imbalance: strength in one dimension cannot fully
compensate for a near-zero result in another, and a pillar at its worst goalpost
(for example, 60 or more homicides per 100k) sets the index to 0. The site shows
scores ×100; the data files store them unscaled.

There is no ceiling at 100. A score of 100 means every goalpost is met. Safety and
freedom stop there (no homicides, a perfect freedom score), but health keeps rising
past 85 years and abundance past $75,000, so a country that lives longer or earns
more scores above 100. Read the complete assumptions,
data-freshness caveats, and rationale in
[the methodology](https://tomer-index.netlify.app/methodology)
([source](./src/app/methodology/page.jsx)).

## Data and coverage

The tracker uses observations from **2000–2025** and stores the actual source year
beside every metric. For a displayed year, the pipeline uses the latest observation
available on or before that year; it never pulls future observations backward.
Sources lag, so recent years lean on older observations: in the 2025 view, life
expectancy is from 2024, freedom scores from 2023, and HALE is estimated from WHO's
2021 values.

Primary sources:

- [World Bank Open Data](https://data.worldbank.org/) — life expectancy, GNI and GDP
  per capita (constant 2021 PPP), intentional homicides, population, and country metadata.
- [WHO Global Health Observatory](https://www.who.int/data/gho) — healthy life
  expectancy at birth (`WHOSIS_000002`).
- [Human Freedom Index 2025](https://www.cato.org/human-freedom-index/2025) — rule of
  law, movement, religion, association, expression, and relationships.

When annual WHO HALE is unavailable, the tracker preserves the latest reported
`life expectancy − HALE` gap, keeping its sign, and applies it to that year's life
expectancy. When a year has no published GNI, the latest GNI is moved by the change in
GDP per capita since then; GDP itself is used only before a country's GNI series
starts. Estimated values are labeled in the interface.

Group rows (World, regions, income groups, and lending groups) are computed by
`scripts/build-data.mjs` rather than imported as published series. For each year,
every member country with all five inputs and a population figure contributes; each
raw input is averaged with population weights, and the averages are then scored with
the same goalposts and formula as a country. Membership uses each country's current
World Bank classification, grows as coverage improves, and excludes the World Bank's
"Not classified" lending and income categories as groups of their own.

## Pages

| Page | Purpose |
| --- | --- |
| `/` | Sortable leaderboard, filters, year slider, and adjustable pillar weights |
| `/compare` | Side-by-side comparisons with shareable `?picks=USA,JPN,...` links |
| `/map` | Interactive choropleth with adjustable pillar weights |
| `/entry/<ISO>` | History of the index, pillars, and raw inputs for one country or group, e.g. `/entry/JPN`; old `/entry?iso=JPN` links redirect |
| `/methodology` | Formulas, goalposts, sources, data freshness, and limitations |
| `/downloads` | Download every dataset individually or as one complete JSON bundle |

Pages fetch only what they draw: `leaderboard.json` for the current year, a small
per-year file for past years, one per-country file for each history, and the map
boundaries for `/map`. None of them downloads the full 1.5 MB `series.json`, which
remains available on `/downloads`.

## Run locally

```bash
git clone https://github.com/Tomer2006/tomer-index.git
cd tomer-index
npm ci
npm run dev
```

Requires **Node.js 22.22.2+, 24.15+, or 26+** (including the test tools).
Open [http://localhost:5173](http://localhost:5173).
The App Router prerenders each route, including one static page per country and
group. Prebuilt JSON is committed under `public/data`, so normal development and
production builds do not depend on live APIs. `npm run dev` and `npm run build` first
run `npm run split-data`, which derives the per-year and per-country files in
`public/app-data` (gitignored).
`npm start` and `npm run preview` serve a production build locally.

Old `.html` URLs redirect to the corresponding routes and retain query parameters.
Shared React components manage filters, weights, charts, and map selection.
Tailwind CSS v4 is configured through PostCSS and `src/app/globals.css`; design
tokens and specialized table, map, and chart styling live in `src/style.css`.

### Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js development server on port 5173 |
| `npm test` | Run scoring, historical-data, and React interaction tests |
| `npm run build` | Create the Next.js production build in `.next/` |
| `npm start` | Serve the production build on port 3000 |
| `npm run preview` | Serve the production build on port 4173 |
| `npm run build-data` | Refresh World Bank, WHO, and HFI data (requires network access), then run `build-world` and `split-data` |
| `npm run split-data` | Derive `public/app-data` (per-year and per-country files) from `public/data`; runs automatically before `dev` and `build` |
| `npm run build-world` | Rebuild the ISO3-keyed world GeoJSON used by the map |

## Deployment

The live site is hosted on [Netlify](https://www.netlify.com/) at
[tomer-index.netlify.app](https://tomer-index.netlify.app/). `netlify.toml` runs
`npm run build` (which runs `split-data` first) and publishes `.next` through the
[`@netlify/plugin-nextjs`](https://www.npmjs.com/package/@netlify/plugin-nextjs) runtime.
Because the data is committed under `public/data`, builds make no network calls.
The derived `public/app-data` files carry a content hash in their URLs and are served
with immutable cache headers. Netlify's Node.js version must satisfy `engines` in
`package.json`; set it with a `NODE_VERSION` environment variable if needed.

## Project structure

```text
├── next.config.mjs           # Redirects, cache headers, and content-based data version
├── netlify.toml              # Netlify build and Next.js runtime plugin
├── postcss.config.mjs        # Tailwind CSS v4 integration
├── src/
│   ├── app/                  # Next.js routes, metadata, layout, Tailwind entrypoint
│   ├── components/           # React views, controls, SVG charts, data hooks
│   ├── hdi-core.js           # Goalposts, pillar math, index math, data merging
│   ├── index-weights.js      # Default and custom pillar weights
│   ├── view-model.js         # URL state, historical snapshots, ranks, sorting
│   ├── metric-defs.js        # Metric labels and formats for charts
│   ├── data-loader.js        # Fetches the derived files in public/app-data
│   ├── data-split.js         # Per-year snapshots shared by split-data and tests
│   ├── site.js               # Site name, URL, and repository link
│   ├── site-years.js         # YEAR_MIN and YEAR_MAX for the UI and data pipeline
│   └── style.css             # Design tokens and specialized component styles
├── scripts/
│   ├── build-data.mjs        # Source ingestion and score pipeline
│   ├── split-data.mjs        # Derives public/app-data from public/data
│   └── build-world.mjs       # TopoJSON → GeoJSON conversion
├── public/data/              # Committed datasets (also the /downloads files)
├── public/app-data/          # Derived per-year and per-country files (gitignored)
└── test/                     # Node scoring tests and React interaction tests
```

## Rebuilding the data

`npm run build-data` fetches all source observations, applies the documented
back-fill and HALE-estimation rules, calculates the absolute pillar and final scores,
and writes:

- `public/data/leaderboard.json` — the latest year's rows for every country and group,
  data-quality flags, and a population-weighted series for a fixed set of countries
  scored in every year (not charted on the site).
- `public/data/series.json` — yearly histories for every country and group.
- `data-archive/countries.json` — a readable full payload for local inspection
  (gitignored and not shipped).

Before writing, the pipeline compares its output with the committed files and refuses
to write if country or metric coverage drops sharply (a sign of a failed download);
run `npm run build-data -- --force` to write anyway. The Human Freedom Index download
is usually blocked by a bot check, in which case the committed freedom data is reused
and a warning is printed; to refresh it, download the HFI file in a browser and run
`HFI_FILE=<path> npm run build-data`. Likewise, if the WHO GHO API fails (it answered
every request with HTTP 500 from late October 2026), the committed WHO HALE
observations are reused with a warning, and the next run that reaches WHO refreshes them.

It then runs `build-world` and `split-data` to refresh the map shapes and `public/app-data`. The year window is set by
`YEAR_MIN` and `YEAR_MAX` in `src/site-years.js`; update the coverage badge above when
it changes.

## Limitations

- Recent years lean on older observations, and HALE after WHO's latest release is
  estimated from life expectancy; the interface shows every source year and labels
  estimates.
- Safety is intentionally homicide-only; it does not capture every dimension of crime
  or personal security.
- Freedom is a custom combination of HFI categories, not the published HFI headline
  Personal Freedom score.
- Before a country's GNI series starts, income is plain GDP per capita, so a break can
  remain in the year its GNI starts.
- Group averages change membership over time as more countries have complete data.
- This is a personal composite and is not endorsed by UNDP, the World Bank, WHO,
  Cato Institute, or Fraser Institute.
