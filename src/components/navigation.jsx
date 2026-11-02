"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SITE_NAME } from "../site.js";

const LINKS = [
  ["/", "Leaderboard"],
  ["/compare", "Compare"],
  ["/map", "Map"],
  ["/methodology", "Methodology"],
  ["/downloads", "Downloads"],
];

// Same drawing as public/favicon.svg.
function BrandMark() {
  return (
    <svg
      className="site-brand-mark"
      viewBox="0 0 64 64"
      width="24"
      height="24"
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="14" fill="#0f1218" />
      <polyline
        points="10,46 24,34 34,39 54,18"
        fill="none"
        stroke="#6ee7b7"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="54" cy="18" r="5" fill="#6ee7b7" />
    </svg>
  );
}

export default function Navigation() {
  const pathname = usePathname();
  const navRef = useRef(null);
  // On narrow screens the links scroll sideways; keep the current one in view.
  // (A script in the layout does this for the first page, before it paints.)
  useEffect(() => {
    const nav = navRef.current;
    const current = nav?.querySelector('[aria-current="page"]');
    if (current && nav.scrollWidth > nav.clientWidth)
      nav.scrollLeft =
        current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
  }, [pathname]);
  return (
    <header className="site-header">
      <Link href="/" className="site-brand">
        <BrandMark />
        {SITE_NAME}
      </Link>
      <nav className="site-nav" aria-label="Main" ref={navRef}>
        {LINKS.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className="site-nav-link"
            aria-current={pathname === href ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
