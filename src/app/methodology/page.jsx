import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { Header } from "../../components/shared";
import { INDEX_WEIGHTS } from "../../hdi-core.js";
import {
  readLeaderboardFile,
  scoredCountries,
} from "../../leaderboard-file.js";
import { YEAR_MAX, YEAR_MIN } from "../../site-years.js";
import { TOPIC_COLORS } from "../../topic-colors.js";

export const metadata = {
  title: "Methodology",
  description:
    "How the Tomer index is built: pillar formulas, fixed goalposts, weights, data sources, data freshness, and limitations.",
  alternates: { canonical: "/methodology" },
};

const SECTIONS = {
  "at-a-glance": "At a glance",
  limitations: "Limitations",
  pillars: "Pillars and goalposts",
  combining: "Combining the pillars",
  years: "Years and estimates",
  groups: "Regions and groups",
  sources: "Data sources",
  philosophy: "Philosophy",
};

/** Weight as a percentage and as the formula exponent (0.4 → "40%", "0.40"). */
const percent = (key) => `${Math.round(INDEX_WEIGHTS[key] * 100)}%`;
const exponent = (key) => INDEX_WEIGHTS[key].toFixed(2);

const PILLARS = [
  {
    key: "health",
    name: "Health",
    input: "Life expectancy and Healthy life expectancy (HALE), averaged",
    goalposts: "20 → 85 years",
  },
  {
    key: "safety",
    name: "Safety",
    input: "Homicides per 100k",
    goalposts: "60 → 0",
  },
  {
    key: "freedom",
    name: "Freedom",
    input: "Personal freedom (0–100)",
    goalposts: "0 → 100",
  },
  {
    key: "abundance",
    name: "Abundance",
    input: "Income per person (PPP $)",
    goalposts: "$100 → $75,000 (log scale)",
  },
];

/** Read at build: the data-freshness facts quoted on the page follow the shipped data. */
function dataFacts() {
  const { entrySeries } = JSON.parse(
    readFileSync(join(process.cwd(), "public", "data", "series.json"), "utf8"),
  );
  const countries = scoredCountries();
  const sourceYears = (key) =>
    countries.map((row) => row[key]).filter(Number.isFinite);
  const world = entrySeries.WLD?.points ?? [];
  return {
    countryCount: countries.length,
    leYear: Math.max(...sourceYears("leYear")),
    haleYear: Math.max(...sourceYears("haleYear")),
    freedomYear: Math.max(...sourceYears("freedomYear")),
    oldestHomicideYear: Math.min(...sourceYears("homicideYear")),
    gdpCount: countries.filter((row) => row.incomeSource === "GDP").length,
    zeroScores: countries.reduce(
      (sum, row) =>
        sum +
        (entrySeries[row.iso]?.points ?? []).filter(
          (point) => point.customIndex === 0,
        ).length,
      0,
    ),
    worldFirst: world[0],
    worldLast: world.at(-1),
    cohortSize: readLeaderboardFile().globalAverageSeries?.cohortSize,
  };
}

/** Each line wraps with a hanging indent instead of clipping on narrow screens. */
function Formula({ lines }) {
  return (
    <pre>
      <code>
        {lines.map((line, index) => (
          <span className="formula-line" key={index}>
            {line}
            {index < lines.length - 1 ? "\n" : null}
          </span>
        ))}
      </code>
    </pre>
  );
}

function Section({ id, className, children }) {
  return (
    <section id={id} className={className} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{SECTIONS[id]}</h2>
      {children}
    </section>
  );
}

function PillarHeading({ pillar, children }) {
  return (
    <h3 style={{ "--topic-color": TOPIC_COLORS[pillar] }}>
      {children} · {percent(pillar)}
    </h3>
  );
}

// Non-breaking spaces keep each "· Pillar^weight" term together when the line wraps.
const tomerFormula = (
  <>
    Tomer = Health<sup>{exponent("health")}</sup> ·{"\u00a0"}Safety
    <sup>{exponent("safety")}</sup> ·{"\u00a0"}Freedom
    <sup>{exponent("freedom")}</sup> ·{"\u00a0"}Abundance
    <sup>{exponent("abundance")}</sup>
  </>
);

