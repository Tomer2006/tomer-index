/**
 * War deaths by the country whose people died, from the UCDP Georeferenced Event Dataset
 * (GED). The World Bank's battle-related deaths file every death under the country where
 * the fighting took place, so Palestinians killed in Gaza counted against Israel's
 * population and Russian soldiers killed in Ukraine against Ukraine's. GED splits each
 * event's deaths by side, which lets them count for the people who died instead.
 *
 * Importing this module only defines the helpers; `fetchUcdpWarDeaths` downloads.
 */
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInflateRaw } from "node:zlib";

export const UCDP_GED_VERSION = "26.1";
export const UCDP_GED_URL = "https://ucdp.uu.se/downloads/ged/ged261-csv.zip";

const DOWNLOAD_TIMEOUT_MS = 300_000;
const DOWNLOAD_ATTEMPTS = 3;

/**
 * Violence types counted: 1 is state-based conflict (battles involving a government) and
 * 3 is one-sided violence (armed forces or groups killing civilians, as on 7 October 2023).
 * 2, non-state conflict between gangs, cartels or militias, is left out: homicide figures
 * already count most of it.
 */
const COUNTED_VIOLENCE = new Set(["1", "3"]);

/** GED files Gaza and the West Bank under Israel; deaths there count for Palestine. */
const PALESTINIAN_ADM1 = new Set(["Gaza Strip", "West Bank"]);

/** Gleditsch–Ward country codes used by GED → ISO 3166 alpha-3. */
const GW_TO_ISO = new Map(
  Object.entries({
    2: "USA", 20: "CAN", 41: "HTI", 51: "JAM", 52: "TTO", 70: "MEX", 90: "GTM", 91: "HND",
    92: "SLV", 93: "NIC", 94: "CRI", 95: "PAN", 100: "COL", 101: "VEN", 110: "GUY",
    130: "ECU", 135: "PER", 140: "BRA", 145: "BOL", 150: "PRY", 160: "ARG", 200: "GBR",
    210: "NLD", 211: "BEL", 220: "FRA", 230: "ESP", 260: "DEU", 290: "POL", 305: "AUT",
    325: "ITA", 338: "MLT", 339: "ALB", 343: "MKD", 344: "HRV", 345: "SRB", 346: "BIH",
    352: "CYP", 359: "MDA", 360: "ROU", 365: "RUS", 369: "UKR", 371: "ARM", 372: "GEO",
    373: "AZE", 380: "SWE", 404: "GNB", 420: "GMB", 432: "MLI", 433: "SEN", 434: "BEN",
    435: "MRT", 436: "NER", 437: "CIV", 438: "GIN", 439: "BFA", 450: "LBR", 451: "SLE",
    452: "GHA", 461: "TGO", 471: "CMR", 475: "NGA", 482: "CAF", 483: "TCD", 484: "COG",
    490: "COD", 500: "UGA", 501: "KEN", 510: "TZA", 516: "BDI", 517: "RWA", 520: "SOM",
    522: "DJI", 530: "ETH", 531: "ERI", 540: "AGO", 541: "MOZ", 551: "ZMB", 552: "ZWE",
    560: "ZAF", 565: "NAM", 570: "LSO", 571: "BWA", 572: "SWZ", 580: "MDG", 581: "COM",
    600: "MAR", 615: "DZA", 616: "TUN", 620: "LBY", 625: "SDN", 626: "SSD", 630: "IRN",
    640: "TUR", 645: "IRQ", 651: "EGY", 652: "SYR", 660: "LBN", 663: "JOR", 666: "ISR",
    670: "SAU", 678: "YEM", 690: "KWT", 692: "BHR", 694: "QAT", 696: "ARE", 700: "AFG",
    702: "TJK", 703: "KGZ", 704: "UZB", 710: "CHN", 750: "IND", 760: "BTN", 770: "PAK",
    771: "BGD", 775: "MMR", 780: "LKA", 790: "NPL", 800: "THA", 811: "KHM", 812: "LAO",
    820: "MYS", 840: "PHL", 850: "IDN", 900: "AUS", 910: "PNG", 940: "SLB",
  })
);

function isoForGw(code) {
  const iso = GW_TO_ISO.get(String(code).trim());
  // A new GED release can add countries; stop rather than drop their deaths.
  if (!iso) throw new Error(`UCDP GED uses Gleditsch–Ward code ${code}, which has no ISO mapping`);
  return iso;
}

function deathCount(event, field) {
  const text = String(event[field] ?? "");
  if (!/^\d+$/.test(text)) {
    throw new Error(`UCDP GED event ${event.id} has ${field} = ${JSON.stringify(event[field])}`);
  }
  return Number(text);
}

/**
 * One GED event's deaths as [ISO, deaths] pairs. A government side's deaths count for its
 * country (the first one listed, for a coalition); deaths of an armed group, civilians and
 * unidentified dead count for the country where the event happened.
 */
