import { escapeHtml, formatInt } from "./format.js";
import {
  formatTomer,
  onScaleChange,
  renderScaleControl,
} from "./index-scale.js";
import { geoEquirectangular, geoPath } from "d3-geo";

const $status = document.getElementById("status");
const $scaleControl = document.getElementById("scale-control");
const $svg = document.getElementById("map-svg");
const $tooltip = document.getElementById("map-tooltip");
const $legend = document.getElementById("map-legend");
const $year = document.getElementById("map-year-slider");
const $yearOut = document.getElementById("map-year-output");

const YEAR_MIN = 2000;
const YEAR_MAX = 2023;

const W = 960;
const H = 500;

/** d3-geo equirectangular projection scaled to fit the SVG viewBox.
 *  d3's path generator handles antimeridian splitting and clipping
 *  automatically, which our naive projector did not. */
const projection = geoEquirectangular()
  .scale(W / (2 * Math.PI))
  .translate([W / 2, H / 2]);
const pathGen = geoPath(projection);

const state = {
  year: YEAR_MAX,
  worldFeatures: null,
  payload: null,
  /** Map<iso3, { value: number, row?: object, point?: object }>. */
  byIso: new Map(),
  /** Visible-year value range — drives the color stretch. */
  domainMin: 0,
  domainMax: 1,
};

function featurePath(feature) {
  return pathGen(feature) ?? "";
}

/**
 * Stretches a Tomer index value to a 0–1 ramp position using the visible
 * year's [min, max] so the full red→amber→green palette covers the actual
 * spread of countries instead of squishing the entire world into the
 * green half. Domain is recomputed from `state.byIso` whenever the year
 * changes.
 */
function rampPosition(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const { domainMin, domainMax } = state;
  const span = domainMax - domainMin;
  if (!span) return 0.5;
  const t = (v - domainMin) / span;
  return Math.max(0, Math.min(1, t));
}

/** Saturated red → amber → green ramp. Hue 0° → 60° → 130°, lightness fixed-ish. */
function colorAtRampT(t) {
  const hue = 0 + t * 130;
  const sat = 78 - 8 * Math.abs(0.5 - t) * 2;
  const light = 38 + 12 * t;
  return `hsl(${hue.toFixed(1)} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`;
}

function colorForValue(v) {
  const t = rampPosition(v);
  if (t == null) return "#2a3142";
  return colorAtRampT(t);
}

function renderLegend() {
  if (!$legend) return;
  const stops = [];
  const N = 12;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    stops.push(`<i class="map-legend-stop" style="background:${colorAtRampT(t)}"></i>`);
  }
  $legend.innerHTML = `
    <span class="map-legend-label">${formatTomer(state.domainMin)}</span>
    <span class="map-legend-bar">${stops.join("")}</span>
    <span class="map-legend-label">${formatTomer(state.domainMax)}</span>
  `;
}

function buildIsoMap() {
  if (!state.payload) return;
  const map = new Map();
  const latest = new Map(
    (state.payload.countries ?? []).map((c) => [c.iso, c])
  );
  const series = state.payload.entrySeries ?? {};

  for (const iso of Object.keys(series)) {
    const point = series[iso].points.find((p) => p.year === state.year);
    if (!point) continue;
    const row = latest.get(iso);
    if (!row || row.derivedKind) continue;
    map.set(iso, { value: point.customIndex, row, point });
  }

  if (state.year === YEAR_MAX) {
    for (const [iso, row] of latest) {
      if (row.derivedKind) continue;
      if (!map.has(iso)) {
        map.set(iso, {
          value: row.customIndex ?? row.customHdi,
          row,
          point: null,
        });
      }
    }
  }

  state.byIso = map;
}

/**
 * Computes a single [min, max] domain across every year and every country
 * timeline. Sharing one domain means a value of e.g. 0.7 in 2000 lands on
 * the same color as 0.7 in 2023 — colors are directly comparable across
 * the slider. Called once after the data file loads.
 */
