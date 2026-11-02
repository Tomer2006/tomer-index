import { Suspense } from "react";
import WorldMap, { WorldMapPreview } from "../../components/world-map";
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
    <Suspense fallback={<WorldMapPreview description={DESCRIPTION} />}>
      <WorldMap />
    </Suspense>
  );
}
