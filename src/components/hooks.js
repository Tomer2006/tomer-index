"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  loadLeaderboardData,
  loadSeriesData,
  loadWorldData,
} from "../data-loader.js";

const loaders = {
  leaderboard: loadLeaderboardData,
  series: loadSeriesData,
  world: loadWorldData,
};
const requests = new Map();
export function useDataset(kind, enabled = true) {
  const [state, setState] = useState({ data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    if (!requests.has(kind)) {
      const request = loaders[kind]().catch((error) => {
        requests.delete(kind);
        throw error;
      });
      requests.set(kind, request);
    }
    requests.get(kind).then(
      (data) => {
        if (active) setState({ data, error: null });
      },
      (error) => {
        if (active) setState({ data: null, error: error.message });
      },
    );
    return () => {
      active = false;
    };
  }, [kind, enabled, attempt]);
  return {
    ...state,
    retry: () => {
      setState({ data: null, error: null });
      setAttempt((value) => value + 1);
    },
  };
}

// Next's native history integration keeps URL state and client navigation in sync.
export function useQuery() {
  const params = useSearchParams();
  function update(values) {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === undefined || value === "")
        next.delete(key);
      else next.set(key, String(value));
    }
    const query = next.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }
  return [params, update];
}
