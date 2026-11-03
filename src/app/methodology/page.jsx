import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { Header } from "../../components/shared";
import {
  customIndexAbundanceSafetyHealthFreedomFull,
  INDEX_WEIGHTS,
  LE_BELOW_HALE_MAX,
} from "../../hdi-core.js";
import {
  readLeaderboardFile,
  scoredCountries,
} from "../../leaderboard-file.js";
import { formatTomer } from "../../index-scale.js";
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

/** Weight as a percentage and as points on the site (0.4 → "40%", "40"). */
const percent = (key) => `${Math.round(INDEX_WEIGHTS[key] * 100)}%`;
const points = (key) => String(Math.round(INDEX_WEIGHTS[key] * 100));
/** What halving a pillar costs on the site, in points. */
const halvingCost = (key) => Math.round(INDEX_WEIGHTS[key] * Math.LN2 * 100);

/** A future country with no homicides and full freedom, for the "no ceiling" example. */
const futureScore = (lifeExpectancy, hale, income) =>
  Math.round(
    100 *
      customIndexAbundanceSafetyHealthFreedomFull(
        lifeExpectancy,
        income,
        0,
        hale,
        100,
      ),
  );

const PILLARS = [
  {
    key: "health",
    name: "Health",
    input: "Life expectancy and Healthy life expectancy (HALE), averaged",
    goalposts: "20 → 85 years, then higher",
  },
  {
    key: "safety",
    name: "Safety",
    input: "Intentional homicides per 100k",
    goalposts: "∞ → 0 homicides (½ at 100)",
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
    goalposts: "$100 → $75,000 (log scale), then higher",
  },
];

/** How many country-years score below 0, and the lowest of them. */
function belowZero(countries, entrySeries) {
  const negative = countries.flatMap((row) =>
    (entrySeries[row.iso]?.points ?? [])
      .filter((point) => point.customIndex < 0)
      .map((point) => ({ name: row.name, year: point.year, value: point.customIndex })),
  );
  const lowest = negative.reduce(
    (low, point) => (!low || point.value < low.value ? point : low),
    null,
  );
  return { negativeScores: negative.length, lowestScore: lowest };
}

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
    roadYear: Math.max(...sourceYears("roadYear")),
    warYear: Math.max(...sourceYears("warYear")),
    estimatedIncomeCount: countries.filter((row) => row.incomeEstimated).length,
    ...belowZero(countries, entrySeries),
    worldFirst: world[0],
    worldLast: world.at(-1),
    cohortSize: readLeaderboardFile().globalAverageSeries?.cohortSize,
    droppedLifeExpectancy: droppedLifeExpectancy(countries),
  };
}

/**
 * The life-expectancy values the HALE check left out, one sentence part per country:
 * "Central African Republic: 14.7 years in 2009 and 31.5 in 2019, against HALE of 42.4–46.0".
 */
