# Tomer index

![Data coverage](https://img.shields.io/badge/data-2000--2024-0f766e)
![Scoring](https://img.shields.io/badge/scoring-absolute-2563eb)
![Built with Vite](https://img.shields.io/badge/built%20with-Vite-646CFF?logo=vite&logoColor=white)

An interactive country index built around four dimensions of a good society:
**abundance, safety, health, and freedom**.

The project turns public data into a transparent, reproducible score for countries,
World Bank regions, income groups, and other aggregates from **2000 through 2024**.
Explore the results as a sortable leaderboard, a choropleth map, country histories,
or side-by-side comparisons.

> **Scores are absolute, not relative.** A country's score is calculated against
> fixed goalposts and never changes merely because another country improves or
> declines.

## What you can explore

- Rank and filter countries by year, region, income level, entry type, or data quality.
- Compare several countries across the full index, individual pillars, and raw inputs.
- Explore the world map and experiment with custom pillar weights.
- Open a country page to inspect its score and input history from 2000–2024.
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
rationale in [the methodology](./methodology.html).

## Data and coverage

The tracker uses observations from **2000–2024** and stores the actual source year
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
| [`index.html`](./index.html) | Sortable leaderboard, filters, year slider, and fixed-cohort trend |
| [`compare.html`](./compare.html) | Side-by-side comparisons with shareable `?picks=USA,JPN,...` links |
| [`map.html`](./map.html) | Interactive choropleth with adjustable pillar weights |
| [`entry.html`](./entry.html) | Per-entry history for the index, pillars, and raw inputs |
| [`methodology.html`](./methodology.html) | Formulas, goalposts, sources, assumptions, and limitations |

## Run locally

```bash
git clone https://github.com/Tomer2006/tomer-index.git
cd tomer-index
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The app is fully static: its
prebuilt JSON is committed under `public/data`, so normal development and production
builds do not depend on live APIs.

### Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite development server on port 5173 |
| `npm test` | Run the index-math and display-scale tests |
| `npm run build` | Create the production build in `dist/` |
| `npm run preview` | Preview the production build on port 4173 |
| `npm run build-data` | Refresh World Bank, WHO, and HFI data; requires network access |
| `npm run build-world` | Rebuild the ISO3-keyed world GeoJSON used by the map |

## Project structure

```text
├── index.html / compare.html / map.html / entry.html
├── methodology.html          # Full scoring and data methodology
├── src/
│   ├── hdi-core.js           # Goalposts, pillar math, index math, data merging
│   ├── main.js               # Leaderboard
│   ├── compare.js            # Country comparison
│   ├── map.js                # Choropleth and custom weights
│   └── entry.js              # Country and aggregate histories
├── scripts/
│   ├── build-data.mjs        # Source ingestion and derived-score pipeline
│   └── build-world.mjs       # TopoJSON → GeoJSON conversion
├── public/data/              # Committed, browser-ready datasets
└── test/                     # Node test suite
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

The application lazy-loads the larger history file only when a visitor selects a
year before 2024.

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
