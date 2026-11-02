"use client";
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { geoEqualEarth, geoPath } from "d3-geo";
import { select as selectElement } from "d3-selection";
import { zoom, zoomIdentity, zoomTransform } from "d3-zoom";
import { useDataset, useQuery } from "./hooks";
import {
  Header,
  DataStatus,
  YearControl,
  Weights,
  MetricCell,
  QualityBadge,
} from "./shared";
import {
  readYear,
  readWeights,
  readIso,
  weightQuery,
  isCustomWeights,
  rowsForSnapshot,
  columns,
  entryHref,
  tomerRanks,
} from "../view-model.js";
import {
  DEFAULT_WEIGHT_POINTS,
  weightedIndexFromPillars,
} from "../index-weights.js";
import { formatTomer, formatTomerAxis } from "../index-scale.js";
import { dataQualityForRow } from "../data-quality.js";
import { metricDefs } from "../metric-defs.js";
import { YEAR_MAX } from "../site-years.js";

const COLORS = [
  "#3b0f70",
  "#5c01a6",
  "#8b0aa5",
  "#b83289",
  "#db5c68",
  "#f48849",
  "#febd2a",
  "#f0f921",
];
const NO_DATA_FILL = "url(#map-no-data)";
const MAX_ZOOM = 8;
const path = geoPath(
  geoEqualEarth().fitExtent([[18, 18], [942, 482]], { type: "Sphere" }),
);
const SPHERE = path({ type: "Sphere" });
// Island states smaller than this (map px² at 100%) also get a dot so they can be seen and clicked.
const TINY_AREA = 3;
// A dot goes once its country's own shape is this big on screen (px²) and can be clicked itself.
const CLICKABLE_AREA = 100;
// Dot diameter on screen (px): it grows with the map up to the full size, from a floor.
const DOT_SIZE = 7,
  MIN_DOT_SIZE = 4;
// The latest year's view comes from the leaderboard; past years come from a snapshot.
const LATEST_VIEW = { year: YEAR_MAX, snapshot: null };
const tomerColor = metricDefs.find((metric) => metric.key === "customIndex").color;
const PUBLISHED_WEIGHTS = Object.entries(DEFAULT_WEIGHT_POINTS)
  .map(([key, value]) => `${key} ${value}%`)
  .join(", ");
const quantile = (sorted, probability) => {
  const position = (sorted.length - 1) * probability,
    lower = Math.floor(position);
  return (
    sorted[lower] +
    (position - lower) * ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower])
  );
};
const fold = (text) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase();
/**
 * "Find a country" on Enter: the country with that exact ISO code or name, otherwise
 * every country whose name starts with the text (one match is a unique prefix).
 */
function findCountries(countries, query) {
  const needle = fold(query);
  const exact =
    countries.find((row) => row.iso.toLowerCase() === needle) ??
    countries.find((row) => fold(row.name) === needle);
  return exact
    ? [exact]
    : countries.filter((row) => fold(row.name).startsWith(needle));
}
/** Vertex keys of a GeoJSON polygon or multipolygon. */
const vertexKeys = (geometry) =>
  (geometry?.type === "Polygon"
    ? [geometry.coordinates]
    : (geometry?.coordinates ?? [])
  )
    .flat(2)
    .map((point) => point.join());

/** Hover card; owns its state so pointer moves don't re-render the map. */
function MapTooltip({ ref, describe }) {
  const [hover, setHover] = useState(null);
  useImperativeHandle(
    ref,
    () => ({
      show: (next) =>
        setHover((prev) =>
          prev?.iso === next.iso &&
          Math.abs(prev.left - next.left) < 2 &&
          Math.abs(prev.top - next.top) < 2
            ? prev
            : next,
        ),
      hide: () => setHover(null),
    }),
    [],
  );
  if (!hover) return null;
  const { name, scoreText, quality } = describe(hover.iso);
  return (
    <div
      className="map-tooltip"
      style={{ left: hover.left, top: hover.top }}
      aria-hidden="true"
    >
      <strong>{name}</strong>
      <span>{scoreText}</span>
      {quality && <span className="map-tooltip-quality">{quality.label}</span>}
    </div>
  );
}

