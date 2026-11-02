/**
 * Per-year snapshots ({ [year]: { [iso]: point } }) derived from the entry series, so a
 * page that needs one year doesn't have to download every entry's full history.
 */
export function yearSnapshots(entrySeries) {
  const years = {};
  for (const [iso, entry] of Object.entries(entrySeries)) {
    for (const point of entry.points ?? []) {
      (years[point.year] ??= {})[iso] = point;
    }
  }
  return years;
}
