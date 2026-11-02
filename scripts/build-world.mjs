/**
 * Converts world-atlas countries-110m TopoJSON into a GeoJSON keyed by ISO3
 * alpha-3. Run once with `npm run build-world`. The runtime never sees
 * topojson — it just reads the produced GeoJSON.
 *
 * Scored countries too small for the 110m atlas (Malta, Singapore, …) are taken
 * from countries-50m, and the atlas features without a numeric id stay on the map
 * as unscored land. Coordinates are rounded to 2 decimals (<0.03 px at 1× zoom).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { feature } from "topojson-client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TOPOJSON = join(ROOT, "node_modules/world-atlas/countries-110m.json");
const TOPOJSON_50M = join(ROOT, "node_modules/world-atlas/countries-50m.json");
const LEADERBOARD = join(ROOT, "public/data/leaderboard.json");
const OUT = join(ROOT, "public/data/world.geojson");
const DIGITS = 2;

/** Numeric ISO 3166-1 → alpha-3, covering the rows in world-atlas. */
const NUM_TO_ISO3 = {
  4: "AFG", 8: "ALB", 10: "ATA", 12: "DZA", 20: "AND", 24: "AGO", 28: "ATG", 31: "AZE",
  32: "ARG", 36: "AUS", 40: "AUT", 44: "BHS", 48: "BHR", 50: "BGD", 51: "ARM",
  52: "BRB", 56: "BEL", 60: "BMU", 64: "BTN", 68: "BOL", 70: "BIH", 72: "BWA",
  74: "BVT", 76: "BRA", 84: "BLZ", 86: "IOT", 90: "SLB", 92: "VGB", 96: "BRN",
  100: "BGR", 104: "MMR", 108: "BDI", 112: "BLR", 116: "KHM", 120: "CMR",
  124: "CAN", 132: "CPV", 136: "CYM", 140: "CAF", 144: "LKA", 148: "TCD",
  152: "CHL", 156: "CHN", 158: "TWN", 162: "CXR", 166: "CCK", 170: "COL",
  174: "COM", 175: "MYT", 178: "COG", 180: "COD", 184: "COK", 188: "CRI",
  191: "HRV", 192: "CUB", 196: "CYP", 203: "CZE", 204: "BEN", 208: "DNK",
  212: "DMA", 214: "DOM", 218: "ECU", 222: "SLV", 226: "GNQ", 231: "ETH",
  232: "ERI", 233: "EST", 234: "FRO", 238: "FLK", 239: "SGS", 242: "FJI",
  246: "FIN", 248: "ALA", 250: "FRA", 254: "GUF", 258: "PYF", 260: "ATF",
  262: "DJI", 266: "GAB", 268: "GEO", 270: "GMB", 275: "PSE", 276: "DEU",
  288: "GHA", 292: "GIB", 296: "KIR", 300: "GRC", 304: "GRL", 308: "GRD",
  312: "GLP", 316: "GUM", 320: "GTM", 324: "GIN", 328: "GUY", 332: "HTI",
  334: "HMD", 336: "VAT", 340: "HND", 344: "HKG", 348: "HUN", 352: "ISL",
  356: "IND", 360: "IDN", 364: "IRN", 368: "IRQ", 372: "IRL", 376: "ISR",
  380: "ITA", 384: "CIV", 388: "JAM", 392: "JPN", 398: "KAZ", 400: "JOR",
  404: "KEN", 408: "PRK", 410: "KOR", 414: "KWT", 417: "KGZ", 418: "LAO",
  422: "LBN", 426: "LSO", 428: "LVA", 430: "LBR", 434: "LBY", 438: "LIE",
  440: "LTU", 442: "LUX", 446: "MAC", 450: "MDG", 454: "MWI", 458: "MYS",
  462: "MDV", 466: "MLI", 470: "MLT", 474: "MTQ", 478: "MRT", 480: "MUS",
  484: "MEX", 492: "MCO", 496: "MNG", 498: "MDA", 499: "MNE", 500: "MSR",
  504: "MAR", 508: "MOZ", 512: "OMN", 516: "NAM", 520: "NRU", 524: "NPL",
  528: "NLD", 531: "CUW", 533: "ABW", 534: "SXM", 535: "BES", 540: "NCL",
  548: "VUT", 554: "NZL", 558: "NIC", 562: "NER", 566: "NGA", 570: "NIU",
  574: "NFK", 578: "NOR", 580: "MNP", 581: "UMI", 583: "FSM", 584: "MHL",
  585: "PLW", 586: "PAK", 591: "PAN", 598: "PNG", 600: "PRY", 604: "PER",
  608: "PHL", 612: "PCN", 616: "POL", 620: "PRT", 624: "GNB", 626: "TLS",
  630: "PRI", 634: "QAT", 638: "REU", 642: "ROU", 643: "RUS", 646: "RWA",
  652: "BLM", 654: "SHN", 659: "KNA", 660: "AIA", 662: "LCA", 663: "MAF",
  666: "SPM", 670: "VCT", 674: "SMR", 678: "STP", 682: "SAU", 686: "SEN",
  688: "SRB", 690: "SYC", 694: "SLE", 702: "SGP", 703: "SVK", 704: "VNM",
  705: "SVN", 706: "SOM", 710: "ZAF", 716: "ZWE", 724: "ESP", 728: "SSD",
  729: "SDN", 732: "ESH", 740: "SUR", 744: "SJM", 748: "SWZ", 752: "SWE",
  756: "CHE", 760: "SYR", 762: "TJK", 764: "THA", 768: "TGO", 772: "TKL",
  776: "TON", 780: "TTO", 784: "ARE", 788: "TUN", 792: "TUR", 795: "TKM",
  796: "TCA", 798: "TUV", 800: "UGA", 804: "UKR", 807: "MKD", 818: "EGY",
  826: "GBR", 831: "GGY", 832: "JEY", 833: "IMN", 834: "TZA", 840: "USA",
  850: "VIR", 854: "BFA", 858: "URY", 860: "UZB", 862: "VEN", 876: "WLF",
  882: "WSM", 887: "YEM", 894: "ZMB",
};
/**
 * Atlas features without an ISO numeric id. They are drawn as unscored land so they
 * don't show as holes; XKX is the World Bank code (it joins if Kosovo is ever scored),
 * SOL/CYN are Natural Earth codes that never match a leaderboard row.
 */