function MapLegend({ paint, year, loadingYear, failedYear, custom, status }) {
  const { values, breaks } = paint;
  const stops = values.length ? [values[0], ...breaks, values.at(-1)] : [];
  return (
    <div className="map-legend" role="group" aria-label="Color legend">
      <p className="map-legend-note">
        {stops.length ? (
          <>
            Colors split {year}’s
            {custom && (
              <>
                {" "}
                <strong>Custom index</strong>
              </>
            )}{" "}
            scores into {COLORS.length} equal-sized groups
          </>
        ) : (
          status
        )}
        {loadingYear && stops.length > 0 && (
          <span className="map-legend-loading" role="status">
            Loading {loadingYear}…
          </span>
        )}
        {failedYear && stops.length > 0 && (
          <span className="map-legend-loading">
            {failedYear} couldn’t be loaded
          </span>
        )}
      </p>
      {stops.length > 0 && (
        <div className="map-legend-scale">
          <ol className="map-legend-bar">
            {COLORS.map((color, i) => (
              <li
                className="map-legend-stop"
                key={color}
                style={{ background: color }}
              >
                <span className="visually-hidden">
                  {formatTomerAxis(stops[i])} to {formatTomerAxis(stops[i + 1])}
                </span>
              </li>
            ))}
          </ol>
          <div className="map-legend-ticks" aria-hidden="true">
            {stops.map((value, i) => (
              <span key={i} style={{ left: `${(i / COLORS.length) * 100}%` }}>
                {formatTomerAxis(value)}
              </span>
            ))}
          </div>
        </div>
      )}
      <ul className="map-legend-keys">
        <li className="map-legend-key map-legend-key-empty">No data</li>
        <li className="map-legend-key map-legend-key-incomplete">History gaps</li>
      </ul>
      {custom && (
        <p className="map-legend-custom">
          Custom index uses your weights; the published Tomer index uses{" "}
          {PUBLISHED_WEIGHTS}.
        </p>
      )}
      <p className="map-view-hint map-view-hint-touch">Pinch to zoom</p>
    </div>
  );
}

/** Headline score for the selected country (side panel and fullscreen card). */
function ScoreLine({ score, fill, label, rank, total }) {
  if (!Number.isFinite(score))
    return <p className="map-detail-score muted">Not scored for this year</p>;
  return (
    <p className="map-detail-score">
      <span className="map-detail-pill">
        <i
          className="map-detail-swatch"
          style={{ background: fill }}
          aria-hidden="true"
        />
        {label} <strong>{formatTomer(score)}</strong>
      </span>
      {rank && (
        <span className="map-detail-rank">
          Rank {rank} of {total}
        </span>
      )}
    </p>
  );
}

