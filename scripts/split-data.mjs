// Derives the files the app fetches (public/app-data, gitignored) from the committed
// datasets in public/data: copies of the three datasets plus one small file per entry
// history and per year, so pages download only what they draw.
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { yearSnapshots } from "../src/data-split.js";

const SOURCE = new URL("../public/data/", import.meta.url);
const OUT = new URL("../public/app-data/", import.meta.url);

await rm(OUT, { recursive: true, force: true });
await mkdir(new URL("entry/", OUT), { recursive: true });
await mkdir(new URL("year/", OUT), { recursive: true });

for (const file of ["leaderboard.json", "series.json", "world.geojson"]) {
  await copyFile(new URL(file, SOURCE), new URL(file, OUT));
}

const { entrySeries } = JSON.parse(
  await readFile(new URL("series.json", SOURCE), "utf8"),
);
for (const [iso, entry] of Object.entries(entrySeries)) {
  await writeFile(new URL(`entry/${iso}.json`, OUT), JSON.stringify(entry));
}
const years = yearSnapshots(entrySeries);
for (const [year, points] of Object.entries(years)) {
  await writeFile(new URL(`year/${year}.json`, OUT), JSON.stringify(points));
}
console.log(
  `app-data: ${Object.keys(entrySeries).length} entry files, ${Object.keys(years).length} year files`,
);
