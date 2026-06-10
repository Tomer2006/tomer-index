/**
 * Shared SVG line-chart primitives used by the leaderboard world chart
 * (main.js), the entry-page metric charts (entry.js), and the compare
 * charts (compare.js). Each page keeps its own tooltip content and series
 * styling; the frame, scales, hover plumbing, and tooltip positioning
 * live here.
 */

const NS = "http://www.w3.org/2000/svg";

export function svgEl(name, attrs = {}) {
  const el = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
  return el;
}

export function clientToSvgPoint(svg, clientX, clientY) {
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  return point.matrixTransform(matrix.inverse());
}

export function svgToClientPoint(svg, x, y) {
  const point = svg.createSVGPoint();
  point.x = x;
  point.y = y;
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  return point.matrixTransform(matrix);
}

/**
 * Builds the chart frame: root <svg> with horizontal grid lines, y-axis
 * labels, and three x-axis year labels. Returns the svg plus the xAt/yAt
 * scales and inner-area geometry the caller needs for series and hover.
 */
export function chartFrame({
  w,
  h,
  padL,
  padR,
  padT,
  padB,
  y0,
  y1,
  yearLo,
  yearHi,
  yLabel,
  className,
  ariaLabel,
}) {
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const xAt = (year) => padL + ((year - yearLo) / (yearHi - yearLo || 1)) * innerW;
  const yAt = (v) => padT + innerH - ((v - y0) / (y1 - y0 || 1)) * innerH;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${w} ${h}`,
    class: className,
    preserveAspectRatio: "xMidYMid meet",
  });
  if (ariaLabel) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", ariaLabel);
  }

  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const v = y0 + (1 - t) * (y1 - y0);
    const gy = padT + t * innerH;
    svg.appendChild(
      svgEl("line", {
        x1: padL,
        x2: padL + innerW,
        y1: gy,
        y2: gy,
        class: "global-series-grid",
      })
    );
    const lab = svgEl("text", {
      x: padL - 8,
      y: gy + 4,
      "text-anchor": "end",
      class: "global-series-axis",
    });
    lab.textContent = yLabel(v);
    svg.appendChild(lab);
  }

  for (let i = 0; i <= 2; i++) {
    const year = Math.round(yearLo + (i / 2) * (yearHi - yearLo));
    const lab = svgEl("text", {
      x: xAt(year),
      y: h - 12,
      "text-anchor": "middle",
      class: "global-series-axis",
    });
    lab.textContent = String(year);
    svg.appendChild(lab);
  }

  return { svg, xAt, yAt, innerW, innerH, padL, padT };
}

export function linePath(points, xAt, yAt, getYear, getValue) {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(getYear(p))},${yAt(getValue(p))}`)
    .join(" ");
}

/** Vertical hover guide, hidden until positioned. */
export function hoverLineEl(svg, padT, innerH, className = "metric-hover-line") {
  const line = svgEl("line", { y1: padT, y2: padT + innerH, class: className });
  line.style.display = "none";
  svg.appendChild(line);
  return line;
}

export function hoverDotEl(svg, { className = "metric-hover-dot", r = 4.5, fill } = {}) {
  const dot = svgEl("circle", { r, class: className });
  if (fill) dot.setAttribute("fill", fill);
  dot.style.display = "none";
  svg.appendChild(dot);
  return dot;
}

/** Transparent rect that keeps pointer events alive over the plot area. */
export function hitRectEl(svg, padL, padT, innerW, innerH) {
  const hit = svgEl("rect", {
    x: padL,
    y: padT,
    width: innerW,
    height: innerH,
    class: "metric-chart-hit",
  });
  svg.appendChild(hit);
  return hit;
}

export function createTooltip(chartEl, className = "metric-tooltip") {
  const tooltip = document.createElement("div");
  tooltip.className = className;
  tooltip.hidden = true;
  tooltip.setAttribute("role", "status");
  chartEl.appendChild(tooltip);
  return tooltip;
}

/** Clamp-position a tooltip near an svg-coordinate point. */
export function positionTooltip(tooltip, chartEl, svg, x, y, { xMargin = 72, yMin = 28 } = {}) {
  const chartRect = chartEl.getBoundingClientRect();
  const screenPoint = svgToClientPoint(svg, x, y);
  const left = Math.max(
    xMargin,
    Math.min(screenPoint.x - chartRect.left, chartRect.width - xMargin)
  );
  const top = Math.max(yMin, screenPoint.y - chartRect.top);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

export function nearestByYear(items, year, getYear = (item) => item.year) {
  let closest = items[0];
  let best = Infinity;
  for (const item of items) {
    const delta = Math.abs(getYear(item) - year);
    if (delta < best) {
      closest = item;
      best = delta;
    }
  }
  return closest;
}

/**
 * Translates pointer events over the plot area into fractional years and
 * invokes the callbacks. `onLeave` is bound to pointerleave and blur.
 */
export function bindPointerYear(svg, { padL, innerW, yearLo, yearHi }, { onMove, onClick, onLeave }) {
  const yearAt = (e) => {
    const svgPoint = clientToSvgPoint(svg, e.clientX, e.clientY);
    const clampedX = Math.max(padL, Math.min(svgPoint.x, padL + innerW));
    return yearLo + ((clampedX - padL) / innerW) * (yearHi - yearLo || 1);
  };
  if (onMove) svg.addEventListener("pointermove", (e) => onMove(yearAt(e)));
  if (onClick) svg.addEventListener("click", (e) => onClick(yearAt(e)));
  if (onLeave) {
    svg.addEventListener("pointerleave", onLeave);
    svg.addEventListener("blur", onLeave);
  }
}
