import { Suspense } from "react";
import Entry from "../../components/entry";
export const metadata = {
  title: "Entry history",
  description:
    "Per-country Tomer index history with charts for every input metric.",
};
export default function Page() {
  return (
    <Suspense fallback={<p role="status">Loading entry…</p>}>
      <Entry />
    </Suspense>
  );
}