export default function Page() {
  const facts = dataFacts();
  return (
    <main id="main" className="methodology">
      <Header title="Methodology" kicker="How the index is built" />
      <div className="methodology-layout">
        <nav className="methodology-toc" aria-label="On this page">
          <p className="methodology-toc-title">On this page</p>
          <ol>
            {Object.entries(SECTIONS).map(([id, title]) => (
              <li key={id}>
                <a href={`#${id}`}>{title}</a>
              </li>
            ))}
          </ol>
        </nav>
        <article className="prose">
          <Section id="at-a-glance">
            <p>
              The Tomer index scores countries, and groups of countries, from
              0 to 100 on four pillars: health, safety, freedom, and abundance.
              Each pillar is scaled from 0 to 1 against fixed goalposts, and the
              four are combined into a weighted geometric mean for every year
              from {YEAR_MIN} to {YEAR_MAX}. The site shows the result ×100; the
              downloadable files keep the 0–1 values.
            </p>
            <div className="methodology-table-wrap">
              <table className="methodology-table">
                <caption>Pillars, default weights, and goalposts</caption>
                <thead>
                  <tr>
                    <th scope="col">Pillar</th>
                    <th scope="col" className="methodology-num">
                      Weight
                    </th>
                    <th scope="col">Input</th>
                    <th scope="col">Goalposts (worst → best)</th>
                  </tr>
                </thead>
                <tbody>
                  {PILLARS.map((pillar) => (
                    <tr key={pillar.key}>
                      <th
                        scope="row"
                        style={{ "--topic-color": TOPIC_COLORS[pillar.key] }}
                      >
                        {pillar.name}
                      </th>
                      <td className="methodology-num">{percent(pillar.key)}</td>
                      <td>{pillar.input}</td>
                      <td>{pillar.goalposts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Formula lines={[tomerFormula]} />
            <p>
              Scores are absolute: a country’s score depends only on its own
              data, so it never changes because another country improves or
              declines. Why these four pillars? See{" "}
              <a href="#philosophy">Philosophy</a>.
            </p>
          </Section>

          <Section id="limitations" className="methodology-limitations">
            <ul>
              <li>
                <strong>Recent years lean on older data.</strong> Sources
                publish with a lag, so the {YEAR_MAX} scores use life expectancy
                from {facts.leYear} at the latest, freedom scores from{" "}
                {facts.freedomYear}, and, for a few countries, homicide rates
                from as early as {facts.oldestHomicideYear}. Every value on the
                site shows its source year.
              </li>
              <li>
                <strong>HALE after {facts.haleYear} is estimated.</strong> WHO’s
                latest healthy life expectancy values are for {facts.haleYear};
                every later HALE value is estimated from the change in life
                expectancy since then (see <a href="#pillars">Health</a>) and
                labeled <strong>est.</strong> (for example “HALE est. from{" "}
                {facts.haleYear}”).
              </li>
              <li>
                <strong>GDP stands in where GNI isn’t published.</strong> In{" "}
                {YEAR_MAX}, {facts.gdpCount} of {facts.countryCount} countries
                use GDP per person. The two measures are related but not
                identical, so a switch between them can create a break in a
                country’s income series.
              </li>
              <li>
                Safety is homicide-only. Countries with few homicides but high
                rates of other crime may be over-rated for safety.
              </li>
              <li>
                Freedom is a custom recombination of Human Freedom Index
                category scores, not the HFI’s published Personal Freedom
                score.
              </li>
              <li>
                A single pillar at its worst goalpost sets the index to 0 (see{" "}
                <a href="#combining">Combining the pillars</a>).
              </li>
              <li>
                Group averages change membership over time as more countries
                have complete data (see <a href="#groups">Regions and groups</a>
                ).
              </li>
              <li>
                The Tomer index is not endorsed by UNDP, the World Bank, WHO,
                the Cato Institute, or the Fraser Institute. It is a personal
                composite built around health, safety, freedom, and abundance.
              </li>
            </ul>
          </Section>

          <Section id="pillars">
            <PillarHeading pillar="health">
              Health: ½ life expectancy + ½ HALE
            </PillarHeading>
            <p>
              Both inputs use UNDP’s life-table goalposts: 20 years (worst) and
              85 years (best). The pillar averages life expectancy (LE) and
              healthy life expectancy (HALE), so a country is rewarded both for
              living long and for living well.
            </p>
            <Formula
              lines={[
                "LEI(years) = (clamp(years, 20, 85) − 20) / (85 − 20)",
                "Health     = ½·LEI(LE) + ½·LEI(HALE)",
              ]}
            />
            <p>
              When WHO has no HALE value for a displayed year, the tracker
              estimates it from life expectancy instead of keeping HALE flat.
              It keeps the gap between life expectancy and HALE from the latest
              WHO year and applies it to the current life expectancy:
            </p>
            <Formula
              lines={[
                "gap            = LE in latest HALE year − latest reported HALE",
                "Estimated HALE = current LE − gap",
              ]}
            />
            <p>
              The gap is never negative, so estimated HALE never exceeds current
              life expectancy, and it never goes below 20 years. Estimated
              values are labeled <strong>est.</strong> with the latest WHO source
              year, for example “HALE est. from {facts.haleYear}”.
            </p>

            <PillarHeading pillar="safety">
              Safety: homicides, inverted
            </PillarHeading>
            <p>
              Intentional homicides per 100,000 people, inverted linearly: a
              rate of 0 scores 1, and any rate of 60 or more scores 0. Only
              homicides are used because property crime, assault, and
              sexual-violence statistics aren’t comparable across countries:
              definitions, reporting culture, and survey methods differ too
              much.
            </p>
            <Formula lines={["Safety = (60 − clamp(homicides, 0, 60)) / 60"]} />

            <PillarHeading pillar="freedom">
              Freedom: Human Freedom Index personal freedom
            </PillarHeading>
            <p>
              Freedom comes from the Personal Freedom categories of the Human
              Freedom Index 2025, published by the Cato Institute and the Fraser
              Institute. It averages six categories, each scored 0–10: rule of
              law, movement, religion, association, expression and information,
              and relationships. At least five of the six must be available.
              The Security and Safety category is deliberately excluded so it
              doesn’t overlap the Safety pillar. Country-years the HFI doesn’t
              score stay missing.
            </p>
            <Formula
              lines={[
                "Freedom score  = 10 × mean(available category scores)",
                "Freedom pillar = Freedom score / 100",
              ]}
            />

            <PillarHeading pillar="abundance">
              Abundance: income per person, log scale
            </PillarHeading>
            <p>
              World Bank GNI per person in constant 2021 PPP dollars is
              preferred for each country-year. When that year has no GNI value,
              GDP per person in the same constant 2021 PPP units is used
              instead. The value is mapped to 0–1 between $100 and $75,000, the
              same goalposts UNDP uses for the HDI. Log scaling means each
              doubling of income adds a fixed amount, not a fixed fraction.
            </p>
            <Formula
              lines={[
                "Income    = GNI per person if published, otherwise GDP per person",
                "Abundance = (ln(clamp(income, 100, 75000)) − ln(100))",
                "            / (ln(75000) − ln(100))",
              ]}
            />
          </Section>

          <Section id="combining">
            <p>
              Each pillar is normalized to 0–1 against the fixed goalposts
              above, and the normalized values go straight into the geometric
              mean. There is no yearly ranking or rescaling step, so scores are
              absolute and comparable across countries and years.
            </p>
            <p>
              The default weights reflect importance:{" "}
              <strong>Health {percent("health")}</strong>,{" "}
              <strong>Safety {percent("safety")}</strong>,{" "}
              <strong>Freedom {percent("freedom")}</strong>, and{" "}
              <strong>Abundance {percent("abundance")}</strong>.
            </p>
            <Formula lines={[tomerFormula]} />
            <p>
              A geometric mean, unlike an arithmetic one, penalizes imbalance:
              strength in one pillar can’t make up for weakness in another.
              Roughly, a 1% relative improvement in one pillar raises the index
              by that pillar’s weight times 1%, holding the others fixed.
            </p>
            <p>
              Because the pillars are multiplied,{" "}
              <strong>
                a pillar at its worst goalpost sets the index to 0
              </strong>
              , whatever the other pillars score: for example, 60 or more
              homicides per 100k, or life expectancy and HALE both at 20 years
              or less. In the current data, {facts.zeroScores} country-years
              score exactly 0 this way.
            </p>
            <p>
              On the leaderboard and map you can set your own weights. They are
              normalized to sum to 100%, a pillar set to 0 drops out, and the
              result is labeled <strong>Custom index</strong>. The published
              Tomer index always uses the default weights.
            </p>
          </Section>

          <Section id="years">
            <p>
              The site covers every year from {YEAR_MIN} to {YEAR_MAX}. For each
              displayed year, each input uses the latest observation on or
              before that year, looking back as far as {YEAR_MIN}. Later
              observations are never pulled backward, and the data pipeline
              doesn’t ingest observations newer than {YEAR_MAX}. Sources publish
              with different lags, so a {YEAR_MAX} score can rest on older
              observations. The source year of every input is stored with each
              data point and shown next to each value on the site.
            </p>
            <p>
              A country gets a score for a year only when all five inputs (life
              expectancy, HALE, income, homicide rate, and freedom score) are
              available as of that year. Countries and groups missing a score
              in some of their years are marked <strong>History gaps</strong>.
            </p>
            <p>
              HALE is the exception to flat carry-forward: years after WHO’s
              latest value are estimated from the change in life expectancy, as
              described under <a href="#pillars">Health</a>. If life expectancy
              is missing too, the latest reported HALE is carried forward
              unchanged.
            </p>
            <p>
              Income is chosen year by year, GNI where it is published for that
              year and GDP otherwise, before back-fill. So a recent GDP value
              takes precedence over an older GNI value. The source badge shows
              whether a displayed income value is GNI or GDP.
            </p>
          </Section>

          <Section id="groups">
            <p>
              Alongside countries, the site shows the World, World Bank regions
              (also in versions excluding high-income countries), income groups,
              and World Bank lending groups. Groups aren’t ranked; ranks count
              countries only.
            </p>
            <p>
              Group rows are <strong>population-weighted averages</strong>,
              computed when the dataset is built rather than taken from
              published group series. For each year, every member country with
              all five inputs and a population figure is included. Each input
              (life expectancy, HALE, income, homicide rate, and freedom score)
              is averaged first, weighted by population, and the averages are
              then scored with the same goalposts and formula as a country.
              Members follow each country’s current World Bank classification
              in every year. Source years are shown as “mixed” for groups.
            </p>
            <p>
              Membership grows as coverage improves: the World average includes{" "}
              {facts.worldFirst?.n} countries in {facts.worldFirst?.year} and{" "}
              {facts.worldLast?.n} in {facts.worldLast?.year}. Part of a
              group’s change over time therefore reflects which countries are
              included. For a like-for-like trend, the downloadable{" "}
              <code>leaderboard.json</code> (see{" "}
              <Link href="/downloads">Downloads</Link>) also includes a
              population-weighted series for a fixed set of {facts.cohortSize}{" "}
              countries that have a score in every year.
            </p>
            <p>
              Lending groups follow the World Bank’s lending categories:{" "}
              <strong>IBRD only</strong> (countries that borrow only from the
              International Bank for Reconstruction and Development),{" "}
              <strong>IDA only</strong> (countries that borrow only from the
              International Development Association, the World Bank’s fund for
              the poorest countries), and <strong>IDA blend</strong> (countries
              eligible for both). <strong>IDA total</strong> combines IDA only
              and IDA blend; <strong>IDA &amp; IBRD total</strong> combines all
              three. Countries the World Bank leaves unclassified form no group
              of their own but still count toward the World and the other
              groups they belong to.
            </p>
          </Section>

          <Section id="sources">
            <ul>
              <li>
                <strong>Life expectancy</strong> (at birth, total): World Bank{" "}
                <code>SP.DYN.LE00.IN</code>.
              </li>
              <li>
                <strong>Healthy life expectancy (HALE)</strong> (at birth, both
                sexes): WHO Global Health Observatory{" "}
                <code>WHOSIS_000002</code>.
              </li>
              <li>
                <strong>Homicides per 100k</strong> (intentional homicides per
                100,000 people): World Bank <code>VC.IHR.PSRC.P5</code>,
                originally from UNODC.
              </li>
              <li>
                <strong>Personal freedom</strong>: Human Freedom Index 2025, by
                the Cato Institute and the Fraser Institute; six Personal
                Freedom categories, excluding Security and Safety, rescaled from
                0–10 to 0–100.
              </li>
              <li>
                <strong>Income per person (PPP $)</strong>: World Bank GNI per
                capita, PPP (constant 2021 international $),{" "}
                <code>NY.GNP.PCAP.PP.KD</code>, the preferred measure; and GDP
                per capita, PPP (constant 2021 international $),{" "}
                <code>NY.GDP.PCAP.PP.KD</code>, used only for country-years
                without GNI.
              </li>
              <li>
                <strong>Population</strong> (weights for group averages): World
                Bank <code>SP.POP.TOTL</code>.
              </li>
              <li>
                <strong>Region, income, and lending classifications</strong>:
                World Bank country API.
              </li>
            </ul>
          </Section>

          <Section id="philosophy">
            <p>
              The philosophy behind the Tomer index is to trust people’s own
              preferences. Its guiding question is: what conditions would people
              choose to live under in a world of perfect information, where they
              understood the available options, their consequences, and the
              tradeoffs involved?
            </p>
            <p>
              From this perspective, abundance, safety, health, and freedom
              matter because they help people pursue the lives they would choose
              for themselves. The aim is to evaluate the conditions that support
              those choices, while respecting that different people can prefer
              different ways of living even when fully informed.
            </p>
            <p>
              Perfect information is a thought experiment, not a claim about the
              world today. The index does not directly measure what everyone
              would prefer under those conditions. Its four pillars and default
              weights are a proposed approximation of that ideal, open to
              disagreement and revision. The adjustable weights let readers
              explore how different priorities affect the results.
            </p>
          </Section>
        </article>
      </div>
    </main>
  );
}
