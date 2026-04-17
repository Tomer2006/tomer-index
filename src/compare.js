import { escapeHtml, formatInt } from "./format.js";

const $picks = document.getElementById("compare-picks");
const $btnAdd = document.getElementById("btn-add");
const $compareOut = document.getElementById("compare-out");
const $status = document.getElementById("status");

let cache = [];
/** Currently picked ISO3 codes (ordered), `""` for empty pickers. */
let selections = [""];
let slotSeq = 0;

function rankForCountry(iso) {
  const i = cache.findIndex((c) => c.iso === iso);
  return i < 0 ? "—" : String(i + 1);
}

function sortedOptionsHtml() {
  const sorted = [...cache].sort((a, b) => a.name.localeCompare(b.name));
  return [
    `<option value="">— Select —</option>`,
    ...sorted.map(
      (r) => `<option value="${r.iso}">${escapeHtml(r.name)}</option>`
    ),
  ].join("");
}

/** Keep `selections` aligned with the pickers in the DOM (order = columns). */
function syncSelectionsFromDom() {
  const selects = $picks.querySelectorAll("select.compare-select");
  selections = Array.from(selects, (el) => el.value);
}

function refreshCompare() {
  syncSelectionsFromDom();
  renderCompareOut();
}

function renderPicks() {
  const options = sortedOptionsHtml();
  $picks.replaceChildren();

  selections.forEach((iso, i) => {
    const id = `compare-pick-${slotSeq++}`;
    const wrap = document.createElement("div");
    wrap.className = "compare-pick";

    const label = document.createElement("label");
    label.className = "compare-label";
    label.setAttribute("for", id);
    label.textContent = `Country ${i + 1}`;

    const select = document.createElement("select");
    select.className = "compare-select";
    select.id = id;
    select.innerHTML = options;
    select.value = iso;

    label.appendChild(select);
    wrap.appendChild(label);

    if (selections.length > 1) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "compare-remove";
      remove.setAttribute("aria-label", `Remove country ${i + 1}`);
      remove.textContent = "✕";
      remove.addEventListener("click", () => {
        selections.splice(i, 1);
        renderPicks();
        refreshCompare();
      });
      wrap.appendChild(remove);
    }

    $picks.appendChild(wrap);
  });
}

$picks.addEventListener("change", (e) => {
  if (!(e.target instanceof HTMLSelectElement) || !e.target.matches(".compare-select"))
    return;
  refreshCompare();
});

$picks.addEventListener("input", (e) => {
  if (!(e.target instanceof HTMLSelectElement) || !e.target.matches(".compare-select"))
    return;
  refreshCompare();
});

/** Which columns have the best value (ties all get green). `lower` = rank, homicides. */
function bestCols(nums, lower) {
  const ok = nums
    .map((n, i) => (Number.isFinite(n) ? { i, n } : null))
    .filter(Boolean);
  if (!ok.length) return new Set();
  const edge = lower
    ? Math.min(...ok.map((x) => x.n))
    : Math.max(...ok.map((x) => x.n));
  return new Set(ok.filter((x) => x.n === edge).map((x) => x.i));
}

