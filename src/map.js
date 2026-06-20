import { escapeHtml, formatInt } from "./format.js";
import { formatTomer } from "./index-scale.js";
import { dataQualityBadgeHtml, dataQualityForRow } from "./data-quality.js";
import { loadLeaderboardData, loadSeriesData } from "./data-loader.js";
import { sourceYearBadgeHtml } from "./source-years.js";
import { YEAR_MAX, YEAR_MIN } from "./site-years.js";
import { finishInitialLoad } from "./page-ready.js";
import { geoEquirectangular, geoPath } from "d3-geo";

const $status = document.getElementById("status");
const $svg = document.getElementById("map-svg");
const $tooltip = document.getElementById("map-tooltip");
const $legend = document.getElementById("map-legend");
const $year = document.getElementById("map-year-slider");
const $yearOut = document.getElementById("map-year-output");
const $detail = document.getElementById("map-detail");
const $search = document.getElementById("map-search");
const $searchList = document.getElementById("map-search-list");

const W = 960;
const H = 500;

// A perceptually ordered Plasma palette. Discrete bands are easier to compare
// across small neighboring countries than nearly identical continuous shades.
const MAP_COLORS = [
  "#3b0f70",
  "#5c01a6",
  "#8b0aa5",
  "#b83289",
  "#db5c68",
  "#f48849",
  "#febd2a",
  "#f0f921",
];

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
  /** Visible-year value range and quantile breaks for the color bands. */
  domainMin: 0,
  domainMax: 1,
  colorBreaks: [],
  selectedIso: "",
};

function featurePath(feature) {
  return pathGen(feature) ?? "";
}

function colorForValue(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "#2a3142";
  const band = state.colorBreaks.findIndex((limit) => v <= limit);
  return MAP_COLORS[band === -1 ? MAP_COLORS.length - 1 : band];
}

function quantile(sorted, p) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const fraction = position - lower;
  const next = sorted[lower + 1];
  return next == null
    ? sorted[lower]
    : sorted[lower] + fraction * (next - sorted[lower]);
}

function computeColorScale() {
  const values = [...state.byIso.values()]
    .map((entry) => entry.value)
    .filter((value) => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);

  if (!values.length) {
    state.domainMin = 0;
    state.domainMax = 1;
    state.colorBreaks = [];
    return;
  }

  state.domainMin = values[0];
  state.domainMax = values[values.length - 1];
  state.colorBreaks = MAP_COLORS.slice(1).map((_, index) =>
    quantile(values, (index + 1) / MAP_COLORS.length)
  );
}

