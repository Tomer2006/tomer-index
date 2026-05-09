import { escapeHtml, formatInt } from "./format.js";
import {
  formatTomer,
  onScaleChange,
  renderScaleControl,
} from "./index-scale.js";

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
/** Latitudes outside [LAT_BOTTOM, LAT_TOP] are clipped — keeps Antarctica's
 *  southern fringe and Greenland in frame without distorting equator. */
const LAT_TOP = 84;
const LAT_BOTTOM = -85;

const state = {
  year: YEAR_MAX,
  worldFeatures: null,
  payload: null,
  /** Map<iso3, { value: number, row?: object, point?: object }>. */
  byIso: new Map(),
};

/** Equirectangular projection scaled to the SVG viewBox. Dependency-free. */
function project([lon, lat]) {
  const clampedLat = Math.max(LAT_BOTTOM, Math.min(LAT_TOP, lat));
  const x = ((lon + 180) / 360) * W;
  const y = ((LAT_TOP - clampedLat) / (LAT_TOP - LAT_BOTTOM)) * H;
  return [x, y];
}

/**
 * Splits a ring at antimeridian crossings (|Δlon| > 180°) so countries that
 * span the date line — Russia, Fiji, Kiribati, the Aleutians — don't draw
 * one straight line all the way across the projected map.
 */
function splitAtAntimeridian(ring) {
  if (ring.length < 2) return [ring];
  const segments = [];
  let current = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const prev = current[current.length - 1];
    const cur = ring[i];
    if (Math.abs(cur[0] - prev[0]) > 180) {
      if (current.length > 1) segments.push(current);
      current = [cur];
    } else {
      current.push(cur);
    }
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

function ringPath(ring) {
  return splitAtAntimeridian(ring)
    .map((segment) => {
      let d = "";
      for (let i = 0; i < segment.length; i++) {
        const [x, y] = project(segment[i]);
        d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      }
      return d + "Z";
    })
    .join(" ");
}

function geometryPath(geom) {
  if (!geom) return "";
  if (geom.type === "Polygon") {
    return geom.coordinates.map(ringPath).join(" ");
  }
  if (geom.type === "MultiPolygon") {
    return geom.coordinates
      .map((poly) => poly.map(ringPath).join(" "))
      .join(" ");
  }
  return "";
}

/** 0 → red, 0.5 → amber, 1 → green. Hue from 0° to 130°. */
function colorForValue(v01) {
  if (typeof v01 !== "number" || !Number.isFinite(v01)) return "#2a3142";
  const t = Math.max(0, Math.min(1, v01));
  const hue = 0 + t * 130;
  const sat = 65 - 18 * (1 - Math.abs(0.5 - t) * 2);
  const light = 30 + 20 * t;
  return `hsl(${hue.toFixed(1)} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`;
}

function renderLegend() {
  if (!$legend) return;
  const stops = [];
  const N = 12;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    stops.push(`<i class="map-legend-stop" style="background:${colorForValue(t)}"></i>`);
  }
  $legend.innerHTML = `
    <span class="map-legend-label">${formatTomer(0)}</span>
    <span class="map-legend-bar">${stops.join("")}</span>
    <span class="map-legend-label">${formatTomer(1)}</span>
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
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", geometryPath(f.geometry));
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