export default function WorldMap() {
  const [params, update] = useQuery();
  const year = readYear(params),
    weights = readWeights(params),
    iso = readIso(params);
  const weightKey = Object.values(weights).join(",");
  const custom = isCustomWeights(weights),
    label = custom ? "Custom index" : "Tomer index";
  const [search, setSearch] = useState(null),
    [searchMessage, setSearchMessage] = useState(""),
    [announcement, setAnnouncement] = useState("");
  const mapRef = useRef(null),
    viewportRef = useRef(null),
    svgRef = useRef(null),
    geographyRef = useRef(null),
    zoomRef = useRef(null),
    tooltipRef = useRef(null),
    detailRef = useRef(null),
    focusDetail = useRef(false),
    fullscreenRef = useRef(false),
    fullscreenButtonRef = useRef(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  // On-screen px per map px at 100% zoom.
  const [mapScale, setMapScale] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const pastYear = year !== YEAR_MAX;
  const leaderboard = useDataset("leaderboard"),
    world = useDataset("world"),
    snapshot = useDataset(`year:${year}`, pastYear);
  const statusDatasets = [
    leaderboard,
    world,
    ...(pastYear && snapshot.error ? [snapshot] : []),
  ];
  const loadingYear = pastYear && !snapshot.data && !snapshot.error ? year : null,
    failedYear = pastYear && snapshot.error ? year : null;
  // While another year loads, or if it fails (the alert offers Retry), keep painting the
  // view that was on screen; the legend names its year.
  const requested = !pastYear
    ? LATEST_VIEW
    : snapshot.data
      ? { year, snapshot: snapshot.data }
      : null;
  const [lastShown, setLastShown] = useState(LATEST_VIEW);
  if (
    requested &&
    (requested.year !== lastShown.year ||
      requested.snapshot !== lastShown.snapshot)
  )
    setLastShown(requested);
  const shown = requested ?? lastShown;
  const shownYear = shown.year;

  // Zoom is set up once; data changes never reset the user's view.
  useEffect(() => {
    const svg = selectElement(svgRef.current);
    const behavior = zoom()
      .extent([[0, 0], [960, 500]])
      .translateExtent([[0, 0], [960, 500]])
      .scaleExtent([1, MAX_ZOOM])
      .clickDistance(5)
      // One-finger touches scroll the page until the map is zoomed in (or fullscreen).
      .filter(function (event) {
        if (event.type === "touchstart")
          return (
            event.touches.length > 1 ||
            zoomTransform(this).k > 1 ||
            fullscreenRef.current
          );
        return (!event.ctrlKey || event.type === "wheel") && !event.button;
      })
      .on("start", () => tooltipRef.current?.hide())
      .on("zoom", (event) => {
        geographyRef.current?.setAttribute(
          "transform",
          event.transform.toString(),
        );
        setZoomLevel(event.transform.k);
      });
    zoomRef.current = behavior;
    svg.call(behavior).call(behavior.transform, zoomIdentity);
    return () => {
      svg.on(".zoom", null);
      zoomRef.current = null;
    };
  }, []);
  useEffect(() => {
    const svg = svgRef.current;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const { width, height } = svg.getBoundingClientRect();
      if (width && height) setMapScale(Math.min(width / 960, height / 500));
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    fullscreenRef.current = fullscreen;
    // The search box moves in and out of the fullscreen view; start it fresh.
    setSearch(null);
    setSearchMessage("");
  }, [fullscreen]);
  useEffect(() => {
    const sync = () => {
      setFullscreen(document.fullscreenElement === mapRef.current);
      if (!document.fullscreenElement) fullscreenButtonRef.current?.focus();
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event) => {
      if (event.key === "Escape" && !document.fullscreenElement) {
        setFullscreen(false);
        fullscreenButtonRef.current?.focus();
      }
      if (event.key === "Tab") {
        const targets = [...mapRef.current.querySelectorAll('button:not(:disabled), input, a[href], [tabindex="0"]')];
        const first = targets[0], last = targets.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);
  useEffect(() => {
    if (!focusDetail.current) return;
    focusDetail.current = false;
    detailRef.current?.focus();
  }, [iso]);
  const changeZoom = (factor) => {
    if (zoomRef.current) selectElement(svgRef.current).call(zoomRef.current.scaleBy, factor);
  };
  const resetView = () => {
    if (zoomRef.current) selectElement(svgRef.current).call(zoomRef.current.transform, zoomIdentity);
  };
  const toggleFullscreen = async () => {
    if (fullscreen) {
      if (document.fullscreenElement === mapRef.current) await document.exitFullscreen();
      setFullscreen(false);
      return;
    }
    // Browsers without the Fullscreen API (iOS Safari) get the CSS overlay only.
    if (mapRef.current.requestFullscreen) {
      try {
        await mapRef.current.requestFullscreen();
        if (window.matchMedia?.("(pointer: coarse)").matches)
          screen.orientation?.lock?.("landscape")?.catch(() => {});
      } catch { /* Fall back to the CSS overlay. */ }
    }
    setFullscreen(true);
  };

  const countries = leaderboard.data?.countries,
    qualityByIso = leaderboard.data?.qualityByIso;
  const countryList = useMemo(
    () =>
      (countries ?? [])
        .filter((row) => !row.derivedKind)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [countries],
  );
  const known = useMemo(
    () => new Set(countryList.map((row) => row.iso)),
    [countryList],
  );
  const searchOptions = useMemo(
    () =>
      countryList.map((row) => (
        <option key={row.iso} value={row.name}>
          {row.iso}
        </option>
      )),
    [countryList],
  );
  const rows = useMemo(
    () =>
      (shown.snapshot
        ? rowsForSnapshot(countryList, shown.snapshot, shownYear)
        : countryList),
    [countryList, shown.snapshot, shownYear],
  );
  const byIso = useMemo(
    () => new Map(rows.map((row) => [row.iso, row])),
    [rows],
  );
  // weightKey stands in for the weights object, which is rebuilt every render.
  const paint = useMemo(() => {
    const scores = new Map(
      rows.map((row) => [row.iso, weightedIndexFromPillars(row, weights)]),
    );
    const values = [...scores.values()]
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const breaks = values.length
      ? COLORS.slice(1).map((_, i) => quantile(values, (i + 1) / COLORS.length))
      : [];
    const fill = (value) => {
      if (!Number.isFinite(value)) return NO_DATA_FILL;
      const band = breaks.findIndex((limit) => value <= limit);
      return COLORS[band === -1 ? COLORS.length - 1 : band];
    };
    return { scores, values, breaks, fill };
  }, [rows, weightKey]);
  const ranks = useMemo(() => tomerRanks(rows, weights), [rows, weightKey]);
  const shapes = useMemo(() => {
    const features = (world.data?.features ?? []).filter(
      (feature) => feature.id !== "ATA",
    );
    // Neighbours share border vertices, so a vertex used twice is a land border.
    const vertexUses = new Map();
    for (const feature of features)
      for (const key of new Set(vertexKeys(feature.geometry)))
        vertexUses.set(key, (vertexUses.get(key) ?? 0) + 1);
    return features.map((feature, i) => {
      const area = path.area(feature),
        center = path.centroid(feature);
      return {
        iso: feature.id,
        name: feature.properties?.name ?? feature.id ?? "Unknown",
        key: `${feature.id}-${i}`,
        d: path(feature),
        center,
        area,
        // States with a land border get no dot: it would sit on a neighbour.
        dotted:
          area < TINY_AREA &&
          center.every(Number.isFinite) &&
          !vertexKeys(feature.geometry).some((key) => vertexUses.get(key) > 1),
      };
    });
  }, [world.data]);
  // Memoized so hover and zoom never re-render the ~180 country paths.
  const countryShapes = useMemo(
    () =>
      shapes.map((shape) => {
        const score = paint.scores.get(shape.iso);
        const quality = dataQualityForRow(byIso.get(shape.iso), null, qualityByIso);
        return (
          <path
            key={shape.key}
            d={shape.d}
            data-iso={shape.iso}
            fill={paint.fill(score)}
            className={`map-country${Number.isFinite(score) ? "" : " is-no-data"}${quality ? " is-incomplete" : ""}${shape.dotted ? " is-dotted" : ""}`}
          />
        );
      }),
    [shapes, byIso, paint, qualityByIso],
  );
  // Dots sit under the country shapes, so they only show (and take clicks) over the
  // sea and never cover a neighbour. They grow with the map up to DOT_SIZE.
  const screenScale = zoomLevel * mapScale;
  const dotSize = Math.max(MIN_DOT_SIZE, Math.min(DOT_SIZE, DOT_SIZE * screenScale));
  const dots = useMemo(
    () =>
      shapes
        .filter(
          (shape) =>
            shape.dotted &&
            byIso.has(shape.iso) &&
            shape.area * screenScale ** 2 < CLICKABLE_AREA,
        )
        .flatMap((shape) => {
          const score = paint.scores.get(shape.iso);
          // A zero-length line with round caps and a non-scaling stroke is a dot.
          const dot = `M${shape.center[0]},${shape.center[1]}h0`;
          return [
            <path key={`${shape.key}-halo`} d={dot} className="map-dot-halo" />,
            <path
              key={`${shape.key}-dot`}
              d={dot}
              data-iso={shape.iso}
              className="map-dot"
              stroke={Number.isFinite(score) ? paint.fill(score) : "#465269"}
            />,
          ];
        }),
    [shapes, byIso, paint, screenScale],
  );

  const selected = byIso.get(iso),
    selectedShape = shapes.find((shape) => shape.iso === iso),
    selectedName =
      selected?.name ??
      countryList.find((row) => row.iso === iso)?.name ??
      selectedShape?.name ??
      iso;
  const scoreOf = (code) => paint.scores.get(code);
  const describe = (code) => {
    const row = byIso.get(code),
      score = scoreOf(code);
    return {
      name:
        row?.name ?? shapes.find((shape) => shape.iso === code)?.name ?? code,
      scoreText: Number.isFinite(score)
        ? `${label}: ${formatTomer(score)}`
        : known.has(code)
          ? `Not scored for ${shownYear}`
          : "Not scored",
      quality: dataQualityForRow(row, null, qualityByIso),
    };
  };
  const select = (value, { focus = false } = {}) => {
    update({ iso: value });
    tooltipRef.current?.hide();
    if (focus) {
      focusDetail.current = value !== iso;
      if (value === iso) detailRef.current?.focus();
      setAnnouncement("");
    } else if (value) {
      const { name, scoreText } = describe(value);
      setAnnouncement(`${name} selected. ${scoreText}.`);
    }
  };
  const findCountry = () => {
    const query = search ?? "";
    if (!query.trim()) return;
    // Unscored land on the map can be found too; its panel says it isn't scored.
    const matches = findCountries(
      [...countryList, ...shapes.filter((shape) => !known.has(shape.iso))],
      query,
    );
    if (matches.length === 1) {
      setSearch(null);
      setSearchMessage("");
      // The side panel is hidden in fullscreen: stay in the box and announce the pick.
      select(matches[0].iso, { focus: !fullscreen });
    } else {
      // The list only offers scored countries.
      const listed = matches.some((row) => known.has(row.iso));
      setSearchMessage(
        matches.length
          ? `${matches.length} countries start with “${query.trim()}”. Keep typing${listed ? " or pick one from the list" : ""}.`
          : `No country matches “${query.trim()}”.`,
      );
    }
  };
  const showTooltip = (event) => {
    if (event.buttons || event.pointerType === "touch") return;
    const code = event.target.getAttribute?.("data-iso");
    if (!code) return tooltipRef.current?.hide();
    const rect = viewportRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left,
      y = event.clientY - rect.top;
    tooltipRef.current?.show({
      iso: code,
      left: Math.max(8, Math.min(x + 14, rect.width - 200)),
      top: y > rect.height - 100 ? Math.max(8, y - 90) : y + 16,
    });
  };
  const selectedScore = scoreOf(iso),
    selectedQuality = dataQualityForRow(selected, null, qualityByIso),
    scoreLine = (
      <ScoreLine
        score={selectedScore}
        fill={paint.fill(selectedScore)}
        label={label}
        rank={ranks.ranks.get(iso)}
        total={ranks.total}
      />
    );
  const inLeaderboard = known.has(iso);
  const historyLink = inLeaderboard && (
    <Link className="map-detail-link" href={entryHref(iso)}>
      View history →
    </Link>
  );
  const ready = Boolean(leaderboard.data && world.data);
  // One search box: in the side controls, or in the map's toolbar while fullscreen
  // (the only part of the page that is shown and reachable by keyboard then).
  const searchBox = (
    <div className="map-search">
      <label className="search-control map-search-control">
        <span className={fullscreen ? "visually-hidden" : "control-label"}>
          Find a country
        </span>
        <input
          type="search"
          id="map-search"
          list="map-search-list"
          placeholder={fullscreen ? "Find a country…" : "Country or ISO code…"}
          autoComplete="off"
          aria-describedby="map-search-status"
          value={search ?? (iso ? selectedName : "")}
          onChange={(event) => {
            const value = event.target.value;
            setSearch(value);
            setSearchMessage("");
            // Only an exact name (what a datalist pick produces) selects while typing.
            const row = countryList.find(
              (row) => value.trim() && fold(row.name) === fold(value),
            );
            if (row) select(row.iso);
            else if (!value) select("");
          }}
          onKeyDown={(event) => {
            // Escape leaves fullscreen; don't let it also clear the box (and the selection).
            if (event.key === "Escape" && fullscreen) event.preventDefault();
            if (event.key !== "Enter") return;
            event.preventDefault();
            findCountry();
          }}
          onBlur={() => {
            setSearch(null);
            setSearchMessage("");
          }}
        />
        <datalist id="map-search-list">{searchOptions}</datalist>
      </label>
      <p
        id="map-search-status"
        className="map-search-status"
        aria-live="polite"
      >
        {searchMessage}
      </p>
    </div>
  );
  return (
    <main
      id="main"
      className="map-main"
      style={{ "--tomer-color": tomerColor }}
    >
      <Header title="Tomer index by country" kicker="World map" />
      <div className="map-page">
        <section className="map-controls" aria-label="Map controls">
          <YearControl
            id="map-year-slider"
            year={year}
            onChange={(value) =>
              update({ year: value === YEAR_MAX ? null : value })
            }
          />
          {!fullscreen && searchBox}
        </section>
        <div
          ref={mapRef}
          className={`map-wrap${fullscreen ? " is-fullscreen" : ""}${shownYear !== year ? " is-stale" : ""}`}
        >
          <div className="map-toolbar" role="group" aria-label="Map view controls">
            {fullscreen && searchBox}
            <span className="map-zoom-group">
              <button className="btn" onClick={() => changeZoom(1 / 1.5)} disabled={zoomLevel <= 1} aria-label="Zoom out">−</button>
              <output aria-label="Map zoom">{Math.round(zoomLevel * 100)}%</output>
              <button className="btn" onClick={() => changeZoom(1.5)} disabled={zoomLevel >= MAX_ZOOM} aria-label="Zoom in">+</button>
            </span>
            <button className="btn" onClick={resetView} aria-label="Reset view">Reset</button>
            <button
              ref={fullscreenButtonRef}
              className="btn"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {fullscreen ? "Exit" : "Fullscreen"}
            </button>
          </div>
          <div ref={viewportRef} className="map-viewport">
            {zoomLevel <= 1 && (
              <p className="map-view-hint map-view-hint-mouse">
                Scroll or pinch to zoom · drag to pan
              </p>
            )}
            <svg
              ref={svgRef}
              viewBox="0 0 960 500"
              className={`map-svg-root${zoomLevel > 1 ? " is-zoomed" : ""}`}
              role="application"
              aria-roledescription="map"
              aria-label={`Equal Earth world map of the ${label}, ${shownYear}. Use plus and minus to zoom, arrow keys to pan, and Home to reset. To select a country, use Find a country.`}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (["+", "=", "-", "Home", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                  event.preventDefault();
                  if (["+", "="].includes(event.key)) changeZoom(1.5);
                  else if (event.key === "-") changeZoom(1 / 1.5);
                  else if (event.key === "Home") resetView();
                  else if (zoomRef.current) {
                    const k = zoomTransform(svgRef.current).k;
                    const [x, y] = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] }[event.key];
                    selectElement(svgRef.current).call(zoomRef.current.translateBy, x / k, y / k);
                  }
                }
              }}
              onPointerLeave={() => tooltipRef.current?.hide()}
            >
              <defs>
                <pattern
                  id="map-no-data"
                  width="4"
                  height="4"
                  patternUnits="userSpaceOnUse"
                  patternTransform={`rotate(45) scale(${1 / zoomLevel})`}
                >
                  <rect width="4" height="4" fill="#232a37" />
                  <line y2="4" stroke="#465269" strokeWidth="1.6" />
                </pattern>
              </defs>
              <rect
                width="960"
                height="500"
                fill="transparent"
                onClick={() => select("")}
              />
              <g
                ref={geographyRef}
                className="map-geography"
                aria-hidden="true"
                onClick={(event) =>
                  select(event.target.getAttribute("data-iso") ?? "")
                }
                onPointerMove={showTooltip}
              >
                <path d={SPHERE} className="map-ocean" />
                <g style={{ "--map-dot": `${dotSize}px` }}>{dots}</g>
                {countryShapes}
                {selectedShape && (
                  <path d={selectedShape.d} className="map-country-selected" />
                )}
                {selectedShape?.center.every(Number.isFinite) && (
                  <circle
                    cx={selectedShape.center[0]}
                    cy={selectedShape.center[1]}
                    r={5 / zoomLevel}
                    className="map-selected-marker"
                    pointerEvents="none"
                  />
                )}
              </g>
            </svg>
            <MapTooltip ref={tooltipRef} describe={describe} />
            <div className="map-status">
              <DataStatus datasets={statusDatasets} />
            </div>
            {fullscreen && iso && (
              <div className="map-fs-detail">
                <p className="map-fs-detail-title">
                  <strong>{selectedName}</strong>
                  <QualityBadge quality={selectedQuality} />
                  <span className="muted"> · {shownYear}</span>
                </p>
                {scoreLine}
                {historyLink}
              </div>
            )}
          </div>
          <MapLegend
            paint={paint}
            year={shownYear}
            loadingYear={loadingYear}
            failedYear={failedYear}
            custom={custom}
            status={
              !ready
                ? "Loading scores…"
                : failedYear
                  ? `Scores for ${year} could not be loaded.`
                  : `Loading ${year}…`
            }
          />
          <p className="map-rotate-hint">Rotate your phone for a larger map.</p>
        </div>
        <section
          ref={detailRef}
          className="map-detail-panel"
          tabIndex={-1}
          aria-label={iso ? `${selectedName} details` : "Selected country"}
        >
          {!iso ? (
            <p className="map-detail-empty">
              Select a country on the map, or type its name in Find a country.
            </p>
          ) : (
            <>
              <div className="map-detail-head">
                <h2 className="map-detail-title">
                  {selectedName}
                  <QualityBadge quality={selectedQuality} />
                </h2>
                <p className="map-detail-sub">
                  {[selected?.region?.name, shownYear].filter(Boolean).join(" · ")}
                </p>
              </div>
              {!selected ? (
                <p className="map-detail-empty">
                  {inLeaderboard
                    ? `${selectedName} isn’t scored for ${shownYear}: at least one of the five inputs is missing.`
                    : `${selectedName} isn’t scored: the index’s data sources don’t cover it.`}
                </p>
              ) : (
                <>
                  {scoreLine}
                  <dl className="map-detail-grid">
                    {columns
                      .filter((column) => column.key !== "tomer")
                      .map((column) => (
                        <div key={column.key}>
                          <dt>{column.label}</dt>
                          <dd>
                            <MetricCell
                              row={selected}
                              column={column}
                              year={shownYear}
                            />
                          </dd>
                        </div>
                      ))}
                  </dl>
                </>
              )}
              <div className="map-detail-actions">
                {historyLink}
                {inLeaderboard && (
                  <Link
                    className="map-detail-link"
                    href={`/compare?picks=${encodeURIComponent(iso)}&year=${year}`}
                  >
                    Compare →
                  </Link>
                )}
              </div>
            </>
          )}
        </section>
        <div className="map-weights">
          <Weights
            label="Map"
            weights={weights}
            onChange={(next) => update(weightQuery(next))}
          />
        </div>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </main>
  );
}
