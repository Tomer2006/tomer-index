const STORAGE_KEY = "tomer-index-scale";
const VALID = new Set([1, 10, 100]);
const DEFAULT_SCALE = 100;

const PRECISION = { 1: 4, 10: 3, 100: 2 };
const AXIS_PRECISION = { 1: 3, 10: 2, 100: 1 };

const listeners = new Set();

export function getScale() {
  try {
    const raw = parseInt(localStorage.getItem(STORAGE_KEY), 10);
    return VALID.has(raw) ? raw : DEFAULT_SCALE;
  } catch {
    return DEFAULT_SCALE;
  }
}

export function setScale(scale) {
  const next = Number(scale);
  if (!VALID.has(next)) return;
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {}
  for (const cb of listeners) cb(next);
}

export function onScaleChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function formatTomer(v01) {
  const s = getScale();
  if (typeof v01 !== "number" || !Number.isFinite(v01)) return "—";
  return (v01 * s).toFixed(PRECISION[s]);
}

export function formatTomerAxis(v01) {
  const s = getScale();
  if (typeof v01 !== "number" || !Number.isFinite(v01)) return "—";
  return (v01 * s).toFixed(AXIS_PRECISION[s]);
}

export function scaleSuffix() {
  const s = getScale();
  return s === 1 ? "/1" : s === 10 ? "/10" : "/100";
}

export function renderScaleControl(container) {
  if (!container) return;
  container.innerHTML = `
    <fieldset class="scale-control">
      <legend class="scale-control-legend">Index scale</legend>
      <div class="scale-control-options" role="radiogroup" aria-label="Tomer index display scale">
        <label class="scale-control-option">
          <input type="radio" name="tomer-scale" value="1" />
          <span>0&ndash;1</span>
        </label>
        <label class="scale-control-option">
          <input type="radio" name="tomer-scale" value="10" />
          <span>0&ndash;10</span>
        </label>
        <label class="scale-control-option">
          <input type="radio" name="tomer-scale" value="100" />
          <span>0&ndash;100</span>
        </label>
      </div>
    </fieldset>
  `;

  const inputs = container.querySelectorAll("input[name='tomer-scale']");
  const current = String(getScale());
  for (const input of inputs) {
    if (input.value === current) input.checked = true;
    input.addEventListener("change", () => {
      if (input.checked) setScale(parseInt(input.value, 10));
    });
  }
}
