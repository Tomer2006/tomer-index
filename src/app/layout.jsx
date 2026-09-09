import "./globals.css";
import Navigation from "../components/navigation";

export const metadata = {
  title: { default: "Tomer index", template: "%s — Tomer index" },
  description:
    "Abundance, safety, health, and freedom for every country, 2000–2024. Interactive leaderboard, world map, and country comparisons.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "Tomer index",
    description:
      "A composite of abundance, safety, health, and freedom for every country, 2000–2024.",
    type: "website",
    siteName: "Tomer index",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div id="app">
          <Navigation />
          {children}
        </div>
      </body>
    </html>
  );
}
