import { Suspense } from "react";
import Link from "next/link";
import { Header } from "../../components/shared";
import { readLeaderboardFile } from "../../leaderboard-file.js";
import { entryHref, rowType } from "../../view-model.js";
import LegacyIsoRedirect from "./legacy-iso-redirect";

export const metadata = {
  title: "Countries and groups",
  description:
    "Tomer index history pages for every country, World Bank region, income group and lending group.",
  alternates: { canonical: "/entry" },
};

const SECTIONS = [
  ["country", "Countries"],
  ["region", "Regions"],
  ["income", "Income groups"],
  ["derived", "World & lending groups"],
];

export default function Page() {
  const rows = [...readLeaderboardFile().countries].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return (
    <main id="main" className="entry-page">
      <Header title="Countries and groups" kicker="Country histories">
        <p className="lede">
          Every country and group on the leaderboard has its own page with its
          Tomer index, inputs and history.
        </p>
      </Header>
      <Suspense fallback={null}>
        <LegacyIsoRedirect />
      </Suspense>
      {SECTIONS.map(([type, title]) => {
        const items = rows.filter((row) => rowType(row) === type);
        return (
          <section
            className="entry-index"
            key={type}
            aria-labelledby={`entry-index-${type}`}
          >
            <h2 id={`entry-index-${type}`} className="entry-section-title">
              {title} <span className="muted">({items.length})</span>
            </h2>
            <ul className="entry-index-list">
              {items.map((row) => (
                <li key={row.iso}>
                  <Link href={entryHref(row.iso)} prefetch={false}>
                    {row.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
