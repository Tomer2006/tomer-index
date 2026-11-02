"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  loadEntrySeries,
  loadLeaderboardData,
  loadSeriesData,
  loadWorldData,
  loadYearSnapshot,
} from "../data-loader.js";

const loaders = {
  leaderboard: loadLeaderboardData,
  series: loadSeriesData,
  world: loadWorldData,
  entry: loadEntrySeries,
  year: loadYearSnapshot,
};
const requests = new Map();
// Keys: "leaderboard", "series", "world", "entry:<ISO>" or "year:<YEAR>".
function request(key) {
  if (!requests.has(key)) {
    const [kind, id] = key.split(":");
    const pending = loaders[kind](id).catch((error) => {
      requests.delete(key);
      throw error;
    });
    requests.set(key, pending);
  }
  return requests.get(key);
}

/**
 * `data` belongs to the current key only; `stale` is the last data loaded for any
 * key, so a view can keep showing it while the next key (e.g. another year) loads.
 */
export function useDataset(key, enabled = true) {
  const [state, setState] = useState({ key: null, data: null, error: null, last: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    request(key).then(
      (data) => {
        if (active) setState({ key, data, error: null, last: data });
      },
      (error) => {
        if (active)
          setState((prev) => ({ key, data: null, error: error.message, last: prev.last }));
      },
    );
    return () => {
      active = false;
    };
  }, [key, enabled, attempt]);
  const current = state.key === key;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    stale: state.last,
    retry: () => {
      setState((prev) => ({ ...prev, key: null }));
      setAttempt((value) => value + 1);
    },
  };
}

/** Several datasets at once (e.g. one entry history per compare pick), keyed by key. */
export function useDatasets(keys, enabled = true) {
  const id = keys.join(",");
  const [state, setState] = useState({ id: null, values: null, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const list = id ? id.split(",") : [];
    Promise.all(list.map(request)).then(
      (values) => {
        if (active)
          setState({
            id,
            values: Object.fromEntries(list.map((key, i) => [key, values[i]])),
            error: null,
          });
      },
      (error) => {
        if (active) setState({ id, values: null, error: error.message });
      },
    );
    return () => {
      active = false;
    };
  }, [id, enabled, attempt]);
  const current = state.id === id;
  return {
    data: current ? state.values : null,
    error: current ? state.error : null,
    retry: () => {
      setState((prev) => ({ ...prev, id: null }));
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
    // Commas are valid in a query string; keep list values readable in shared links.
    const query = next.toString().replace(/%2C/gi, ",");
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }
  return [params, update];
}
