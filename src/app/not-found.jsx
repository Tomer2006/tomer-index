import Link from "next/link";
export default function NotFound() {
  return (
    <main className="py-12">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link href="/">Return to the leaderboard</Link>
    </main>
  );
}
