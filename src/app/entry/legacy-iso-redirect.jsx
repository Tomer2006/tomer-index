"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { entryHref, readIso } from "../../view-model.js";

// next.config.mjs redirects /entry?iso=JPN; redirects can't change case, so
// older lowercase links (/entry?iso=jpn) are upper-cased here.
export default function LegacyIsoRedirect() {
  const router = useRouter();
  const iso = readIso(useSearchParams());
  useEffect(() => {
    if (iso) router.replace(entryHref(iso));
  }, [iso, router]);
  return iso ? (
    <p role="status" className="status">
      Opening {iso}…
    </p>
  ) : null;
}
