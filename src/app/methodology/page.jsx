import { Header } from "../../components/shared";
export const metadata = {
  title: "Methodology",
  description:
    "Pillar formulas, fixed goalposts, weights, data sources, and limitations of the Tomer index.",
};
export default function Page() {
  return (
    <>
      <Header title="Methodology" kicker="How the index is built" />
      <main className="methodology">
        <section className="prose">
          <h2>What the Tomer index measures</h2>
          <p>
            The Tomer index combines the four things that make a country great:
            <strong>abundance</strong>, <strong>safety</strong>,{" "}
            <strong>health</strong>, and <strong>freedom</strong>. Each pillar
            is normalised to 0–1, then combined into a single weighted geometric
            mean. The display rescales the result to 0–100.
          </p>

          <h2>Philosophy: trust informed preferences</h2>
          <p>
            The philosophy behind the Tomer index is to trust people’s own
            preferences. Its guiding question is: what conditions would people
            choose to live under in a world of perfect information, where they
            understood the available options, their consequences, and the
            tradeoffs involved?
          </p>
          <p>
            From this perspective, abundance, safety, health, and freedom matter
            because they help people pursue the lives they would choose for
            themselves. The aim is to evaluate the conditions that support those
            choices, while respecting that different people can prefer different
            ways of living even when fully informed.
          </p>
          <p>
            Perfect information is a thought experiment, not a claim about the
            world today. The index does not directly measure what everyone would
            prefer under those conditions. Its four pillars and default weights
            are a proposed approximation of that ideal, open to disagreement and
            revision. The adjustable weights let readers explore how different
            priorities affect the results.
          </p>

          <h2>Pillars and goalposts</h2>

          <h3>Health (½ life expectancy + ½ HALE)</h3>
          <p>
            Both inputs use UNDP's life-table goalposts: 20 years (worst) and 85
            years (best). The pillar averages life expectancy (LE) and healthy
            life expectancy (HALE), so a country is rewarded for both living
            long and living well.
          </p>
          <pre>
            <code>
              {
                "LEI(years) = (clamp(years, 20, 85) − 20) / (85 − 20)\nHealth = ½·LEI(LE) + ½·LEI(HALE)"
              }
            </code>
          </pre>
          <p>
            When WHO does not report HALE for a displayed year, the tracker
            adjusts it using life expectancy rather than keeping HALE flat. It
            preserves the latest reported gap between life expectancy and HALE:
          </p>
          <pre>
            <code>
              {
                "Estimated HALE = current LE − (LE at latest HALE year − latest reported HALE)"
              }
            </code>
          </pre>
          <p>
            Estimated HALE is capped at current life expectancy and labeled
            <strong>HALE est.</strong> with the latest reported HALE source
            year.
          </p>

          <h3>Abundance (GNI preferred, GDP fallback; log-scaled)</h3>
          <p>
            World Bank GNI per capita in 2021-PPP dollars is preferred for each
            country-year. When that annual GNI observation is unavailable, GDP
            per capita in the same constant 2021-PPP units is used as a
            fallback. The selected value is mapped to 0–1 between $100 and
            $75,000 — the same goalposts UNDP uses for HDI. Log scaling means
            each doubling of income adds a fixed amount, not a fixed fraction.
          </p>
          <pre>
            <code>
              {
                "Abundance value = GNI PPP if available, otherwise GDP PPP\nAbundance = (ln(clamp(value, 100, 75000)) − ln(100)) / (ln(75000) − ln(100))"
              }
            </code>
          </pre>

          <h3>Safety (homicide-only inversion)</h3>
          <p>
            Intentional homicides per 100,000 inverted linearly with a 60/100k
            ceiling. Only homicides are used because property crime, assault,
            and sexual-violence statistics are not comparable across countries
            (definitions, reporting culture, and survey methodology differ too
            much).
          </p>
          <pre>
            <code>{"Safety = (60 − clamp(homicides, 0, 60)) / 60"}</code>
          </pre>

          <h3>Freedom (Human Freedom Index personal freedom)</h3>
          <p>
            Freedom is derived from the Personal Freedom sub-index of the Cato
            Institute and Fraser Institute's Human Freedom Index 2025. It
            averages rule of law, movement, religion, association, expression
            and information, and relationships. The Security and Safety category
            is deliberately excluded so it does not overlap the Safety pillar.
          </p>
          <pre>
            <code>
              {
                "Freedom score = 10 × mean(Rule of law, Movement, Religion,\n                          Association, Expression, Relationships)\nFreedom pillar = Freedom score / 100"
              }
            </code>
          </pre>

          <h2>Weights</h2>
          <p>
            Before weighting, each pillar is normalized to 0–1 against the fixed
            goalposts above. The normalized values go directly into the
            geometric mean; there is no yearly percentile-ranking step. Scores
            are therefore absolute and comparable across countries and years: a
            country's score does not change merely because another country's
            performance changes.
          </p>
          <p>
            The four distinct dimensions are weighted by importance:
            <strong>Health 40%</strong>, <strong>Safety 30%</strong>,
            <strong>Freedom 20%</strong>, and <strong>Abundance 10%</strong>.
          </p>
          <pre>
            <code>
              Tomer = Health<sup>0.40</sup> · Safety<sup>0.30</sup> · Freedom
              <sup>0.20</sup> · Abundance<sup>0.10</sup>
            </code>
          </pre>
          <p>
            Geometric (rather than arithmetic) means penalise imbalance: a
            country can't compensate for a near-zero pillar by excelling
            elsewhere. Because every pillar uses fixed goalposts before
            combination, raw units do not control the result. Approximately, a
            1% relative improvement in one pillar changes the final index by
            that pillar's weight times 1%, holding the other pillars fixed.
          </p>

          <h2>Data sources</h2>
          <ul>
            <li>
              <strong>Life expectancy</strong> — World Bank
              <code>SP.DYN.LE00.IN</code>.
            </li>
            <li>
              <strong>
                HALE (healthy life expectancy at birth, both sexes)
              </strong>{" "}
              — WHO Global Health Observatory <code>WHOSIS_000002</code>.
            </li>
            <li>
              <strong>
                GNI per capita, PPP (constant 2021 international $)
              </strong>{" "}
              — World Bank <code>NY.GNP.PCAP.PP.KD</code>, the preferred income
              measure.
            </li>
            <li>
              <strong>
                GDP per capita, PPP (constant 2021 international $)
              </strong>{" "}
              — World Bank <code>NY.GDP.PCAP.PP.KD</code>, used only for
              country-years without a GNI observation.
            </li>
            <li>
              <strong>Intentional homicides per 100,000</strong> — World Bank
              <code>VC.IHR.PSRC.P5</code> (originally UNODC).
            </li>
            <li>
              <strong>Population</strong> (timeline weights) — World Bank
              <code>SP.POP.TOTL</code>.
            </li>
            <li>
              <strong>
                Personal Freedom categories, excluding Security and Safety
              </strong>
              — Human Freedom Index 2025, copublished by the Cato Institute and
              Fraser Institute; rescaled from 0–10 to 0–100.
            </li>
            <li>
              <strong>Country / region / income / lending metadata</strong> —
              World Bank country API.
            </li>
          </ul>

          <h2>Year coverage and back-fill</h2>
          <p>
            The leaderboard supports any year from <strong>2000 to 2025</strong>
            . For each displayed year we use the latest source observation on or
            before that year, looking back as far as 2000; later observations
            are never pulled backward, and the data pipeline does not ingest
            observations newer than 2025. Source releases have different lags,
            so a 2025 score can include older observations. The actual source
            year for each metric is stored on every data point and shown next
            to every value on the leaderboard, with details in its tooltip.
          </p>
          <p>
            HALE is the exception to flat carry-forward: missing HALE years are
            adjusted using the life-expectancy change described above. Future
            WHO HALE observations are never pulled backward.
          </p>
          <p>
            GNI is selected before GDP independently for each country-year. The
            source badge identifies whether a displayed income value is GNI,
            GDP, or a mixed population-weighted aggregate.
          </p>

          <h2>Derived rows</h2>
          <p>
            "World", regional, income-group, and lending-type rows are
            <strong>population-weighted aggregates</strong> computed on the fly
            from country observations. They are not separate published series.
          </p>

          <h2>Comparable trend chart</h2>
          <p>
            The headline trend uses a <strong>fixed cohort</strong>: only
            countries with a complete index for every year from 2000 through
            2025 are included, and the same countries remain in the calculation
            throughout. Population weights still change normally over time. This
            prevents a country entering the dataset from creating a false rise
            or fall. The chart states its cohort size and coverage and is not
            labeled as a whole-world estimate.
          </p>

          <h2>Limitations</h2>
          <ul>
            <li>
              Safety is homicide-only; countries with low homicide but high
              other-crime rates may be over-rated for "safety".
            </li>
            <li>
              Freedom is a custom recombination of published HFI category
              scores, not the HFI's published Personal Freedom headline score.
            </li>
            <li>
              Both income series use constant 2021 PPP, so cross-year movement
              within a country reflects real growth. GNI and GDP are related but
              not identical measures, so fallback transitions can create a break
              in an otherwise continuous income series.
            </li>
            <li>
              The Tomer index is not endorsed by UNDP, the World Bank, or WHO.
              It's a personal composite built around abundance, safety, health,
              and freedom.
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}
