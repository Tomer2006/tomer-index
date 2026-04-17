export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatInt(n) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    Math.round(n)
  );
}
