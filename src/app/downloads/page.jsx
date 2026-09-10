import Link from "next/link";
import { Header } from "../../components/shared";

export const metadata = {
  title: "Download data",
  description: "Download the complete Tomer index datasets, country histories, and map boundaries.",
};

const files = [
  ["leaderboard.json", "Latest leaderboard", "Country and aggregate scores, raw inputs, pillar weights, source years, and data-quality metadata.", "JSON"],
  ["series.json", "Full historical data", "Annual country and aggregate histories for 2000–2025, including available inputs, scores, and source years.", "JSON"],
  ["world.geojson", "World map boundaries", "The geographic features used to draw the interactive country map.", "GeoJSON"],
];

export default function Page() {
  return (
    <>
      <Header title="Download data" kicker="Explore the numbers">
        <p className="text-muted">Get the complete datasets used by the site.</p>
      </Header>
      <main className="grid gap-6">
        <section className="entry-summary">
          <h2 className="m-0 text-xl font-semibold">All site data</h2>
          <p className="m-0 text-muted">Download the leaderboard, full history, and map boundaries together in one JSON file.</p>
          <a className="btn primary w-fit" href="/downloads/all" download="tomer-index-all-data.json">Download all data (JSON)</a>
        </section>
        <section aria-label="Individual datasets" className="grid gap-4 md:grid-cols-3">
          {files.map(([file, title, description, format]) => (
            <article className="entry-summary content-start" key={file}>
              <h2 className="m-0 text-lg font-semibold">{title}</h2>
              <p className="m-0 text-sm text-muted">{description}</p>
              <a className="btn w-fit" href={`/data/${file}`} download={file}>Download {title.toLowerCase()} ({format})</a>
            </article>
          ))}
        </section>
        <p className="text-sm text-muted">Downloads include all entries and years available in each dataset, regardless of your current filters. Scores use the published default weights. Missing observations remain missing; source years may differ from the displayed year. See the <Link href="/methodology">methodology and sources</Link> for definitions and limitations.</p>
      </main>
    </>
  );
}
