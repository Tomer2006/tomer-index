# Tomer index

![Data coverage](https://img.shields.io/badge/data-2000--2025-0f766e)
![Scoring](https://img.shields.io/badge/scoring-absolute-2563eb)
![Next.js](https://img.shields.io/badge/Next.js-16.3.4-black?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19.2.8-149eca?logo=react)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.3.3-06b6d4?logo=tailwindcss)

An interactive country index built around four dimensions of a good society:
**abundance, safety, health, and freedom**.

The project turns public data into a transparent, reproducible score for countries,
World Bank regions, income groups, and other aggregates from **2000 through 2025**.
Explore the results as a sortable leaderboard, a choropleth map, country histories,
or side-by-side comparisons.

> **Scores are absolute, not relative.** A country's score is calculated against
> fixed goalposts and never changes merely because another country improves or
> declines.

## What you can explore

- Rank and filter countries by year, region, income level, entry type, or data quality.
- Use 20 detailed geographic region filters alongside the seven broad World Bank groups.
  Membership follows [UN M49](https://unstats.un.org/unsd/methodology/m49/), including
  its intermediate regions. These filters select countries; existing regional aggregate
  scores retain their World Bank definitions. Multiple region selections are combined.
- Compare several countries across the full index, individual pillars, and raw inputs.
- Experiment with custom pillar weights on either the leaderboard or world map.
- Open a country page to inspect its score and input history from 2000–2025.
- See source-year badges, estimated HALE labels, and incomplete-data warnings.
- Follow a population-weighted fixed cohort for a comparable long-run trend.

## How the score works

```text
Raw observations → fixed goalpost normalization → weighted geometric mean
```

| Pillar | Weight | Input | Fixed normalization |
| --- | ---: | --- | --- |
| **Health** | 40% | Life expectancy + healthy life expectancy (HALE) | Mean of two life-expectancy indices, each using 20–85 year goalposts |
| **Safety** | 30% | Intentional homicides per 100,000 | Linear inversion from 0 (best) to 60 (floor) |
| **Freedom** | 20% | HFI Personal Freedom categories, excluding Security and Safety | Rescaled from 0–100 to 0–1 |
| **Abundance** | 10% | GNI per capita (PPP), with GDP fallback | Log-scaled between $100 and $75,000 |

```text
Health    = ½·LEI(life expectancy) + ½·LEI(HALE)
Safety    = (60 − clamp(homicides per 100k, 0, 60)) / 60
Freedom   = personal freedom score / 100
Abundance = (ln(clamp(income, 100, 75000)) − ln(100))
            / (ln(75000) − ln(100))

Tomer = Health^0.40 · Safety^0.30 · Freedom^0.20 · Abundance^0.10
```

The geometric mean penalizes imbalance: strength in one dimension cannot fully
compensate for a near-zero result in another. Read the complete assumptions and
rationale in [the methodology](./src/app/methodology/page.jsx).

## Data and coverage

The tracker uses observations from **2000–2025** and stores the actual source year
beside every metric. For a displayed year, the pipeline uses the latest observation
available on or before that year; it never pulls future observations backward.

Primary sources:

- [World Bank Open Data](https://data.worldbank.org/) — life expectancy, GNI and GDP
  per capita (constant 2021 PPP), intentional homicides, population, and country metadata.
- [WHO Global Health Observatory](https://www.who.int/data/gho) — healthy life
  expectancy at birth (`WHOSIS_000002`).
- [Human Freedom Index 2025](https://www.cato.org/human-freedom-index/2025) — rule of
  law, movement, religion, association, expression, and relationships.

When annual WHO HALE is unavailable, the tracker preserves the latest reported
`life expectancy − HALE` gap and applies it to that year's life expectancy. Estimated
values are labeled in the interface. Regional and income-group rows are computed as
population-weighted aggregates from the country data rather than imported as separate
headline series.

## Pages

| Page | Purpose |
| --- | --- |
| `/` | Sortable leaderboard, filters, year slider, and adjustable pillar weights |
| `/compare` | Side-by-side comparisons with shareable `?picks=USA,JPN,...` links |
| `/map` | Interactive choropleth with adjustable pillar weights |
| `/entry` | Per-entry history for the index, pillars, and raw inputs |
| `/methodology` | Formulas, goalposts, sources, assumptions, and limitations |
| `/downloads` | Download every dataset individually or as one complete JSON bundle |

## Run locally

```bash
git clone https://github.com/Tomer2006/tomer-index.git
cd tomer-index
npm ci
npm run dev
```

Requires **Node.js 22.22.2+, 24.15+, or 26+** (including the test tools).
Open [http://localhost:5173](http://localhost:5173).
The App Router prerenders each route. Prebuilt JSON is committed under `public/data`,
so normal development and production builds do not depend on live APIs.
Production runs with `npm run build` followed by `npm start` on port 3000.
Use a Node.js host or a Next.js-compatible hosting provider.

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
| `npm run build-data` | Refresh World Bank, WHO, and HFI data; requires network access |
| `npm run build-world` | Rebuild the ISO3-keyed world GeoJSON used by the map |

## Project structure

```text
├── next.config.mjs           # Legacy redirects and content-based data version
├── postcss.config.mjs        # Tailwind CSS v4 integration
├── src/
│   ├── hdi-core.js           # Goalposts, pillar math, index math, data merging
│   ├── app/                  # Next.js routes, metadata, layout, Tailwind entrypoint
│   ├── components/           # React views, controls, SVG charts, data hooks
│   ├── view-model.js         # URL validation, historical snapshots, sorting
│   └── style.css             # Design tokens and specialized component styles
├── scripts/
│   ├── build-data.mjs        # Source ingestion and derived-score pipeline
│   └── build-world.mjs       # TopoJSON → GeoJSON conversion
├── public/data/              # Committed, browser-ready datasets
└── test/                     # Node scoring tests and React interaction tests
```

## Rebuilding the data

`npm run build-data` fetches all source observations, applies the documented
back-fill and HALE-estimation rules, calculates the absolute pillar and final scores,
and writes:

- `public/data/leaderboard.json` — latest leaderboard rows, data-quality flags, and
  the fixed-cohort trend.
- `public/data/series.json` — yearly histories for countries and aggregate rows.
- `data-archive/countries.json` — a readable full payload for local inspection
  (gitignored and not shipped).

The leaderboard and map lazy-load the larger history file when a visitor selects a
year before 2025. Entry and comparison pages load it immediately for their charts.
Data requests are shared across client navigation, and failed requests can be retried.

## Limitations

- Safety is intentionally homicide-only; it does not capture every dimension of crime
  or personal security.
- Freedom is a custom combination of HFI categories, not the published HFI headline
  Personal Freedom score.
- Switching from GNI to the GDP fallback can introduce a break in an income series.
- Some source observations are carried forward, and some HALE values are estimated;
  the interface exposes both cases.
- This is a personal composite and is not endorsed by UNDP, the World Bank, WHO,
  Cato Institute, or Fraser Institute.