const BY_NAME = {
  Kosovo: { id: "XKX", name: "Kosovo" },
  Somaliland: { id: "SOL", name: "Somaliland" },
  "N. Cyprus": { id: "CYN", name: "Northern Cyprus" },
};

const round = (value) => Number(value.toFixed(DIGITS));
/** Twice the planar signed area of a ring; its sign is the ring's winding. */
function signedArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++)
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return sum;
}
/**
 * Rounds a ring and drops repeated points. Rings that collapse or flip winding are
 * dropped (null), since d3-geo would read a flipped ring as covering the whole globe.
 */
function roundRing(ring) {
  const out = [];
  for (const [x, y] of ring) {
    const point = [round(x), round(y)];
    const last = out.at(-1);
    if (!last || last[0] !== point[0] || last[1] !== point[1]) out.push(point);
  }
  if (out.length < 4) return null;
  const before = signedArea(ring),
    after = signedArea(out);
  return after !== 0 && Math.sign(after) === Math.sign(before) ? out : null;
}
function roundPolygon(rings) {
  const [outer, ...holes] = rings.map(roundRing);
  return outer ? [outer, ...holes.filter(Boolean)] : null;
}
function roundGeometry(geometry) {
  const polygons = (
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates
  )
    .map(roundPolygon)
    .filter(Boolean);
  if (!polygons.length) throw new Error("Geometry vanished after rounding");
  return polygons.length === 1
    ? { type: "Polygon", coordinates: polygons[0] }
    : { type: "MultiPolygon", coordinates: polygons };
}

async function readCountries(file) {
  const topo = JSON.parse(await readFile(file, "utf8"));
  const layer = topo.objects?.countries;
  if (!layer) throw new Error(`Expected layer 'countries' in ${file}`);
  return feature(topo, layer).features;
}
function toFeature(f) {
  const named = f.id === undefined ? BY_NAME[f.properties?.name] : null;
  const id = named?.id ?? NUM_TO_ISO3[parseInt(f.id, 10)];
  if (!id) return null;
  return {
    type: "Feature",
    id,
    properties: { name: named?.name ?? f.properties?.name ?? "" },
    geometry: roundGeometry(f.geometry),
  };
}

async function main() {
  const features = [];
  let dropped = 0;
  for (const f of await readCountries(TOPOJSON)) {
    const out = toFeature(f);
    if (out) features.push(out);
    else dropped += 1;
  }

  const { countries } = JSON.parse(await readFile(LEADERBOARD, "utf8"));
  const have = new Set(features.map((f) => f.id));
  const missing = new Set(
    countries
      .filter((row) => !row.derivedKind && !have.has(row.iso))
      .map((row) => row.iso),
  );
  const added = [];
  for (const f of await readCountries(TOPOJSON_50M)) {
    const out = toFeature(f);
    if (out && missing.has(out.id)) {
      features.push(out);
      added.push(out.id);
      missing.delete(out.id);
    }
  }
  if (missing.size)
    console.warn(`No atlas shape for: ${[...missing].join(", ")}`);

  const out = { type: "FeatureCollection", features };
  await mkdir(join(ROOT, "public/data"), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  console.log(
    `Wrote ${features.length} country features (${dropped} dropped; from 50m: ${added.join(", ") || "none"}) → ${OUT}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
