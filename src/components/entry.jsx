"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useDataset, useQuery } from "./hooks";
import {
  Header,
  DataStatus,
  MetricCell,
  QualityBadge,
  PillarBars,
} from "./shared";
import HistoryChart from "./history-chart";
import { columns } from "../view-model.js";
import { metricDefs } from "../metric-defs.js";
import { dataQualityForRow } from "../data-quality.js";
import { YEAR_MAX } from "../site-years.js";

export default function Entry() {
  const [params] = useQuery();
  const iso = (params.get("iso") ?? "").trim().toUpperCase();
  const leaderboard = useDataset("leaderboard"),
    history = useDataset("series");
  const datasets = [leaderboard, history],
    countries = leaderboard.data?.countries ?? [],
    series = history.data?.entrySeries ?? {};
  const row = countries.find((row) => row.iso === iso),
    points = series[iso]?.points ?? [];
  useEffect(() => {
    if (row) document.title = `${row.name} history — Tomer index`;
  }, [row]);
  return (
    <>
      <Header
        title={
          row ? (
            <>
              {row.name}
              <QualityBadge
                quality={dataQualityForRow(
                  row,
                  series,
                  leaderboard.data?.qualityByIso,
                )}
              />
            </>
          ) : (
            "Entry history"
          )
        }
        kicker={
          row ? `${row.derivedKind ?? iso} history` : "Tomer index history"
        }
      />
      <DataStatus datasets={datasets} />
      {datasets.every((dataset) => dataset.data) &&
        (!row ? (
          <p role="alert" className="status error">
            {iso
              ? `No leaderboard entry found for ${iso}.`
              : "Missing entry id."}{" "}
            <Link href="/">Choose an entry</Link>
          </p>
        ) : (
          <main className="entry-page">
            <div className="entry-latest">
              <section className="entry-summary">
                <div>
                  <h2 className="entry-summary-title">
                    Latest leaderboard values
                  </h2>
                  <p className="entry-summary-sub muted">
                    Series through {points.at(-1)?.year ?? YEAR_MAX}
                    {points.at(-1)?.n ? ` · ${points.at(-1).n} members` : ""}
                  </p>
                </div>
                <div className="entry-stats">
                  <div className="entry-stat">
                    <span className="entry-stat-label">Rank</span>
                    <strong>
                      {countries.findIndex((item) => item.iso === iso) + 1}
                    </strong>
                  </div>
                  {columns.map((column) => (
                    <div className="entry-stat" key={column.key}>
                      <span className="entry-stat-label">{column.label}</span>
                      <strong>
                        <MetricCell row={row} column={column} year={YEAR_MAX} />
                      </strong>
                    </div>
                  ))}
                </div>
                <PillarBars row={row} />
              </section>
            </div>
            <div className="metric-grid">
              {metricDefs.map((metric) => (
                <HistoryChart
                  key={metric.key}
                  metric={metric}
                  series={[{ iso, name: row.name, points }]}
                />
              ))}
            </div>
          </main>
        ))}
    </>
  );
}
