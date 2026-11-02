import { Suspense } from "react";
import WorldMap from "../../components/world-map";
import { Header } from "../../components/shared";
import { scoredCountries } from "../../leaderboard-file.js";
import { YEAR_MAX, YEAR_MIN } from "../../site-years.js";

const DESCRIPTION = `Interactive world map of the Tomer index, which combines health, safety, freedom and abundance into one score for each of ${scoredCountries().length} countries, ${YEAR_MIN}–${YEAR_MAX}.`;
export const metadata = {
  title: "World map",
  description: DESCRIPTION,
  alternates: { canonical: "/map" },
};
export default function Page() {
  return (
    <Suspense
      fallback={
        <main id="main" className="map-main">
          <Header title="Tomer index by country" kicker="World map" />
          <p className="lede">{DESCRIPTION}</p>
        </main>
      }
    >
      <WorldMap />
    </Suspense>
  );
}
