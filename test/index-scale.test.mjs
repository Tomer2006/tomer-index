import assert from "node:assert/strict";
import test from "node:test";

import { formatTomer, formatTomerAxis } from "../src/index-scale.js";

test("Tomer values are shown ×100, past 100 too", () => {
  assert.equal(formatTomer(0.95123), "95.12");
  assert.equal(formatTomerAxis(0.95123), "95.1");
  assert.equal(formatTomer(1.07034), "107.03");
});
