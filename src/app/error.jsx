"use client";
import { useEffect } from "react";
import Link from "next/link";
import { Header } from "../components/shared";

export default function ErrorPage({ error, retry }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="status-page">
      <Header title="Something went wrong" kicker="Error">
        <p className="lede">
          Something went wrong loading this page. It may be a temporary
          problem, so try again, or continue from another page.
        </p>
      </Header>
      <div className="status-page-links">
        <button className="btn primary" onClick={() => retry()}>
          Try again
        </button>
        <Link className="btn" href="/">
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
      </div>
    </main>
  );
}
