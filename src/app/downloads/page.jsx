import { statSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { Header } from "../../components/shared";
import { readLeaderboardFile } from "../../leaderboard-file.js";
import { SITE_NAME, SITE_URL } from "../../site.js";
import { YEAR_MAX, YEAR_MIN } from "../../site-years.js";

const DESCRIPTION = `Download the complete ${SITE_NAME} data: scores, inputs, and source years for every country and group, ${YEAR_MIN}–${YEAR_MAX}, plus the map boundaries.`;

export const metadata = {
  title: "Download data",
  description: DESCRIPTION,
  alternates: { canonical: "/downloads" },
};

const FILES = [
  {
    file: "leaderboard.json",
    title: `${YEAR_MAX} leaderboard`,
    description:
      "Every country and group for the latest year: inputs, pillar scores, the Tomer index, source years, and history-gap notes.",
    format: "JSON",
    type: "application/json",
  },
  {
    file: "series.json",
    title: `History ${YEAR_MIN}–${YEAR_MAX}`,
    description:
      "One point per year for every country and group, with the same inputs, scores, and source years.",
    format: "JSON",
    type: "application/json",
  },
  {
    file: "world.geojson",
    title: "Map boundaries",
    description:
      "Country outlines for the map, from Natural Earth 1:110m via world-atlas, with a few small states from 1:50m.",
    format: "GeoJSON",
    type: "application/geo+json",
  },
];

const FIELDS = [
  [
    "customIndex",
    <>
      Tomer index: 1 + Σ weight × ln(pillar), the log of the pillars’ weighted
      geometric mean. 1 means every goalpost is met; it can go above 1 or below
      0. The site shows it ×100.
    </>,
  ],
  [
    "healthIndex, safetyIndex, freedomIndex, abundanceIndex",
    <>
      Pillar scores, 0 at the lower goalpost and 1 at the upper one. Safety and
      freedom stop at 1; health and abundance pass 1 above 85 years and $75,000.
      Safety is 1 / (1 + deaths / 100), so it never reaches 0.
    </>,
  ],
  [
    "le, hale, haleEstimated",
    <>
      Life expectancy and Healthy life expectancy (HALE), in years.{" "}
      <code>haleEstimated</code> is true when HALE was estimated from the change
      in life expectancy (for a group, when any member’s was).
    </>,
  ],
  [
    "homicidesPer100k, warDeathsPer100k, roadDeathsPer100k",
    <>
      Deaths per 100,000 people from intentional homicide, which the safety
      pillar scores, and, for context only, war (counted for the country whose
      people died, 0 in years without any) and road crashes.
    </>,
  ],
  ["freedom", <>Personal freedom score, 0–100.</>],
  [
    "gni, incomeSource, incomeEstimated",
    <>
      Income per person in constant 2021 PPP dollars.{" "}
      <code>incomeEstimated</code> is true when that year has no published GNI
      and the latest GNI (from <code>gniYear</code>) was moved by the change in
      GDP per person since then (for a group, when any member’s was). Despite
      the name, <code>gni</code> holds GDP per person when{" "}
      <code>incomeSource</code> is “GDP”, which happens only before a
      country’s GNI starts; groups whose members use both say “mixed”.
    </>,
  ],
  [
    "leYear, haleYear, gniYear, homicideYear, warYear, roadYear, freedomYear",
    <>
      The source year of each input, which can be earlier than the year shown.
      Group rows say “mixed” in leaderboard.json and leave them out in
      series.json.
    </>,
  ],
  [
    "population",
    <>
      Total population (for a group, its members’ combined population), used to
      weight group averages.
    </>,
  ],
  [
    "derivedKind, memberCount, n",
    <>
      Group rows in leaderboard.json only: the kind of group (world, region,
      adminregion, incomeLevel, lendingType) and the number of countries
      averaged. In series.json, each group point gives that year’s count as{" "}
      <code>n</code>.
    </>,
  ],
];

/** Read at build time, so sizes and the data date always match the shipped files. */
function dataFile(file) {
  return join(process.cwd(), "public", "data", file);
}

function formatBytes(bytes) {
  return bytes >= 1e6
    ? `${(bytes / 1e6).toFixed(1)} MB`
    : `${Math.round(bytes / 1e3)} KB`;
}

export default function Page() {
  const files = FILES.map((entry) => ({
    ...entry,
    bytes: statSync(dataFile(entry.file)).size,
  }));
  const totalBytes = files.reduce((sum, entry) => sum + entry.bytes, 0);
  const { generatedAt } = readLeaderboardFile();
  const dataDate = new Intl.DateTimeFormat("en", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(generatedAt));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: SITE_NAME,
    description: DESCRIPTION,
    url: `${SITE_URL}/downloads`,
    temporalCoverage: `${YEAR_MIN}/${YEAR_MAX}`,
    spatialCoverage: "World",
    dateModified: generatedAt,
    isBasedOn: [
      "https://data.worldbank.org/",
      "https://www.who.int/data/gho",
      "https://www.cato.org/human-freedom-index/2025",
    ],
    variableMeasured: [
      "Tomer index",
      "Life expectancy",
      "Healthy life expectancy (HALE)",
      "Homicides per 100k",
      "Personal freedom",
      "Income per person (PPP $)",
    ],
    distribution: [
      {
        "@type": "DataDownload",
        name: "All site data",
        encodingFormat: "application/json",
        contentUrl: `${SITE_URL}/downloads/all`,
        contentSize: formatBytes(totalBytes),
      },
      ...files.map((entry) => ({
        "@type": "DataDownload",
        name: entry.title,
        encodingFormat: entry.type,
        contentUrl: `${SITE_URL}/data/${entry.file}`,
        contentSize: formatBytes(entry.bytes),
      })),
    ],
  };

  return (
    <main id="main" className="downloads-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <Header title="Download data" kicker="Explore the numbers">
        <p className="lede">
          The complete datasets behind the site, for every country and group
          from {YEAR_MIN} to {YEAR_MAX}. Data refreshed {dataDate}.
        </p>
      </Header>
      <section
        className="downloads-card downloads-all"
        aria-labelledby="downloads-all-title"
      >
        <h2 id="downloads-all-title" className="downloads-card-title">
          All site data
        </h2>
        <p className="downloads-card-text">
          The leaderboard, full history, and map boundaries together in one JSON
          file, keyed by file name.
        </p>
        <p className="downloads-meta">JSON · {formatBytes(totalBytes)}</p>
        <a
          className="btn primary downloads-action"
          href="/downloads/all"
          download="tomer-index-all-data.json"
        >
          Download all data
        </a>
      </section>
      <section aria-labelledby="downloads-files-title">
        <h2 id="downloads-files-title" className="downloads-heading">
          Individual files
        </h2>
        <div className="downloads-files">
          {files.map((entry) => (
            <article className="downloads-card" key={entry.file}>
              <h3 className="downloads-card-title">{entry.title}</h3>
              <p className="downloads-card-text">{entry.description}</p>
              <p className="downloads-meta">
                <code>{entry.file}</code> · {entry.format} ·{" "}
                {formatBytes(entry.bytes)}
              </p>
              <a
                className="btn downloads-action"
                href={`/data/${entry.file}`}
                download={entry.file}
              >
                Download {entry.file}
              </a>
            </article>
          ))}
        </div>
      </section>
      <section aria-labelledby="downloads-fields-title">
        <h2 id="downloads-fields-title" className="downloads-heading">
          Reading the files
        </h2>
        <p className="downloads-text">
          <code>leaderboard.json</code> lists rows under{" "}
          <code>countries</code>; <code>series.json</code> lists each country or
          group under <code>entrySeries</code> by its <code>iso</code> code
          (ISO 3166-1 alpha-3 for countries; codes such as <code>WLD</code> for
          groups), with a <code>points</code> array of yearly values. Both use
          these fields.{" "}
          <code>leaderboard.json</code> also holds{" "}
          <code>globalAverageSeries</code>, a population-weighted series
          for a fixed set of countries that have a score in every year.
        </p>
        <dl className="downloads-fields">
          {FIELDS.map(([name, text]) => (
            <div key={name}>
              <dt>
                <code>{name}</code>
              </dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
        <p className="downloads-text">
          <code>world.geojson</code> is a GeoJSON FeatureCollection. Each
          feature’s <code>id</code> is its ISO 3166-1 alpha-3 code, which
          matches <code>iso</code> in the other files, and its only property is{" "}
          <code>name</code>. Three ids aren’t ISO codes: <code>XKX</code>{" "}
          (Kosovo, the World Bank’s code), <code>SOL</code> (Somaliland), and{" "}
          <code>CYN</code> (Northern Cyprus). Not every feature has a score:
          Antarctica, for example, has no row in the other files.
        </p>
        <p className="downloads-text">
          Downloads include every country, group, and year in each file,
          whatever your current filters. Scores use the published default
          weights. Missing observations stay missing. Sources: World Bank World
          Development Indicators, the WHO Global Health Observatory, and the
          Cato Institute and Fraser Institute Human Freedom Index 2025. See the{" "}
          <Link href="/methodology">methodology</Link> for definitions,
          sources, and limitations.
        </p>
      </section>
    </main>
  );
}