function computeFixedDomain() {
  if (!state.payload) return;
  const latest = new Map(
    (state.payload.countries ?? []).map((c) => [c.iso, c])
  );
  const series = state.payload.entrySeries ?? {};
  let lo = Infinity;
  let hi = -Infinity;
  for (const iso of Object.keys(series)) {
    const row = latest.get(iso);
    if (!row || row.derivedKind) continue;
    for (const point of series[iso].points) {
      const v = point.customIndex;
      if (typeof v === "number" && Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  if (Number.isFinite(lo) && lo < 1) {
    state.domainMin = lo;
    state.domainMax = 1;
  } else {
    state.domainMin = 0;
    state.domainMax = 1;
  }
}

function renderMap() {
  if (!$svg) return;
  if (!state.worldFeatures) {
    $svg.replaceChildren();
    return;
  }

  $svg.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" class="map-svg-root" role="presentation">
    <rect width="${W}" height="${H}" class="map-ocean"></rect>
    <g id="map-countries" shape-rendering="geometricPrecision"></g>
  </svg>`;
  const g = $svg.querySelector("#map-countries");

  const ns = "http://www.w3.org/2000/svg";
  for (const f of state.worldFeatures) {
    const iso = f.id;
    const d = featurePath(f);
    if (!d) continue;
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    const entry = state.byIso.get(iso);
    path.setAttribute(
      "fill",
      entry ? colorForValue(entry.value) : "#2a3142"
    );
    path.setAttribute("class", "map-country");
    path.dataset.iso = iso;
    path.dataset.name = f.properties?.name ?? iso;
    g.appendChild(path);
  }
}

function showTooltip(iso, name, clientX, clientY) {
  const entry = state.byIso.get(iso);
  if (!$tooltip) return;
  if (!entry) {
    $tooltip.innerHTML = `<strong>${escapeHtml(name)}</strong><span class="muted">No data for ${state.year}</span>`;
  } else {
    const point = entry.point ?? entry.row;
    const idx = entry.value;
    $tooltip.innerHTML = `
      <strong>${escapeHtml(entry.row.name)}</strong>
      <span class="muted">${state.year}</span>
      <div class="map-tooltip-grid">
        <span>Tomer</span><span>${escapeHtml(formatTomer(idx))}</span>
        <span>Life exp.</span><span>${typeof point.le === "number" ? point.le.toFixed(1) : "—"}</span>
        <span>HALE</span><span>${typeof point.hale === "number" ? point.hale.toFixed(1) : "—"}</span>
        <span>GNI pc</span><span>${typeof point.gni === "number" ? formatInt(point.gni) : "—"}</span>
        <span>Hom./100k</span><span>${typeof point.homicidesPer100k === "number" ? point.homicidesPer100k.toFixed(1) : "—"}</span>
      </div>
      <small class="muted">Click for full history</small>
    `;
  }
  $tooltip.hidden = false;

  const wrap = $svg.parentElement.getBoundingClientRect();
  const x = clientX - wrap.left;
  const y = clientY - wrap.top;
  const tw = $tooltip.offsetWidth;
  const th = $tooltip.offsetHeight;
  const left = Math.min(Math.max(x + 14, 8), wrap.width - tw - 8);
  const top = Math.min(Math.max(y - th - 14, 8), wrap.height - th - 8);
  $tooltip.style.left = `${left}px`;
  $tooltip.style.top = `${top}px`;
}

function hideTooltip() {
  if ($tooltip) $tooltip.hidden = true;
}

function bindMapInteractions() {
  $svg.addEventListener("pointermove", (e) => {
    const target = e.target.closest(".map-country");
    if (!target) {
      hideTooltip();
      return;
    }
    showTooltip(target.dataset.iso, target.dataset.name, e.clientX, e.clientY);
  });
  $svg.addEventListener("pointerleave", hideTooltip);
  $svg.addEventListener("click", (e) => {
    const target = e.target.closest(".map-country");
    if (!target) return;
    const iso = target.dataset.iso;
    if (!state.byIso.has(iso)) return;
    window.location.href = `./entry.html?iso=${encodeURIComponent(iso)}`;
  });
}

function setYear(y) {
  state.year = Math.max(YEAR_MIN, Math.min(YEAR_MAX, parseInt(y, 10) || YEAR_MAX));
  if ($year) $year.value = String(state.year);
  if ($yearOut) $yearOut.textContent = String(state.year);
  buildIsoMap();
  renderMap();
}

async function load() {
  const [worldRes, dataRes] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}data/world.geojson`, { cache: "no-cache" }),
    fetch(`${import.meta.env.BASE_URL}data/countries.json?v=${__DATA_VERSION__}`, {
      cache: "no-cache",
    }),
  ]);
  if (!worldRes.ok) throw new Error(`Map data missing (${worldRes.status}). Run: npm run build-world`);
  if (!dataRes.ok) throw new Error(`Country data missing (${dataRes.status}). Run: npm run build-data`);
  const world = await worldRes.json();
  state.worldFeatures = world.features ?? [];
  state.payload = await dataRes.json();
  $status.textContent = "";
  computeFixedDomain();
  buildIsoMap();
  renderLegend();
  renderMap();
  bindMapInteractions();
}

renderScaleControl($scaleControl);
onScaleChange(() => {
  renderLegend();
  renderMap();
});

$year?.addEventListener("input", (e) => setYear(e.target.value));

load().catch((e) => {
  console.error(e);
  $status.textContent = e instanceof Error ? e.message : "Could not load map.";
  $status.classList.add("error");
});
