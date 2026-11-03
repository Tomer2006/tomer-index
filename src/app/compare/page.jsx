import { Suspense } from "react";
import Compare, { CompareHeader } from "../../components/compare";
import { YEAR_MIN } from "../../site-years.js";
export const metadata = {
  title: "Compare countries",
  description: `Compare countries and World Bank groups side by side: Tomer index, rank, life expectancy, homicides, freedom, income, and their histories since ${YEAR_MIN}.`,
  alternates: { canonical: "/compare" },
};
export default function Page() {
  return (
    <Suspense
      fallback={
        <main id="main">
          <CompareHeader />
          <p role="status" className="status">
            Loading comparison…
          </p>
        </main>
      }
    >
      <Compare />
    </Suspense>
  );
}