export function eventDeathsByCountry(event) {
  if (!COUNTED_VIOLENCE.has(event.type_of_violence)) return [];
  const where =
    isoForGw(event.country_id) === "ISR" && PALESTINIAN_ADM1.has(event.adm_1)
      ? "PSE"
      : isoForGw(event.country_id);
  const side = (gw) => (gw ? isoForGw(gw.split(/[;,]/)[0]) : where);
  return [
    [side(event.gwnoa), deathCount(event, "deaths_a")],
    [side(event.gwnob), deathCount(event, "deaths_b")],
    [where, deathCount(event, "deaths_civilians") + deathCount(event, "deaths_unknown")],
  ].filter(([, deaths]) => deaths > 0);
}

/**
 * Total war deaths per country and year, as World Bank-style rows (`countryiso3code`,
 * `date`, `value`), plus the latest year the events cover.
 * @param {Iterable<object> | AsyncIterable<object>} events — GED events keyed by column
 */
export async function warDeathCountRows(events) {
  const totals = new Map();
  let latestYear = null;
  let eventCount = 0;
  for await (const event of events) {
    if (!/^\d{4}$/.test(String(event.year))) {
      throw new Error(`UCDP GED event ${event.id} has year ${JSON.stringify(event.year)}`);
    }
    const year = Number(event.year);
    eventCount += 1;
    latestYear = Math.max(latestYear ?? year, year);
    for (const [iso, deaths] of eventDeathsByCountry(event)) {
      const key = `${iso}|${year}`;
      totals.set(key, (totals.get(key) ?? 0) + deaths);
    }
  }
  const rows = [...totals].map(([key, value]) => {
    const [iso, year] = key.split("|");
    return { countryiso3code: iso, date: year, value };
  });
  return { rows, latestYear, eventCount };
}

/**
 * CSV records (arrays of fields) from text chunks. Records end only at a newline outside
 * quotes: GED headlines contain U+2028, which line readers treat as a line break.
 * @param {AsyncIterable<string | Uint8Array>} chunks
 */
export async function* csvRecords(chunks) {
  const decoder = new TextDecoder("utf-8");
  let record = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  for await (const chunk of chunks) {
    const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          quoted = false;
          closedQuote = true;
        } else field += ch;
      } else if (ch === '"' && (closedQuote || field === "")) {
        // `""` inside a quoted field is a literal quote.
        if (closedQuote) field += '"';
        quoted = true;
        closedQuote = false;
      } else {
        closedQuote = false;
        if (ch === ",") {
          record.push(field);
          field = "";
        } else if (ch === "\n") {
          record.push(field);
          yield record;
          record = [];
          field = "";
        } else if (ch !== "\r") field += ch;
      }
    }
  }
  if (quoted) throw new Error("CSV ends inside a quoted field");
  if (field !== "" || record.length) {
    record.push(field);
    yield record;
  }
}

/** CSV records → objects keyed by the header row; a record of the wrong width stops. */
export async function* csvObjects(records) {
  let header = null;
  for await (const record of records) {
    if (!header) {
      header = record;
      continue;
    }
    if (record.length !== header.length) {
      throw new Error(
        `CSV record ${record[0]} has ${record.length} fields, the header ${header.length}`
      );
    }
    yield Object.fromEntries(header.map((name, i) => [name, record[i]]));
  }
}

/**
 * The uncompressed bytes of the first entry whose name passes `test`, as a stream. Handles
 * the stored and deflate methods of a plain (not ZIP64) archive, which is all GED uses.
 * @param {Buffer} zip
 */
export function zipEntryStream(zip, test = (name) => name.endsWith(".csv")) {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip archive");
  let entry = zip.readUInt32LE(end + 16);
  for (let n = zip.readUInt16LE(end + 10); n > 0; n--) {
    if (zip.readUInt32LE(entry) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const method = zip.readUInt16LE(entry + 10);
    const size = zip.readUInt32LE(entry + 20);
    const nameLength = zip.readUInt16LE(entry + 28);
    const local = zip.readUInt32LE(entry + 42);
    const name = zip.toString("utf8", entry + 46, entry + 46 + nameLength);
    if (test(name)) {
      if (size === 0xffffffff) throw new Error(`zip entry ${name} needs ZIP64`);
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      if (method === 0) return [data];
      if (method !== 8) throw new Error(`zip entry ${name} uses compression method ${method}`);
      const inflate = createInflateRaw();
      inflate.end(data);
      return inflate;
    }
    entry += 46 + nameLength + zip.readUInt16LE(entry + 30) + zip.readUInt16LE(entry + 32);
  }
  throw new Error("zip archive has no matching entry");
}

async function downloadZip(url, fetchImpl) {
  let lastError = null;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`UCDP GED download failed: ${lastError?.message} (${url})`, {
    cause: lastError,
  });
}

/**
 * War-death count rows from GED: from UCDP_GED_FILE (a downloaded .zip or .csv) when set,
 * otherwise from the UCDP download.
 */
export async function fetchUcdpWarDeaths({ fetchImpl = globalThis.fetch } = {}) {
  const file = process.env.UCDP_GED_FILE;
  let csv;
  if (file) csv = file.endsWith(".zip") ? zipEntryStream(await readFile(file)) : createReadStream(file);
  else csv = zipEntryStream(await downloadZip(UCDP_GED_URL, fetchImpl));
  const result = await warDeathCountRows(csvObjects(csvRecords(csv)));
  return { ...result, status: file ? "file" : "downloaded" };
}
