const HTML_NAMESPACE_URI = "http://www.w3.org/1999/xhtml";
const SVG_NAMESPACE_URI = "http://www.w3.org/2000/svg";
const MATHML_NAMESPACE_URI = "http://www.w3.org/1998/Math/MathML";

export class TreeDatFormatError extends Error {
  constructor(filePath, caseNumber, message) {
    super(`${filePath}#${String(caseNumber)}: ${message}`);
    this.name = "TreeDatFormatError";
  }
}

function parseFragmentContext(rawContext, filePath, caseNumber) {
  if (rawContext.length === 0) {
    throw new TreeDatFormatError(filePath, caseNumber, "fragment context is empty");
  }

  if (rawContext.startsWith("svg ")) {
    return Object.freeze({
      namespaceUri: SVG_NAMESPACE_URI,
      localName: rawContext.slice(4)
    });
  }

  if (rawContext.startsWith("math ")) {
    return Object.freeze({
      namespaceUri: MATHML_NAMESPACE_URI,
      localName: rawContext.slice(5)
    });
  }

  return Object.freeze({
    namespaceUri: HTML_NAMESPACE_URI,
    localName: rawContext
  });
}

function finishCase(current, fixtureCases, filePath) {
  if (current === null) {
    return;
  }

  const caseNumber = fixtureCases.length + 1;
  if (!current.sawDocument) {
    throw new TreeDatFormatError(filePath, caseNumber, "missing #document");
  }
  if (current.expectsFragmentContext && current.fragmentContext === null) {
    throw new TreeDatFormatError(filePath, caseNumber, "missing fragment context line");
  }

  while (current.documentLines.at(-1) === "") {
    current.documentLines.pop();
  }

  fixtureCases.push(Object.freeze({
    id: `${filePath}#${String(caseNumber)}`,
    file: filePath,
    caseNumber,
    data: current.dataLines.join("\n"),
    unnamedErrors: Object.freeze([...current.unnamedErrors]),
    namedErrors: Object.freeze([...current.namedErrors]),
    sawUnnamedErrors: current.sawUnnamedErrors,
    sawNamedErrors: current.sawNamedErrors,
    errorsDeclared: current.sawUnnamedErrors || current.sawNamedErrors,
    expected: current.documentLines.join("\n"),
    fragmentContext: current.fragmentContext,
    scripting: current.scripting
  }));
}

/** Parses the maintained WPT tree-construction .dat format without normalizing input text. */
export function parseTreeDatFixtures(content, filePath) {
  if (typeof content !== "string") {
    throw new TypeError("content must be a string");
  }
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new TypeError("filePath must be a non-empty string");
  }

  const fixtureCases = [];
  let current = null;
  let section = "";

  for (const line of content.split("\n")) {
    if (line === "#data") {
      finishCase(current, fixtureCases, filePath);
      current = {
        dataLines: [],
        unnamedErrors: [],
        namedErrors: [],
        documentLines: [],
        fragmentContext: null,
        expectsFragmentContext: false,
        scripting: "both",
        sawUnnamedErrors: false,
        sawNamedErrors: false,
        sawDocument: false
      };
      section = "data";
      continue;
    }

    if (current === null) {
      if (line.length > 0) {
        throw new TreeDatFormatError(filePath, 1, "content appears before the first #data");
      }
      continue;
    }

    if (line === "#errors") {
      current.sawUnnamedErrors = true;
      section = "unnamed-errors";
      continue;
    }
    if (line === "#new-errors" || line === "#errors-new") {
      current.sawNamedErrors = true;
      section = "named-errors";
      continue;
    }
    if (line === "#document-fragment") {
      current.expectsFragmentContext = true;
      section = "fragment";
      continue;
    }
    if (line === "#script-on") {
      current.scripting = "enabled";
      section = "";
      continue;
    }
    if (line === "#script-off") {
      current.scripting = "disabled";
      section = "";
      continue;
    }
    if (line === "#document") {
      current.sawDocument = true;
      section = "document";
      continue;
    }

    if (section === "data") {
      current.dataLines.push(line);
    } else if (section === "unnamed-errors") {
      current.unnamedErrors.push(line);
    } else if (section === "named-errors") {
      current.namedErrors.push(line);
    } else if (section === "fragment") {
      const caseNumber = fixtureCases.length + 1;
      if (current.fragmentContext !== null) {
        throw new TreeDatFormatError(filePath, caseNumber, "fragment context has multiple lines");
      }
      current.fragmentContext = parseFragmentContext(line, filePath, caseNumber);
      section = "";
    } else if (section === "document") {
      current.documentLines.push(line);
    }
  }

  finishCase(current, fixtureCases, filePath);
  return Object.freeze(fixtureCases);
}

/** Expands a parsed case into its required scripting-mode executions. */
export function expandTreeDatCase(fixtureCase, options = {}) {
  const unspecifiedModes = options.unspecifiedModes ?? [false, true];
  const includeModeInId = options.includeModeInId ?? true;
  const scriptingModes = fixtureCase.scripting === "both"
    ? unspecifiedModes
    : [fixtureCase.scripting === "enabled"];

  return Object.freeze(scriptingModes.map((scriptingEnabled) => Object.freeze({
    ...fixtureCase,
    id: includeModeInId
      ? `${fixtureCase.id}@script-${scriptingEnabled ? "on" : "off"}`
      : fixtureCase.id,
    baseId: fixtureCase.id,
    scriptingEnabled
  })));
}

export function expandTreeDatCases(fixtureCases, options = {}) {
  return Object.freeze(fixtureCases.flatMap((fixtureCase) =>
    expandTreeDatCase(fixtureCase, options)
  ));
}

export const TREE_DAT_NAMESPACES = Object.freeze({
  html: HTML_NAMESPACE_URI,
  svg: SVG_NAMESPACE_URI,
  mathml: MATHML_NAMESPACE_URI
});
