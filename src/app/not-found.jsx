import Link from "next/link";
import { Header } from "../components/shared";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main id="main" className="status-page">
      <Header title="Page not found" kicker="Error 404">
        <p className="lede">
          There’s no page at this address. It may have moved, or the link may
          have a typo. Try one of these instead:
        </p>
      </Header>
      <nav className="status-page-links" aria-label="Suggested pages">
        <Link className="btn primary" href="/">
          Leaderboard
        </Link>
        <Link className="btn" href="/map">
          World map
        </Link>
        <Link className="btn" href="/compare">
          Compare countries
        </Link>
        <Link className="btn" href="/methodology">
          Methodology
        </Link>
      </nav>
    </main>
  );
}
