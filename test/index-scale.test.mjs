import assert from "node:assert/strict";
import test from "node:test";

import { formatTomer, formatTomerAxis } from "../src/index-scale.js";

test("Tomer values always use the 0-100 display scale", () => {
  assert.equal(formatTomer(0.95123), "95.12");
  assert.equal(formatTomerAxis(0.95123), "95.1");
});
