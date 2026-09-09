"use client";
export default function ErrorPage({ reset }) {
  return (
    <main className="py-12">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <button className="btn mt-4" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
