"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navigation() {
  const pathname = usePathname();
  return (
    <nav className="site-nav" aria-label="Main">
      {[
        ["/", "Leaderboard"],
        ["/compare", "Compare"],
        ["/map", "Map"],
        ["/methodology", "Methodology"],
        ["/downloads", "Downloads"],
      ].map(([href, label]) => (
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
  );
}
