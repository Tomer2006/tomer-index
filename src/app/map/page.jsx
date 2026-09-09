import { Suspense } from "react";
import WorldMap from "../../components/world-map";
export const metadata = {
  title: "Map",
  description: "Choropleth world map of the Tomer index by country, 2000–2024.",
};
export default function Page() {
  return (
    <Suspense fallback={<p role="status">Loading map…</p>}>
      <WorldMap />
    </Suspense>
  );
}
