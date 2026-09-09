import { Suspense } from "react";
import Compare from "../../components/compare";
export const metadata = {
  title: "Compare",
  description:
    "Compare countries side by side on the Tomer index and explore their histories.",
};
export default function Page() {
  return (
    <Suspense fallback={<p role="status">Loading comparison…</p>}>
      <Compare />
    </Suspense>
  );
}
