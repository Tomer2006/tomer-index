"use client";
import Link from "next/link";
import { useDataset } from "./hooks";
import {
  Header,
  DataStatus,
  MetricCell,
  QualityBadge,
  PillarBars,
  SourceBadge,
} from "./shared";
import HistoryChart from "./history-chart";
import { columnFor, columns } from "../view-model.js";
import { metricDefs } from "../metric-defs.js";
import { YEAR_MAX, YEAR_MIN } from "../site-years.js";
import {
  entryKicker,
  entrySummary,
  rankLabel,
} from "../entry-summary.js";

const tomerColumn = columnFor("tomer"),
  statColumns = columns.filter((column) => column !== tomerColumn);
const tomerColor = metricDefs.find((metric) => metric.key === "customIndex").color;

/**
 * One country's or group's page. The static /entry/[iso] route passes the
 * prerendered `summary`, so only the history has to load; without it the
 * leaderboard is fetched to find the row.
 */
export default function Entry({ iso, summary: initial = null }) {
  const leaderboard = useDataset("leaderboard", !initial),
    history = useDataset(`entry:${iso}`, Boolean(iso));
  const summary =
    initial ?? (leaderboard.data ? entrySummary(leaderboard.data, iso) : null);
  if (!summary)
    return (
      <main id="main" className="entry-page">
        <Header
          title={leaderboard.data ? "Country not found" : "Country history"}
        />
        <DataStatus datasets={[leaderboard]} />
        {leaderboard.data && (
          <p role="alert" className="status error">
            {iso
              ? `No country or group matches “${iso}”.`
              : "No country code given."}{" "}
            <Link href="/">Browse the leaderboard</Link>
          </p>
        )}
      </main>
    );
  const { row } = summary;
  return (
    <main id="main" className="entry-page">
      <Header
        title={
          <>
            {row.name}
            <QualityBadge quality={summary.quality} />
          </>
        }
        kicker={entryKicker(row)}
      />
      <EntrySummary summary={summary} />
      <section className="entry-history" aria-labelledby="entry-history-title">
        <h2 id="entry-history-title" className="entry-section-title">
          History, {YEAR_MIN}–{YEAR_MAX}
        </h2>
        <DataStatus datasets={[history]} />
        {history.data && (
          <div className="metric-grid">
            {metricDefs.map((metric) => (
              <HistoryChart
                key={metric.key}
                metric={metric}
                showMarkers={false}
                series={[{ iso, name: row.name, points: history.data.points }]}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function EntrySummary({ summary }) {
  const { row } = summary;
  const iso = encodeURIComponent(row.iso);
  return (
    <section
      className="entry-summary"
      aria-labelledby="entry-headline-label"
      style={{ "--tomer-color": tomerColor }}
    >
      <div className="entry-headline">
        <h2 id="entry-headline-label" className="entry-headline-label">
          {tomerColumn.label} · {YEAR_MAX}
        </h2>
        <p className="entry-headline-value">
          {tomerColumn.format(tomerColumn.value(row))}
        </p>
        <p className="entry-headline-rank">{rankLabel(summary)}</p>
        <p className="entry-headline-sources muted">
          Source years
          <SourceBadge
            row={row}
            sources={tomerColumn.sources}
            year={YEAR_MAX}
            compact
          />
        </p>
        <PillarBars row={row} />
      </div>
      <dl className="entry-stats">
        {statColumns.map((column) => (
          <div className="entry-stat" key={column.key} data-metric={column.key}>
            <dt className="entry-stat-label">{column.long}</dt>
            <dd>
              <MetricCell row={row} column={column} year={YEAR_MAX} />
            </dd>
          </div>
        ))}
      </dl>
      <nav className="entry-actions" aria-label={`More on ${row.name}`}>
        <Link className="btn primary" href={`/compare?picks=${iso}`}>
          Compare with others
        </Link>
        {!row.derivedKind && (
          <Link className="btn" href={`/map?iso=${iso}`}>
            View on map
          </Link>
        )}
        <Link className="btn" href="/">
          ← Back to the leaderboard
        </Link>
      </nav>
    </section>
  );
}
