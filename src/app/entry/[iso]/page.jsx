import Entry from "../../../components/entry";
import { readLeaderboardFile } from "../../../leaderboard-file.js";
import { entryHref } from "../../../view-model.js";
import { entryDescription, entrySummary } from "../../../entry-summary.js";

// One prerendered page per leaderboard row (countries and groups); other ids 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return readLeaderboardFile().countries.map((row) => ({ iso: row.iso }));
}

export async function generateMetadata({ params }) {
  const { iso } = await params;
  const summary = entrySummary(readLeaderboardFile(), iso);
  return {
    title: summary.row.name,
    description: entryDescription(summary),
    alternates: { canonical: entryHref(iso) },
  };
}

export default async function Page({ params }) {
  const { iso } = await params;
  return (
    <Entry iso={iso} summary={entrySummary(readLeaderboardFile(), iso)} />
  );
}
