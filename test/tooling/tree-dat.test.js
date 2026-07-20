import assert from "node:assert/strict";
import test from "node:test";

import {
  expandTreeDatCases,
  parseTreeDatFixtures,
  TREE_DAT_NAMESPACES,
  TreeDatFormatError
} from "../support/tree-dat.mjs";

test("tree .dat reader preserves raw input and fragment namespace identity", () => {
  const content = [
    "#data",
    "",
    "alpha\r",
    "#errors",
    "one error",
    "#document-fragment",
    "svg path",
    "#script-off",
    "#document",
    "| <svg path>",
    ""
  ].join("\n");
  const cases = parseTreeDatFixtures(content, "resources/raw.dat");

  assert.equal(cases.length, 1);
  assert.equal(cases[0].data, "\nalpha\r");
  assert.equal(cases[0].expected, "| <svg path>");
  assert.deepEqual(cases[0].fragmentContext, {
    namespaceUri: TREE_DAT_NAMESPACES.svg,
    localName: "path"
  });
  assert.equal(cases[0].scripting, "disabled");
  assert.equal(cases[0].errorsDeclared, true);
  assert.equal(cases[0].sawUnnamedErrors, true);
  assert.equal(cases[0].sawNamedErrors, false);

  const executions = expandTreeDatCases(cases);
  assert.deepEqual(executions.map((fixtureCase) => fixtureCase.id), [
    "resources/raw.dat#1@script-off"
  ]);
});

test("tree .dat reader retains separate unnamed and named diagnostic sections", () => {
  const content = [
    "#data",
    "<?target?>",
    "#errors",
    "unnamed error",
    "#new-errors",
    "named-error",
    "#document",
    "| <?target ?>",
    "",
    ""
  ].join("\n");
  const [fixtureCase] = parseTreeDatFixtures(content, "resources/errors.dat");

  assert.deepEqual(fixtureCase.unnamedErrors, ["unnamed error"]);
  assert.deepEqual(fixtureCase.namedErrors, ["named-error"]);
  assert.equal(fixtureCase.sawUnnamedErrors, true);
  assert.equal(fixtureCase.sawNamedErrors, true);
  assert.equal(fixtureCase.expected, "| <?target ?>");
});

test("tree .dat reader expands an unspecified scripting flag in both modes", () => {
  const content = [
    "#data",
    "<p>x",
    "#document",
    "| <html>",
    "|   <head>",
    "|   <body>",
    "|     <p>",
    "|       \"x\"",
    ""
  ].join("\n");
  const cases = parseTreeDatFixtures(content, "resources/example.dat");

  assert.equal(cases[0].errorsDeclared, false);
  assert.deepEqual(
    expandTreeDatCases(cases).map((fixtureCase) => ({
      id: fixtureCase.id,
      scriptingEnabled: fixtureCase.scriptingEnabled
    })),
    [
      { id: "resources/example.dat#1@script-off", scriptingEnabled: false },
      { id: "resources/example.dat#1@script-on", scriptingEnabled: true }
    ]
  );
});

test("tree .dat reader reports malformed fragment and document sections", () => {
  assert.throws(
    () => parseTreeDatFixtures(
      "#data\n<p>\n#document-fragment\n#document\n| <p>\n",
      "resources/malformed.dat"
    ),
    TreeDatFormatError
  );
  assert.throws(
    () => parseTreeDatFixtures("#data\n<p>\n#errors\n", "resources/malformed.dat"),
    /missing #document/
  );
});
