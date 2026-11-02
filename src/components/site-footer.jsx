import Link from "next/link";
import { readLeaderboardFile } from "../leaderboard-file.js";
import { REPO_URL } from "../site.js";

const SOURCES = [
  ["World Bank Open Data", "https://data.worldbank.org/"],
  ["WHO Global Health Observatory", "https://www.who.int/data/gho"],
  ["Cato Human Freedom Index", "https://www.cato.org/human-freedom-index/2025"],
];

// Server component: the data date is read once while prerendering.
export default function SiteFooter() {
  const { generatedAt } = readLeaderboardFile();
  const updated = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(generatedAt));
  return (
    <footer className="site-footer">
      <div className="site-footer-text">
        <p>
          Data:{" "}
          {SOURCES.map(([label, href], index) => (
            <span key={href}>
              {index ? " · " : ""}
              <a href={href}>{label}</a>
            </span>
          ))}
          . Data updated <time dateTime={generatedAt}>{updated}</time>.
        </p>
        <p>
          A personal composite index, not endorsed by UNDP, the World Bank,
          WHO, Cato Institute or Fraser Institute.
        </p>
      </div>
      <nav className="site-footer-links" aria-label="Footer">
        <Link href="/methodology">Methodology</Link>
        <Link href="/downloads">Downloads</Link>
        <a href={REPO_URL}>Source on GitHub</a>
      </nav>
    </footer>
  );
}
