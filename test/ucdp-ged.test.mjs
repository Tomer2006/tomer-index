import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

import {
  csvObjects,
  csvRecords,
  eventDeathsByCountry,
  warDeathCountRows,
  zipEntryStream,
} from "../scripts/ucdp-ged.mjs";

function event(fields) {
  return {
    id: "1",
    year: "2024",
    type_of_violence: "1",
    country_id: "666",
    adm_1: "",
    gwnoa: "",
    gwnob: "",
    deaths_a: "0",
    deaths_b: "0",
    deaths_civilians: "0",
    deaths_unknown: "0",
    ...fields,
  };
}

async function collect(iterable) {
  const out = [];
  for await (const item of iterable) out.push(item);
  return out;
}

test("government soldiers count for their country; others for where they died", () => {
  // Russia (365) against Ukraine (369), fought in Ukraine.
  const war = event({
    country_id: "369",
    gwnoa: "365",
    gwnob: "369",
    deaths_a: "40",
    deaths_b: "10",
    deaths_civilians: "3",
    deaths_unknown: "2",
  });
  assert.deepEqual(eventDeathsByCountry(war), [
    ["RUS", 40],
    ["UKR", 10],
    ["UKR", 5],
  ]);
  // An armed group's fighters have no government side, so they count where they died.
  const rebels = event({ country_id: "645", gwnoa: "645", deaths_a: "4", deaths_b: "9" });
  assert.deepEqual(eventDeathsByCountry(rebels), [
    ["IRQ", 4],
    ["IRQ", 9],
  ]);
  // A coalition's deaths count for the first government listed.
  const coalition = event({ country_id: "645", gwnoa: "2;200;900", deaths_a: "6" });
  assert.deepEqual(eventDeathsByCountry(coalition), [["USA", 6]]);
});

test("Gaza and the West Bank count as Palestine, not Israel", () => {
  const gaza = event({
    adm_1: "Gaza Strip",
    gwnoa: "666",
    deaths_a: "2",
    deaths_b: "30",
    deaths_civilians: "70",
  });
  assert.deepEqual(eventDeathsByCountry(gaza), [
    ["ISR", 2],
    ["PSE", 30],
    ["PSE", 70],
  ]);
  const westBank = event({ adm_1: "West Bank", deaths_civilians: "1" });
  assert.deepEqual(eventDeathsByCountry(westBank), [["PSE", 1]]);
  const israel = event({ adm_1: "Southern district", type_of_violence: "3", deaths_civilians: "5" });
  assert.deepEqual(eventDeathsByCountry(israel), [["ISR", 5]]);
});

test("non-state conflict is left out, and bad events stop the build", () => {
  assert.deepEqual(eventDeathsByCountry(event({ type_of_violence: "2", deaths_a: "8" })), []);
  assert.throws(() => eventDeathsByCountry(event({ country_id: "999" })), /code 999/);
  assert.throws(() => eventDeathsByCountry(event({ deaths_b: "" })), /deaths_b/);
});

test("death counts add up per country and year", async () => {
  const { rows, latestYear, eventCount } = await warDeathCountRows([
    event({ year: "2023", country_id: "369", deaths_civilians: "3" }),
    event({ year: "2023", country_id: "369", deaths_unknown: "4" }),
    event({ year: "2024", country_id: "369", gwnoa: "365", deaths_a: "5" }),
    event({ year: "2024", type_of_violence: "2", deaths_a: "9" }),
  ]);
  assert.deepEqual(rows, [
    { countryiso3code: "UKR", date: "2023", value: 7 },
    { countryiso3code: "RUS", date: "2024", value: 5 },
  ]);
  assert.equal(latestYear, 2024);
  assert.equal(eventCount, 4);
});

test("CSV records split only at newlines outside quotes", async () => {
  const text = 'id,note,n\r\n1,"a, ""b""\nc",2\n2,line sep,3\n3,,4';
  // Chunk boundaries fall inside a quoted field and between the two quotes of "".
  const chunks = [text.slice(0, 10), text.slice(10, 13), text.slice(13)];
  assert.deepEqual(await collect(csvObjects(csvRecords(chunks))), [
    { id: "1", note: 'a, "b"\nc', n: "2" },
    { id: "2", note: "line sep", n: "3" },
    { id: "3", note: "", n: "4" },
  ]);
  await assert.rejects(collect(csvObjects(csvRecords(["a,b\n1,2,3\n"]))), /3 fields/);
  await assert.rejects(collect(csvRecords(['a,"b\n'])), /quoted field/);
});

test("the CSV inside a zip archive is inflated", async () => {
  const content = Buffer.from("id,year\n1,2025\n");
  const data = deflateRawSync(content);
  const name = Buffer.from("GEDEvent.csv");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const centralStart = local.length + name.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(centralStart, 16);
  const zip = Buffer.concat([local, name, data, central, name, end]);
  const chunks = await collect(zipEntryStream(zip));
  assert.equal(Buffer.concat(chunks).toString(), content.toString());
  assert.throws(() => zipEntryStream(zip, (entry) => entry.endsWith(".txt")), /no matching entry/);
  assert.throws(() => zipEntryStream(Buffer.alloc(40)), /not a zip/);
});