function renderLegend() {
  if (!$legend) return;
  const stops = MAP_COLORS.map((color, index) => {
    const lower = index === 0 ? state.domainMin : state.colorBreaks[index - 1];
    const upper = index === MAP_COLORS.length - 1 ? state.domainMax : state.colorBreaks[index];
    const label = `${formatTomer(lower)} to ${formatTomer(upper)}`;
    return `<i class="map-legend-stop" style="background:${color}" title="${label}"></i>`;
  });
  $legend.innerHTML = `
    <span class="map-legend-scale" role="img" aria-label="Relative color scale from ${formatTomer(
      state.domainMin
    )} to ${formatTomer(state.domainMax)} for ${state.year}">
      <span class="map-legend-label">Lower ${formatTomer(state.domainMin)}</span>
      <span class="map-legend-bar">${stops.join("")}</span>
      <span class="map-legend-label">Higher ${formatTomer(state.domainMax)}</span>
    </span>
    <span class="map-legend-note">8 relative groups for ${state.year}</span>
    <span class="map-legend-key map-legend-key-incomplete">Incomplete</span>
    <span class="map-legend-key map-legend-key-empty">No data</span>
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
    if (!point || typeof point.customIndex !== "number" || !Number.isFinite(point.customIndex)) {
      continue;
    }
    const row = latest.get(iso);
    if (!row || row.derivedKind) continue;
    map.set(iso, { value: point.customIndex, row, point });
  }

  if (state.year === YEAR_MAX) {
    for (const [iso, row] of latest) {
      if (row.derivedKind) continue;
      if (!map.has(iso)) {
        const value = row.customIndex ?? row.customHdi;
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        map.set(iso, {
          value,
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
    const d = featurePath(f);
    if (!d) continue;
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    const entry = state.byIso.get(iso);
    const quality = entry ? dataQualityForRow(entry.row, state.payload?.entrySeries ?? {}, state.payload?.qualityByIso ?? {}) : null;
    path.setAttribute(
      "fill",
      entry ? colorForValue(entry.value) : "#2a3142"
    );
    path.setAttribute(
      "class",
      `map-country${entry ? "" : " is-no-data"}${quality ? " is-incomplete" : ""}${
        state.selectedIso === iso ? " is-selected" : ""
      }`
    );
    path.dataset.iso = iso;
    path.dataset.name = f.properties?.name ?? iso;
    const title = document.createElementNS(ns, "title");
    title.textContent = entry
      ? `${entry.row.name}: ${formatTomer(entry.value)}${quality ? " (incomplete data)" : ""}`
      : `${path.dataset.name}: no data`;
    path.appendChild(title);
    g.appendChild(path);
  }

  // Raise the selected country above its neighbors (so its full outline shows)
  // and drop a marker at its centroid, so a shared ?iso= link is legible even
  // for countries too small to make out on the world map.
  if (state.selectedIso) {
    const selPath = g.querySelector(".map-country.is-selected");
    if (selPath) g.appendChild(selPath);
    const feature = state.worldFeatures.find((f) => f.id === state.selectedIso);
    if (feature) {
      const [cx, cy] = pathGen.centroid(feature);
      if (Number.isFinite(cx) && Number.isFinite(cy)) {
        const marker = document.createElementNS(ns, "circle");
        marker.setAttribute("cx", String(cx));
        marker.setAttribute("cy", String(cy));
        marker.setAttribute("r", "8");
        marker.setAttribute("class", "map-selected-marker");
        marker.setAttribute("pointer-events", "none");
        g.appendChild(marker);
      }
    }
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
    const quality = dataQualityForRow(
      entry.row,
      state.payload?.entrySeries ?? {},
      state.payload?.qualityByIso ?? {}
    );
    $tooltip.innerHTML = `
      <strong>${escapeHtml(entry.row.name)}${dataQualityBadgeHtml(quality)}</strong>
      <span class="muted">${state.year}</span>
      <div class="map-tooltip-grid">
        <span>Tomer</span><span>${escapeHtml(formatTomer(idx))}</span>
        <span>Life exp.</span><span>${typeof point.le === "number" ? point.le.toFixed(1) : "—"}</span>
        <span>HALE</span><span>${typeof point.hale === "number" ? point.hale.toFixed(1) : "—"}</span>
        <span>Income pc</span><span>${typeof point.gni === "number" ? formatInt(point.gni) : "—"}</span>
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

function renderDetail(iso) {
  if (!$detail) return;
  const entry = state.byIso.get(iso);
  if (!entry) {
    const name = state.worldFeatures?.find((feature) => feature.id === iso)?.properties?.name ?? iso;
    $detail.innerHTML = `
      <div class="map-detail-head">
        <h2 class="map-detail-title">${escapeHtml(name)}</h2>
        <span class="map-detail-pill">No data</span>
      </div>
      <p class="compare-hint">No Tomer index point is available for ${state.year}.</p>
    `;
    return;
  }
  const point = entry.point ?? entry.row;
  const quality = dataQualityForRow(
    entry.row,
    state.payload?.entrySeries ?? {},
    state.payload?.qualityByIso ?? {}
  );
  const href = `./entry.html?iso=${encodeURIComponent(entry.row.iso)}`;
  $detail.innerHTML = `
    <div class="map-detail-head">
      <div>
        <h2 class="map-detail-title">${escapeHtml(entry.row.name)}${dataQualityBadgeHtml(
          quality
        )}</h2>
        <p class="map-detail-sub muted">${state.year}</p>
      </div>
      <div class="map-detail-actions">
        <a class="btn map-detail-link" href="${href}">History</a>
        <button type="button" class="btn map-detail-clear" data-clear-selection>Clear</button>
      </div>
    </div>
    <dl class="map-detail-grid">
      <div><dt>Tomer</dt><dd>${formatTomer(entry.value)}${sourceYearBadgeHtml(
        point,
        ["leYear", "haleYear", "gniYear", "homicideYear"],
        state.year
      )}</dd></div>
      <div><dt>Life exp.</dt><dd>${typeof point.le === "number" ? point.le.toFixed(1) : "-"}${sourceYearBadgeHtml(point, "leYear", state.year)}</dd></div>
      <div><dt>HALE</dt><dd>${typeof point.hale === "number" ? point.hale.toFixed(1) : "-"}${sourceYearBadgeHtml(point, "haleYear", state.year)}</dd></div>
      <div><dt>Income pc</dt><dd>${typeof point.gni === "number" ? formatInt(point.gni) : "-"}${sourceYearBadgeHtml(point, "gniYear", state.year)}</dd></div>
      <div><dt>Hom./100k</dt><dd>${typeof point.homicidesPer100k === "number" ? point.homicidesPer100k.toFixed(1) : "-"}${sourceYearBadgeHtml(point, "homicideYear", state.year)}</dd></div>
    </dl>
  `;
}

/** Reflect the current selection in the search box as canonical "Name (ISO)". */
function syncSearchInput(iso) {
  if (!$search) return;
  const row = (state.payload?.countries ?? []).find((r) => r.iso === iso);
  $search.value = row ? `${row.name} (${row.iso})` : "";
}

/** Single entry point for selecting a country: map, detail, search box, URL. */
function selectIso(iso) {
  state.selectedIso = iso;
  renderMap();
  renderDetail(iso);
  syncSearchInput(iso);
  syncUrl();
}

function clearSelection() {
  state.selectedIso = "";
  renderMap();
  if ($detail) {
    $detail.innerHTML = '<p class="map-detail-empty">Select a country on the map.</p>';
  }
  syncSearchInput("");
  syncUrl();
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
    selectIso(target.dataset.iso);
  });
  $detail?.addEventListener("click", (e) => {
    if (e.target.closest("[data-clear-selection]")) clearSelection();
  });
}

