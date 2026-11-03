import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { formatTomer } from "../index-scale.js";
import { scoredCountries } from "../leaderboard-file.js";
import { SITE_NAME, SITE_URL } from "../site.js";
import { YEAR_MAX, YEAR_MIN } from "../site-years.js";
import { TOPIC_COLORS } from "../topic-colors.js";

// Built once at build time from the committed data.
const countries = scoredCountries();
const top = countries.slice(0, 5);
const mark = `data:image/svg+xml;base64,${readFileSync(
  join(process.cwd(), "public", "favicon.svg"),
).toString("base64")}`;

export const alt = `${SITE_NAME}: abundance, safety, health, and freedom scores for ${countries.length} countries, ${YEAR_MIN}–${YEAR_MAX}. Top 5 in ${YEAR_MAX}: ${top.map((row) => row.name).join(", ")}.`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PILLARS = [
  ["Abundance", TOPIC_COLORS.abundance],
  ["Safety", TOPIC_COLORS.safety],
  ["Health", TOPIC_COLORS.health],
  ["Freedom", TOPIC_COLORS.freedom],
];

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 48,
        padding: "64px 72px",
        color: "#e8ecf4",
        backgroundColor: "#0f1218",
        backgroundImage:
          "radial-gradient(circle at 10% -10%, #1a2336 0%, #0f1218 60%)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontSize: 24,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: "#34d399",
          }}
        >
          <img src={mark} width={48} height={48} alt="" />
          {`Leaderboard · ${YEAR_MAX}`}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 24,
            fontSize: 104,
            letterSpacing: -3,
            lineHeight: 1,
          }}
        >
          {SITE_NAME}
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 40, fontSize: 32 }}>
          {PILLARS.map(([label, color], index) => (
            <div key={label} style={{ display: "flex", gap: 14 }}>
              {index ? <span style={{ color: "#4b5568" }}>·</span> : null}
              <span style={{ color }}>{label}</span>
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 20,
            fontSize: 28,
            color: "#8b95a8",
          }}
        >
          {`An index with no ceiling or floor for ${countries.length} countries, ${YEAR_MIN}–${YEAR_MAX}`}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 56,
            fontSize: 24,
            color: "#8b95a8",
          }}
        >
          {SITE_URL.replace(/^https:\/\//, "")}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: 360,
          padding: "28px 32px",
          border: "2px solid #2a3142",
          borderRadius: 20,
          backgroundColor: "#171b24",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 20,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: "#8b95a8",
            marginBottom: 12,
          }}
        >
          {`Top 5 in ${YEAR_MAX}`}
        </div>
        {top.map((row, index) => (
          <div
            key={row.iso}
            style={{
              display: "flex",
              alignItems: "baseline",
              padding: "12px 0",
              borderTop: index ? "1px solid #2a3142" : "none",
              fontSize: 28,
            }}
          >
            <span style={{ width: 40, color: "#8b95a8" }}>{index + 1}</span>
            <span style={{ flex: 1 }}>{row.name}</span>
            <span style={{ color: "#a78bfa" }}>
              {formatTomer(row.customIndex)}
            </span>
          </div>
        ))}
      </div>
    </div>,
    size,
  );
}
