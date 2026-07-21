import assert from "node:assert/strict";
import test from "node:test";

import { getParseErrorSpecRef, parse } from "../../dist/mod.js";

const PARSE_ERRORS_SECTION_URL = "https://html.spec.whatwg.org/multipage/parsing.html#parse-errors";

test("parse reports deterministic parseErrorId values for malformed markup", () => {
  const malformedHtml = "<div><span></div><p></span>";
  const { tree: firstRun } = parse(malformedHtml);
  const { tree: secondRun } = parse(malformedHtml);

  const firstIds = firstRun.errors.map((entry) => entry.parseErrorId);
  const secondIds = secondRun.errors.map((entry) => entry.parseErrorId);

  assert.ok(firstIds.length > 0);
  assert.ok(firstIds.every((entry) => typeof entry === "string" && entry.length > 0));
  assert.deepEqual(firstIds, secondIds);
});

test("parse trace parseError events align with parseErrorId", () => {
  const malformedHtml = "<table><tr></table></tr>";
  const { tree: parsed } = parse(malformedHtml, { trace: "events" });
  assert.equal(parsed.trace?.mode, "events");
  const traceIds = parsed.trace.events
    .filter((entry) => entry.kind === "parseError")
    .map((entry) => entry.parseErrorId);

  assert.ok(traceIds.length > 0);
  assert.ok(traceIds.every((entry) => typeof entry === "string" && entry.length > 0));
});

test("getParseErrorSpecRef returns dedicated anchors and the unnamed-error section", () => {
  const { tree: parsed } = parse("<p><div></p>");
  const ids = parsed.errors.map((entry) => entry.parseErrorId);
  assert.ok(ids.length > 0);

  for (const parseErrorId of ids) {
    assert.equal(getParseErrorSpecRef(parseErrorId), PARSE_ERRORS_SECTION_URL);
  }
  assert.equal(
    getParseErrorSpecRef("missing-doctype-name"),
    "https://html.spec.whatwg.org/multipage/parsing.html#parse-error-missing-doctype-name"
  );
  assert.equal(getParseErrorSpecRef("vendor:unknown"), PARSE_ERRORS_SECTION_URL);
});

test("public parse diagnostics expose only fields the parser can populate", () => {
  const error = parse("<p><div></p>").tree.errors[0];
  assert.ok(error);
  assert.equal(Object.hasOwn(error, "nodeId"), false);
});