function populateSearchList() {
  if (!$searchList || !state.payload) return;
  $searchList.innerHTML = (state.payload.countries ?? [])
    .map((row) => `<option value="${escapeHtml(`${row.name} (${row.iso})`)}"></option>`)
    .join("");
}

/** Resolve search text to an ISO3: "Name (ISO)", exact name/ISO, or unique partial. */
function isoFromSearch(text) {
  const q = text.trim();
  if (!q) return "";
  const countries = state.payload?.countries ?? [];
  const m = q.match(/\(([A-Za-z]{3})\)\s*$/);
  if (m) return m[1].toUpperCase();
  const lower = q.toLowerCase();
  const exact = countries.find(
    (r) => r.name.toLowerCase() === lower || r.iso.toLowerCase() === lower
  );
  if (exact) return exact.iso;
  const partial = countries.filter((r) => r.name.toLowerCase().includes(lower));
  return partial.length === 1 ? partial[0].iso : "";
}

function selectFromSearch() {
  const iso = isoFromSearch($search?.value ?? "");
  if (!iso) return;
  if (!(state.payload?.countries ?? []).some((r) => r.iso === iso)) return;
  selectIso(iso);
}

function setYear(y) {
  state.year = Math.max(YEAR_MIN, Math.min(YEAR_MAX, parseInt(y, 10) || YEAR_MAX));
  if ($year) $year.value = String(state.year);
  if ($yearOut) $yearOut.textContent = String(state.year);
  buildIsoMap();
  computeColorScale();
  renderLegend();
  renderMap();
  if (state.selectedIso) renderDetail(state.selectedIso);
  syncUrl();
}

function applyUrlState() {
  const params = new URLSearchParams(window.location.search);
  state.year = Math.max(YEAR_MIN, Math.min(YEAR_MAX, parseInt(params.get("year"), 10) || YEAR_MAX));
  state.selectedIso = (params.get("iso") ?? "").trim().toUpperCase();
}

function syncUrl() {
  if (!state.payload) return;
  const params = new URLSearchParams();
  if (state.year !== YEAR_MAX) params.set("year", String(state.year));
  if (state.selectedIso) params.set("iso", state.selectedIso);
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", next);
}

async function load() {
  // Reuses the same data files as the leaderboard pages so the browser
  // cache is shared when navigating between pages.
  const [worldRes, leaderboardPayload, seriesPayload] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}data/world.geojson`, { cache: "no-cache" }),
    loadLeaderboardData(),
    loadSeriesData(),
  ]);
  if (!worldRes.ok) throw new Error(`Map data missing (${worldRes.status}). Run: npm run build-world`);
  const world = await worldRes.json();
  state.worldFeatures = world.features ?? [];
  state.payload = {
    countries: (leaderboardPayload.countries ?? []).filter((row) => !row.derivedKind),
    entrySeries: seriesPayload.entrySeries ?? {},
    qualityByIso: leaderboardPayload.qualityByIso ?? {},
  };
  applyUrlState();
  if ($year) $year.value = String(state.year);
  if ($yearOut) $yearOut.textContent = String(state.year);
  $status.textContent = "";
  buildIsoMap();
  computeColorScale();
  renderLegend();
  renderMap();
  populateSearchList();
  if (state.selectedIso) {
    renderDetail(state.selectedIso);
    syncSearchInput(state.selectedIso);
    // A shared ?iso= link should land on the detail panel, which sits below
    // the map; bring it into view without yanking past it on tall layouts.
    $detail?.scrollIntoView({ block: "nearest" });
  }
  bindMapInteractions();
}

$year?.addEventListener("input", (e) => setYear(e.target.value));
$search?.addEventListener("change", selectFromSearch);

load()
  .catch((e) => {
    console.error(e);
    $status.textContent = e instanceof Error ? e.message : "Could not load map.";
    $status.classList.add("error");
  })
  .finally(finishInitialLoad);
