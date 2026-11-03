import "./globals.css";
import Navigation from "../components/navigation";
import SiteFooter from "../components/site-footer";
import { scoredCountries } from "../leaderboard-file.js";
import { SITE_NAME, SITE_URL } from "../site.js";
import { YEAR_MAX, YEAR_MIN } from "../site-years.js";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s — ${SITE_NAME}` },
  description: `An index of abundance, safety, health, and freedom for ${scoredCountries().length} countries, ${YEAR_MIN}–${YEAR_MAX}, where 100 means every goalpost is met and scores can go past 100 or below 0. Interactive leaderboard, world map, and country comparisons.`,
  icons: {
    icon: { url: "/favicon.svg", type: "image/svg+xml" },
    apple: { url: "/apple-icon", sizes: "180x180", type: "image/png" },
  },
  // No title/description here: each page's own title and description flow
  // into og:* and twitter:* (a page-level openGraph would drop the image).
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US" },
};

export const viewport = { themeColor: "#0f1218", colorScheme: "dark" };

// On phones the nav links scroll sideways. Center the current page's link while the
// HTML is parsed, before the first paint, so the row doesn't jump when the page
// becomes interactive (Navigation's effect does the same on later page changes).
const CENTER_CURRENT_NAV_LINK = `(() => {
  const nav = document.querySelector(".site-nav");
  const current = nav?.querySelector('[aria-current="page"]');
  if (current && nav.scrollWidth > nav.clientWidth)
    nav.scrollLeft = current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div id="app">
          <Navigation />
          <script dangerouslySetInnerHTML={{ __html: CENTER_CURRENT_NAV_LINK }} />
          <div className="site-page">{children}</div>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
