import { Suspense } from "react";
import Leaderboard, { LeaderboardPreview } from "../components/leaderboard";
import LeaderboardSnapshot from "../components/leaderboard-snapshot";
import { scoredCountries } from "../leaderboard-file.js";
import { YEAR_MAX, YEAR_MIN } from "../site-years.js";

export const metadata = {
  title: {
    absolute: "Tomer index — health, safety, freedom and abundance by country",
  },
  description: `${scoredCountries().length} countries ranked on health, safety, freedom and abundance against fixed goalposts, ${YEAR_MIN}–${YEAR_MAX}; 100 means every goalpost is met, and scores can go past it or below 0. Filter by region or income, or set your own weights.`,
  alternates: { canonical: "/" },
};

export default function Page() {
  const snapshot = <LeaderboardSnapshot />;
  return (
    <Suspense fallback={<LeaderboardPreview placeholder={snapshot} />}>
      <Leaderboard placeholder={snapshot} />
    </Suspense>
  );
}
