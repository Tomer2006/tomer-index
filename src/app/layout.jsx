import "./globals.css";
import Navigation from "../components/navigation";
import SiteFooter from "../components/site-footer";
import { scoredCountries } from "../leaderboard-file.js";
import { SITE_NAME, SITE_URL } from "../site.js";
import { YEAR_MAX, YEAR_MIN } from "../site-years.js";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s — ${SITE_NAME}` },
  description: `A 0–100 index of abundance, safety, health, and freedom for ${scoredCountries().length} countries, ${YEAR_MIN}–${YEAR_MAX}. Interactive leaderboard, world map, and country comparisons.`,
  icons: {
    icon: { url: "/favicon.svg", type: "image/svg+xml" },
    apple: { url: "/apple-icon", sizes: "180x180", type: "image/png" },
  },
  // No title/description here: each page's own title and description flow
  // into og:* and twitter:* (a page-level openGraph would drop the image).
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US" },
};

export const viewport = { themeColor: "#0f1218", colorScheme: "dark" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div id="app">
          <Navigation />
          <div className="site-page">{children}</div>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