function renderCompareOut() {
  const filled = selections
    .map((iso) => (iso ? cache.find((c) => c.iso === iso) : null))
    .filter((x) => x != null);

  if (!filled.length) {
    $compareOut.innerHTML =
      '<p class="compare-hint">Pick a country to begin.</p>';
    return;
  }

  if (hasDuplicateIsos(selections)) {
    $compareOut.innerHTML =
      '<p class="compare-hint">Duplicate country selected—pick different countries in each slot.</p>';
    return;
  }

  const hStr = (r) =>
    typeof r.homicidesPer100k === "number" && !Number.isNaN(r.homicidesPer100k)
      ? r.homicidesPer100k.toFixed(1)
      : "—";
  const haleStr = (r) =>
    typeof r.hale === "number" && !Number.isNaN(r.hale)
      ? r.hale.toFixed(1)
      : "—";

  const rankNums = filled.map((r) => {
    const i = cache.findIndex((c) => c.iso === r.iso);
    return i < 0 ? NaN : i + 1;
  });
  const bestRank = bestCols(rankNums, true);
  const bestLe = bestCols(
    filled.map((r) => r.le),
    false
  );
  const bestHale = bestCols(
    filled.map((r) =>
      typeof r.hale === "number" && !Number.isNaN(r.hale) ? r.hale : NaN
    ),
    false
  );
  const bestGni = bestCols(
    filled.map((r) =>
      typeof r.gni === "number" && Number.isFinite(r.gni) ? r.gni : NaN
    ),
    false
  );
  const bestHom = bestCols(
    filled.map((r) =>
      typeof r.homicidesPer100k === "number" && !Number.isNaN(r.homicidesPer100k)
        ? r.homicidesPer100k
        : NaN
    ),
    true
  );
  const bestTomer = bestCols(
    filled.map((r) => {
      const v = r.customIndex ?? r.customHdi;
      return typeof v === "number" && Number.isFinite(v) ? v : NaN;
    }),
    false
  );

  const multi = filled.length >= 2;
  const green = (cols) => (multi ? cols : new Set());

  const headCells = filled
    .map((r) => `<th scope="col">${escapeHtml(r.name)}</th>`)
    .join("");

  const row = (label, texts, cols) => `
    <tr>
      <th scope="row">${label}</th>
      ${texts
        .map((v, i) => {
          const cls = cols.has(i) ? ' class="compare-best"' : "";
          return `<td${cls}>${v}</td>`;
        })
        .join("")}
    </tr>
  `;

  const tableClass =
    filled.length === 1 ? "compare-table compare-single" : "compare-table";

  $compareOut.innerHTML = `
    <div class="compare-table-wrap">
      <table class="${tableClass}">
        <thead>
          <tr>
            <th scope="col">Metric</th>
            ${headCells}
          </tr>
        </thead>
        <tbody>
          ${row(
            "Leaderboard rank",
            filled.map((r) => rankForCountry(r.iso)),
            green(bestRank)
          )}
          ${row(
            "Life exp. (years)",
            filled.map((r) => r.le.toFixed(1)),
            green(bestLe)
          )}
          ${row("HALE (years)", filled.map((r) => haleStr(r)), green(bestHale))}
          ${row(
            "GNI pc (PPP)",
            filled.map((r) => formatInt(r.gni)),
            green(bestGni)
          )}
          ${row(
            "Homicides /100k",
            filled.map((r) => hStr(r)),
            green(bestHom)
          )}
          ${row(
            "Tomer index",
            filled.map((r) =>
              (r.customIndex ?? r.customHdi ?? 0).toFixed(3)
            ),
            green(bestTomer)
          )}
        </tbody>
      </table>
    </div>
  `;
}

function hasDuplicateIsos(list) {
  const seen = new Set();
  for (const iso of list) {
    if (!iso) continue;
    if (seen.has(iso)) return true;
    seen.add(iso);
  }
  return false;
}

$btnAdd.addEventListener("click", () => {
  selections.push("");
  renderPicks();
  refreshCompare();
  const selects = $picks.querySelectorAll("select.compare-select");
  selects[selects.length - 1]?.focus();
});

async function load() {
  const res = await fetch(`${import.meta.env.BASE_URL}data/countries.json`);
  if (!res.ok) {
    throw new Error(
      `Missing public/data/countries.json (${res.status}). Run: npm run build-data`
    );
  }
  const payload = await res.json();
  cache = payload.countries ?? [];
  const n = cache.length;
  const when = payload.generatedAt
    ? ` Data snapshot: ${new Date(payload.generatedAt).toLocaleString()}.`
    : "";
  $status.textContent = n ? `${n} countries.${when}` : "No countries in data file.";
  renderPicks();
  refreshCompare();
}

load().catch((e) => {
  console.error(e);
  $status.textContent = e instanceof Error ? e.message : "Could not load data.";
  $status.classList.add("error");
});
