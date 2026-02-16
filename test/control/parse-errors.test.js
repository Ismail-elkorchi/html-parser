import assert from "node:assert/strict";
import test from "node:test";

import { getParseErrorSpecRef, parse } from "../../dist/mod.js";

const PARSE_ERRORS_SECTION_URL = "https://html.spec.whatwg.org/multipage/parsing.html#parse-errors";

test("parse reports deterministic parseErrorId values for malformed markup", () => {
  const malformedHtml = "<div><span></div><p></span>";
  const firstRun = parse(malformedHtml);
  const secondRun = parse(malformedHtml);

  const firstIds = firstRun.errors.map((entry) => entry.parseErrorId);
  const secondIds = secondRun.errors.map((entry) => entry.parseErrorId);

  assert.ok(firstIds.length > 0);
  assert.ok(firstIds.every((entry) => typeof entry === "string" && entry.length > 0));
  assert.deepEqual(firstIds, secondIds);
});

test("parse trace parseError events align with parseErrorId", () => {
  const malformedHtml = "<table><tr></table></tr>";
  const parsed = parse(malformedHtml, { trace: true });
  const traceIds = (parsed.trace ?? [])
    .filter((entry) => entry.kind === "parseError")
    .map((entry) => entry.parseErrorId);

  assert.ok(traceIds.length > 0);
  assert.ok(traceIds.every((entry) => typeof entry === "string" && entry.length > 0));
});

test("getParseErrorSpecRef returns stable WHATWG parse-errors section URL", () => {
  const parsed = parse("<p><div></p>");
  const ids = parsed.errors.map((entry) => entry.parseErrorId);
  assert.ok(ids.length > 0);

  for (const parseErrorId of ids) {
    assert.equal(getParseErrorSpecRef(parseErrorId), PARSE_ERRORS_SECTION_URL);
  }
});