function droppedLifeExpectancy(countries) {
  const dropped = readLeaderboardFile().sourceRefresh?.lifeExpectancyCheck?.dropped ?? [];
  const byIso = new Map();
  for (const row of [...dropped].sort((a, b) => a.year - b.year)) {
    if (!byIso.has(row.iso)) byIso.set(row.iso, []);
    byIso.get(row.iso).push(row);
  }
  return [...byIso].map(([iso, rows]) => {
    const name = countries.find((country) => country.iso === iso)?.name ?? iso;
    const values = rows.map(
      (row, i) => `${row.lifeExpectancy.toFixed(1)}${i ? "" : " years"} in ${row.year}`,
    );
    const listed =
      values.length > 1 ? `${values.slice(0, -1).join(", ")} and ${values.at(-1)}` : values[0];
    const hale = rows.map((row) => row.hale);
    const low = Math.min(...hale).toFixed(1);
    const high = Math.max(...hale).toFixed(1);
    return `${name}: ${listed}, against HALE of ${low === high ? low : `${low}–${high}`}`;
  });
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

// Non-breaking spaces keep each "+ weight·ln Pillar" term together when the line wraps.
const tomerFormula = (
  <>
    Tomer = 100 +{"\u00a0"}{points("health")}·ln{"\u00a0"}Health +{"\u00a0"}
    {points("safety")}·ln{"\u00a0"}Safety +{"\u00a0"}
    {points("freedom")}·ln{"\u00a0"}Freedom +{"\u00a0"}
    {points("abundance")}·ln{"\u00a0"}Abundance
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
              The Tomer index scores countries, and groups of countries, on four
              pillars: health, safety, freedom, and abundance. Each pillar is
              scaled against fixed goalposts, 1 at the upper one, and the four
              are combined on a log scale (the log of their weighted geometric
              mean) for every year from {YEAR_MIN} to {YEAR_MAX}. The site shows
              the result ×100; the downloadable files keep the unscaled values.
            </p>
            <p>
              <strong>The scale has no limit either way.</strong> A country
              scores 100 when it meets every upper goalpost, but 100 isn’t a
              limit: a country that lives longer than 85 years or earns more
              than $75,000 a person scores above it. Nor is 0: every halving of
              a pillar costs the same number of points however low it already
              is, so a country can keep falling below 0 (see{" "}
              <a href="#combining">Combining the pillars</a>).
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
                    <th scope="col">Goalposts (0 → 1)</th>
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
                from as early as{" "}
                {facts.oldestHomicideYear}. Every value on the site shows its
                source year.
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
                <strong>Income without a published GNI is estimated.</strong>{" "}
                In {YEAR_MAX}, {facts.estimatedIncomeCount} of{" "}
                {facts.countryCount} countries have no GNI value yet, so their
                latest GNI is moved by the change in GDP per person since then
                (see <a href="#pillars">Abundance</a>). Before a country’s GNI
                series starts, GDP per person is used as published, so a break
                can remain in the year its GNI starts.
              </li>
              <li>
                <strong>War and road deaths are context, not score.</strong>{" "}
                Country and compare pages show them next to homicides, but the
                index doesn’t count them: a country at war or with deadly roads
                scores the same as one without (see{" "}
                <a href="#pillars">Safety</a>).
              </li>
              <li>
                Safety counts only intentional homicides. It leaves out war and
                road deaths, suicide, other accidents such as falls, drowning
                and fires, natural disasters, and crime that doesn’t kill.
              </li>
              <li>
                Freedom is a custom recombination of Human Freedom Index
                category scores, not the HFI’s published Personal Freedom
                score.
              </li>
              <li>
                On the log scale, 0 has no special meaning: it is where the
                pillars’ weighted geometric mean falls to about 37% of the
                goalposts (see <a href="#combining">Combining the pillars</a>).
              </li>
              <li>
                Group averages change membership over time as more countries
                have complete data (see <a href="#groups">Regions and groups</a>
                ).
              </li>
              <li>
                The Tomer index is not endorsed by UNDP, the World Bank, WHO,
                UCDP, the Cato Institute, or the Fraser Institute. It is a personal
                composite built around health, safety, freedom, and abundance.
              </li>
            </ul>
          </Section>

          <Section id="pillars">
            <PillarHeading pillar="health">
              Health: ½ life expectancy + ½ HALE
            </PillarHeading>
            <p>
              Both inputs use UNDP’s life-table goalposts: 20 years scores 0 and
              85 years scores 1. Unlike UNDP’s index, 85 is not a cap: each year
              beyond it counts as much as a year below it, so the pillar keeps
              rising as lifespans grow. The pillar averages life expectancy (LE)
              and healthy life expectancy (HALE), so a country is rewarded both
              for living long and for living well.
            </p>
            <Formula
              lines={[
                "LEI(years) = (years − 20) / (85 − 20)",
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
              The gap keeps its sign. Life expectancy comes from the World Bank
              and HALE from WHO, so in a few countries, such as Nigeria, WHO’s
              HALE is above the World Bank’s life expectancy; estimated HALE
              then stays above it by the same margin instead of dropping to it.
              Estimated HALE never goes below 20 years. Estimated values are
              labeled <strong>est.</strong> with the latest WHO source year, for
              example “HALE est. from {facts.haleYear}”.
            </p>
            <p>
              Healthy years can’t outnumber years lived, so a World Bank life
              expectancy more than {LE_BELOW_HALE_MAX} years below WHO’s latest
              HALE is treated as an error and left out; that year uses the
              latest earlier value instead.
              {facts.droppedLifeExpectancy.length ? (
                <>
                  {" "}
                  In the current data it leaves out{" "}
                  {facts.droppedLifeExpectancy.join("; ")}.
                </>
              ) : null}
            </p>

            <PillarHeading pillar="safety">
              Safety: intentional homicides
            </PillarHeading>
            <p>
              Safety scores intentional homicides per 100,000 people a year. No
              homicides scores 1, 100 per 100,000 (one person in a thousand a
              year) scores ½, 200 scores ⅓, and the score gets closer to 0 with
              every death without reaching it, so homicides never stop
              counting.
            </p>
            <Formula lines={["Safety = 1 / (1 + homicides / 100)"]} />
            <p>
              <strong>War and road deaths are shown for context only.</strong>{" "}
              Country and compare pages chart them beside homicides, marked{" "}
              <strong>Not in the index</strong>, but they don’t change any
              score, and a country-year doesn’t need them to be scored.
            </p>
            <p>
              War deaths come from the Uppsala Conflict Data Program’s event
              data (UCDP GED, through {facts.warYear}): people killed in fighting
              involving a government, and civilians killed on purpose by armed
              forces or groups. Each death counts for the country whose people
              died: a government’s soldiers for their own country, wherever they
              fell, and civilians and members of armed groups for the country
              where they died. So Russia counts its soldiers killed in Ukraine,
              and deaths in Gaza and the West Bank count for Palestine, which
              the index doesn’t score, not Israel. Fighting between gangs or
              militias is left out, as
              homicide figures already include most of it, and years without
              recorded deaths count as 0. UCDP’s counts are conservative:
              deaths it can’t confirm aren’t included. Road deaths are WHO
              estimates and end in {facts.roadYear}; later years use that
              year’s rate. Crime that doesn’t kill isn’t used, because property crime,
              assault, and sexual-violence statistics aren’t comparable across
              countries: definitions, reporting culture, and survey methods
              differ too much.
            </p>

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
              Income is World Bank GNI per person in constant 2021 PPP dollars.
              GNI is published later than GDP, and for some countries only for
              some years. When a year has no GNI value, the tracker takes the
              latest earlier GNI and moves it by the change in GDP per person
              (same units) since that year. It doesn’t substitute GDP itself,
              which can sit far from GNI: Tajikistan’s GDP per person is about
              half its GNI. Before a country’s first GNI value, GDP per person is
              used as published. On a log scale, $100 scores 0 and $75,000
              scores 1, the same goalposts UNDP uses for the HDI. Unlike the
              HDI, income above $75,000 still counts. Log scaling means each
              doubling of income adds a fixed amount, not a fixed fraction, so
              richer countries need ever larger gains to move the pillar.
            </p>
            <Formula
              lines={[
                "Income    = GNI per person if published that year,",
                "            otherwise latest GNI × (GDP now / GDP in that GNI year)",
                "Abundance = ln(income / 100) / ln(75000 / 100)",
              ]}
            />
            <p>
              Estimated income is labeled <strong>est.</strong> with the year of
              the GNI it starts from, for example “GNI est. from{" "}
              {YEAR_MAX - 1}”; plain GDP is labeled <strong>GDP</strong>.
            </p>
          </Section>

          <Section id="combining">
            <p>
              Each pillar is normalized against the fixed goalposts above, and
              the normalized values go straight into the formula below. There is
              no yearly ranking or rescaling step, so scores are absolute and
              comparable across countries and years.
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
              This is 100 + 100 × ln of the pillars’ weighted geometric mean, so
              it ranks countries exactly as that mean does, and one point is
              about a 1% change in the mean at any level. What counts is a
              pillar’s relative change: halving one costs{" "}
              <strong>
                {halvingCost("health")} points for health,{" "}
                {halvingCost("safety")} for safety, {halvingCost("freedom")} for
                freedom, and {halvingCost("abundance")} for abundance
              </strong>
              , whatever the other pillars score. A pillar that is already low
              moves the index the most, so strength in one pillar can’t make up
              for weakness in another.
            </p>
            <p>
              <strong>The index has no floor.</strong> Every halving costs the
              same however low a pillar already is, so the index keeps falling
              without limit. Safety never reaches 0, so the 101st homicide per
              100,000 counts, and so does the 1,000th. A pillar at its lower
              goalpost (20 years of life, $100 a person, no freedom) would be
              infinitely far down.
              {facts.lowestScore ? (
                <>
                  {" "}
                  In the current data, {facts.negativeScores} country-years
                  score below 0; the lowest is {facts.lowestScore.name} in{" "}
                  {facts.lowestScore.year}, at{" "}
                  {formatTomer(facts.lowestScore.value)}.
                </>
              ) : null}
            </p>
            <p>
              <strong>Nor does it have a ceiling.</strong> Safety and freedom
              stop at 1: a country can’t have fewer than zero homicides or more
              than a perfect freedom score. Health and abundance have no upper
              limit, so a country that meets every goalpost scores 100 and one
              that goes further scores more. With no homicides and full
              freedom, life expectancy of 100 years, HALE of 90, and $150,000 a
              person would score about {futureScore(100, 90, 150000)}; 150
              years, HALE of 140, and $1,000,000 a person would score about{" "}
              {futureScore(150, 140, 1e6)}.
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
              A country gets a score for a year only when all five inputs
              (life expectancy, HALE, income, homicide rate, and freedom score)
              are available as of that year. War and road deaths are shown
              when available but aren’t needed.
            </p>
            <p>
              HALE is the exception to flat carry-forward: years after WHO’s
              latest value are estimated from the change in life expectancy, as
              described under <a href="#pillars">Health</a>. If life expectancy
              is missing too, the latest reported HALE is carried forward
              unchanged.
            </p>
            <p>
              Income is the other exception: years after a country’s latest GNI
              follow the change in GDP per person, as described under{" "}
              <a href="#pillars">Abundance</a>. Only when GDP is missing too is
              the latest income value carried forward unchanged.
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
              all seven inputs and a population figure is included. Each input
              (life expectancy, HALE, income, the three death rates, and freedom
              score) is averaged first, weighted by population, and the averages are
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
                <strong>War deaths</strong>, context only (state-based and
                one-sided violence, by the country whose people died, divided
                by its population): Uppsala Conflict Data Program Georeferenced Event
                Dataset (UCDP GED) 26.1.
              </li>
              <li>
                <strong>Road deaths</strong>, context only (road traffic deaths
                per 100,000 people): World Bank <code>SH.STA.TRAF.P5</code>, originally WHO
                estimates.
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
                <code>NY.GDP.PCAP.PP.KD</code>, used only to extend GNI to years
                without it, or before a country’s GNI starts.
              </li>
              <li>
                <strong>Population</strong> (weights for group averages, and
                the denominator for war deaths): World Bank{" "}
                <code>SP.POP.TOTL</code>.
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
