import assert from "node:assert/strict";
import test from "node:test";

import { expandKnownDifferenceGroups } from
  "../../scripts/oracles/document-browser-baseline.mjs";

test("document browser baselines expand to reviewed per-case evidence", () => {
  const inventory = expandKnownDifferenceGroups([
    {
      classification: "implementation-lag",
      explanation: "Pinned behavior differs in these exact cases.",
      engines: ["chromium", "firefox"],
      caseIds: ["case:one"],
      caseIdPrefix: "case:",
      caseNumbers: [2, 3]
    }
  ], ["chromium", "firefox", "webkit"]);

  assert.deepEqual([...inventory.get("chromium").keys()], ["case:one", "case:2", "case:3"]);
  assert.deepEqual(inventory.get("firefox").get("case:2"), {
    classification: "implementation-lag",
    explanation: "Pinned behavior differs in these exact cases."
  });
  assert.equal(inventory.get("webkit").size, 0);
});

test("document browser baselines reject unclassified and ambiguous evidence", () => {
  assert.throws(
    () => expandKnownDifferenceGroups(undefined, ["chromium"]),
    /reviewed known-difference groups/
  );
  assert.throws(
    () => expandKnownDifferenceGroups([{
      classification: "lag",
      explanation: "reason",
      engines: ["unknown"],
      caseIds: ["case"]
    }], ["chromium"]),
    /unsupported engine unknown/
  );
  assert.throws(
    () => expandKnownDifferenceGroups([{
      classification: "lag",
      explanation: "reason",
      engines: ["chromium"],
      caseIds: ["case", "case"]
    }], ["chromium"]),
    /classifies case twice/
  );
});
