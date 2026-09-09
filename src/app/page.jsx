import { Suspense } from "react";
import Leaderboard from "../components/leaderboard";
export default function Page() {
  return (
    <Suspense fallback={<p role="status">Loading leaderboard…</p>}>
      <Leaderboard />
    </Suspense>
  );
}
