import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-static";

export async function GET() {
  const names = ["leaderboard.json", "series.json", "world.geojson"];
  const datasets = await Promise.all(names.map(async (name) =>
    JSON.parse(await readFile(join(process.cwd(), "public", "data", name), "utf8")),
  ));
  return Response.json(Object.fromEntries(names.map((name, index) => [name, datasets[index]])), {
    headers: { "Content-Disposition": 'attachment; filename="tomer-index-all-data.json"' },
  });
}
