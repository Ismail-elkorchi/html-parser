import {
  BudgetExceededError,
  PatchPlanningError,
  applyPatchPlan,
  chunk,
  computePatch,
  findAllByAttr,
  findAllByTagName,
  findById,
  getParseErrorSpecRef,
  outline,
  parse,
  parseFragment,
  textContent,
  tokenizeStream,
  visibleText,
  visibleTextTokens,
  walk,
  walkElements
} from "../../dist/mod.js";
import { writeJson } from "./eval-primitives.mjs";

function makeReportFailure(error) {
  return error instanceof Error ? error.message : String(error);
}

function walkNodes(nodes, visit) {
  for (const node of nodes) {
    visit(node);
    if (node.kind === "element") {
      walkNodes(node.children, visit);
    }
  }
}

function findFirstNode(nodes, predicate) {
  let match = null;
  walkNodes(nodes, (node) => {
    if (match !== null) {
      return;
    }
    if (predicate(node)) {
      match = node;
    }
  });
  return match;
}

function textBytes(value) {
  return new TextEncoder().encode(value).length;
}

function createByteStream(chunks) {
  const Stream = globalThis.ReadableStream;
  if (typeof Stream !== "function") {
    throw new Error("ReadableStream is unavailable in this runtime");
  }

  return new Stream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    }
  });
}

function evaluateTraceFeature() {
  const html = "<!doctype html><table><tr><td>x</td></tr></table>";
  const parseOptions = {
    trace: true,
    budgets: {
      maxInputBytes: 2048,
      maxTraceEvents: 64,
      maxTraceBytes: 8192
    }
  };

  const firstRun = parse(html, parseOptions);
  const secondRun = parse(html, parseOptions);
  const firstTrace = Array.isArray(firstRun.trace) ? firstRun.trace : [];
  const secondTrace = Array.isArray(secondRun.trace) ? secondRun.trace : [];

  const distinctKinds = [...new Set(firstTrace.map((event) => event.kind))];
  const hasAtLeastThreeKinds = distinctKinds.length >= 3;
  const hasBudgetEvent = firstTrace.some((event) => event.kind === "budget");
  const hasInsertionModeTransition = firstTrace.some((event) => event.kind === "insertionModeTransition");
  const deterministic = JSON.stringify(firstTrace) === JSON.stringify(secondTrace);

  const malformed = parse("<div><span></div>", {
    trace: true,
    budgets: {
      maxInputBytes: 2048,
      maxTraceEvents: 128,
      maxTraceBytes: 8192
    }
  });
  const malformedTrace = Array.isArray(malformed.trace) ? malformed.trace : [];
  const hasParseErrorEvent = malformedTrace.some((event) => event.kind === "parseError");

  let tightBudgetError = null;
  try {
    parse(html, {
      trace: true,
      budgets: {
        maxInputBytes: 2048,
        maxTraceEvents: 1,
        maxTraceBytes: 64
      }
    });
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      tightBudgetError = {
        budget: error.payload.budget,
        limit: error.payload.limit,
        actual: error.payload.actual
      };
    } else {
      throw error;
    }
  }

  const tightBudgetPass = tightBudgetError !== null;
  const ok =
    hasAtLeastThreeKinds &&
    hasBudgetEvent &&
    hasInsertionModeTransition &&
    hasParseErrorEvent &&
    deterministic &&
    tightBudgetPass;

  return {
    ok,
    details: {
      traceLength: firstTrace.length,
      distinctKinds,
      hasAtLeastThreeKinds,
      hasBudgetEvent,
      hasInsertionModeTransition,
      hasParseErrorEvent,
      deterministic,
      tightBudgetPass,
      tightBudgetError
    }
  };
}

function evaluateSpansFeature() {
  const html = "<div id=\"root\">hello <span>world</span></div>";
  const parsed = parse(html, { captureSpans: true });

  const firstElement = findFirstNode(parsed.children, (node) => node.kind === "element" && node.span !== undefined);
  const firstText = findFirstNode(parsed.children, (node) => node.kind === "text");

  const elementSpan = firstElement?.span;
  const textSpan = firstText?.span;

  const inBounds = (span) =>
    span !== undefined &&
    span.start >= 0 &&
    span.end >= span.start &&
    span.end <= html.length;

  const elementSpanOk = inBounds(elementSpan);
  const textSpanOk = inBounds(textSpan);
  const ok = elementSpanOk && textSpanOk;

  return {
    ok,
    details: {
      htmlLength: html.length,
      elementSpan: elementSpan || null,
      textSpan: textSpan || null,
      elementSpanOk,
      textSpanOk
    }
  };
}

function evaluatePatchFeature() {
  const source = "<div id=\"root\"><p class=\"x\">alpha</p><p>beta</p></div>";
  const sourceTree = parse(source, { captureSpans: true });
  const firstParagraph = findFirstNode(
    sourceTree.children,
    (node) => node.kind === "element" && node.tagName === "p"
  );
  if (!firstParagraph || firstParagraph.kind !== "element") {
    return {
      ok: false,
      details: {
        reason: "paragraph node not found in patch fixture"
      }
    };
  }

  const firstText = findFirstNode(firstParagraph.children, (node) => node.kind === "text");
  if (!firstText || firstText.kind !== "text") {
    return {
      ok: false,
      details: {
        reason: "text node not found in patch fixture"
      }
    };
  }

  const edits = [
    { kind: "replaceText", target: firstText.id, value: "omega" },
    { kind: "setAttr", target: firstParagraph.id, name: "class", value: "updated" },
    { kind: "insertHtmlAfter", target: firstParagraph.id, html: "<hr>" }
  ];

  const patchPlanA = computePatch(source, edits);
  const patchPlanB = computePatch(source, edits);
  const patchedHtml = applyPatchPlan(source, patchPlanA);
  const patchedTree = parse(patchedHtml);

  const patchedParagraph = findFirstNode(
    patchedTree.children,
    (node) => node.kind === "element" && node.tagName === "p"
  );
  const patchedText = findFirstNode(patchedTree.children, (node) => node.kind === "text" && node.value.includes("omega"));
  const hasInsertedHr = findFirstNode(
    patchedTree.children,
    (node) => node.kind === "element" && node.tagName === "hr"
  ) !== null;
  const classUpdated = Boolean(
    patchedParagraph &&
      patchedParagraph.kind === "element" &&
      patchedParagraph.attributes.some((entry) => entry.name === "class" && entry.value === "updated")
  );
  const textEditOk = patchedText !== null;
  const deterministicPlan = JSON.stringify(patchPlanA.steps) === JSON.stringify(patchPlanB.steps);

  let structuredErrorOk = false;
  const impliedNode = findFirstNode(
    sourceTree.children,
    (node) =>
      node.kind === "element" &&
      (node.tagName === "html" || node.tagName === "body") &&
      node.span === undefined
  );
  if (impliedNode) {
    try {
      computePatch(source, [{ kind: "removeNode", target: impliedNode.id }]);
    } catch (error) {
      if (error instanceof PatchPlanningError) {
        structuredErrorOk = error.payload.code === "MISSING_NODE_SPAN";
      }
    }
  }

  const ok = textEditOk && classUpdated && hasInsertedHr && deterministicPlan && structuredErrorOk;

  return {
    ok,
    details: {
      textEditOk,
      classUpdated,
      hasInsertedHr,
      deterministicPlan,
      structuredErrorOk,
      patchedHtml,
      steps: patchPlanA.steps.length
    }
  };
}

function evaluateOutlineFeature() {
  const html = "<article id=\"a\"><h1>Main</h1><h2>Sub</h2><p data-role=\"lead\">text</p></article>";
  const firstTree = parse(html);
  const secondTree = parse(html);
  const firstOutline = outline(firstTree);
  const secondOutline = outline(secondTree);

  const walkOrderA = [];
  walk(firstTree, (node, depth) => {
    walkOrderA.push(`${String(depth)}:${node.kind}:${node.kind === "element" ? node.tagName : ""}`);
  });
  const walkOrderB = [];
  walk(secondTree, (node, depth) => {
    walkOrderB.push(`${String(depth)}:${node.kind}:${node.kind === "element" ? node.tagName : ""}`);
  });

  const elementOrderA = [];
  walkElements(firstTree, (node, depth) => {
    elementOrderA.push(`${String(depth)}:${node.tagName}`);
  });
  const elementOrderB = [];
  walkElements(secondTree, (node, depth) => {
    elementOrderB.push(`${String(depth)}:${node.tagName}`);
  });

  const leadA = [...findAllByAttr(firstTree, "data-role", "lead")].map((node) => node.id);
  const leadB = [...findAllByAttr(secondTree, "data-role", "lead")].map((node) => node.id);
  const headingsA = [...findAllByTagName(firstTree, "h1")].map((node) => node.id);
  const headingsB = [...findAllByTagName(secondTree, "h1")].map((node) => node.id);
  const leadNode = leadA.length > 0 ? findById(firstTree, leadA[0]) : null;
  const leadText = leadNode ? textContent(leadNode) : "";

  const traversalDeterministic =
    JSON.stringify(walkOrderA) === JSON.stringify(walkOrderB) &&
    JSON.stringify(elementOrderA) === JSON.stringify(elementOrderB) &&
    JSON.stringify(leadA) === JSON.stringify(leadB) &&
    JSON.stringify(headingsA) === JSON.stringify(headingsB);

  const deterministic = JSON.stringify(firstOutline) === JSON.stringify(secondOutline);
  const hasEntries = firstOutline.entries.length > 0;
  const ok = deterministic && hasEntries && traversalDeterministic && leadText === "text";

  return {
    ok,
    details: {
      entryCount: firstOutline.entries.length,
      deterministic,
      traversalDeterministic,
      leadCount: leadA.length,
      leadText
    }
  };
}

function evaluateChunkFeature() {
  const html = "<p>alpha</p><p>beta</p><p>gamma</p><p>delta</p>";
  const firstTree = parseFragment(html, "section");
  const secondTree = parseFragment(html, "section");

  const chunkOptions = {
    maxChars: 4096,
    maxNodes: 64,
    maxBytes: 24
  };

  const firstChunkPlan = chunk(firstTree, chunkOptions);
  const secondChunkPlan = chunk(secondTree, chunkOptions);

  const deterministic = JSON.stringify(firstChunkPlan) === JSON.stringify(secondChunkPlan);
  const byteBounded = firstChunkPlan.every((chunkEntry) => textBytes(chunkEntry.content) <= chunkOptions.maxBytes);
  const hasMultipleChunks = firstChunkPlan.length >= 2;
  const ok = deterministic && byteBounded && hasMultipleChunks;

  return {
    ok,
    details: {
      chunkCount: firstChunkPlan.length,
      deterministic,
      byteBounded,
      hasMultipleChunks,
      maxBytes: chunkOptions.maxBytes
    }
  };
}

async function collectStreamTokens(chunks, options = {}) {
  const tokens = [];
  for await (const token of tokenizeStream(createByteStream(chunks), options)) {
    tokens.push(token);
  }
  return tokens;
}

async function captureTokenBudgetFailure(chunks, options) {
  try {
    await collectStreamTokens(chunks, options);
    return null;
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return {
        budget: error.payload.budget,
        limit: error.payload.limit,
        actual: error.payload.actual
      };
    }
    throw error;
  }
}

async function evaluateStreamTokenFeature() {
  const encoder = new TextEncoder();
  const chunks = [encoder.encode("<p>"), encoder.encode("alpha"), encoder.encode("</p>")];

  const firstRun = await collectStreamTokens(chunks, {
    budgets: { maxInputBytes: 1024, maxBufferedBytes: 256 }
  });
  const secondRun = await collectStreamTokens(chunks, {
    budgets: { maxInputBytes: 1024, maxBufferedBytes: 256 }
  });

  const deterministic = JSON.stringify(firstRun) === JSON.stringify(secondRun);
  const kinds = firstRun.map((token) => token.kind);
  const hasRequiredKinds = ["startTag", "chars", "endTag", "eof"].every((kind) => kinds.includes(kind));

  const tightChunks = [new Uint8Array(32).fill(0x61)];
  const firstBudgetFailure = await captureTokenBudgetFailure(tightChunks, {
    budgets: { maxInputBytes: 1024, maxBufferedBytes: 16 }
  });
  const secondBudgetFailure = await captureTokenBudgetFailure(tightChunks, {
    budgets: { maxInputBytes: 1024, maxBufferedBytes: 16 }
  });

  const budgetFailureOk = firstBudgetFailure?.budget === "maxBufferedBytes";
  const deterministicBudgetFailure =
    JSON.stringify(firstBudgetFailure) === JSON.stringify(secondBudgetFailure);

  const ok = deterministic && hasRequiredKinds && budgetFailureOk && deterministicBudgetFailure;
  return {
    ok,
    details: {
      tokenCount: firstRun.length,
      kinds,
      hasRequiredKinds,
      deterministic,
      budgetFailureOk,
      deterministicBudgetFailure,
      firstBudgetFailure
    }
  };
}

function evaluateVisibleTextFeature() {
  const html = "<article><p>A <img alt=\"B\"></p><table><tr><td>x</td><td>y</td></tr></table></article>";
  const treeA = parse(html);
  const treeB = parse(html);

  const textA = visibleText(treeA);
  const textB = visibleText(treeB);
  const tokensA = visibleTextTokens(treeA);
  const tokensB = visibleTextTokens(treeB);

  const deterministicText = textA === textB;
  const deterministicTokens = JSON.stringify(tokensA) === JSON.stringify(tokensB);
  const tokenJoinStable = tokensA.map((entry) => entry.value).join("") === textA;
  const hasStructureTokens = tokensA.some((entry) => entry.kind === "paragraphBreak")
    && tokensA.some((entry) => entry.kind === "tab");
  const hasTextToken = tokensA.some((entry) => entry.kind === "text");
  const expectedTermsPresent = textA.includes("A") && textA.includes("B") && textA.includes("x") && textA.includes("y");

  return {
    ok:
      deterministicText &&
      deterministicTokens &&
      tokenJoinStable &&
      hasStructureTokens &&
      hasTextToken &&
      expectedTermsPresent,
    details: {
      text: textA,
      tokenCount: tokensA.length,
      deterministicText,
      deterministicTokens,
      tokenJoinStable,
      hasStructureTokens,
      hasTextToken,
      expectedTermsPresent
    }
  };
}

function evaluateParseErrorIdFeature() {
  const malformedHtml = "<div><span></div><p></span>";
  const firstRun = parse(malformedHtml, { trace: true });
  const secondRun = parse(malformedHtml, { trace: true });

  const firstIds = firstRun.errors.map((entry) => entry.parseErrorId);
  const secondIds = secondRun.errors.map((entry) => entry.parseErrorId);
  const idsPresent = firstIds.length > 0 && firstIds.every((id) => typeof id === "string" && id.length > 0);
  const deterministic = JSON.stringify(firstIds) === JSON.stringify(secondIds);
  const traceIds = (firstRun.trace ?? [])
    .filter((event) => event.kind === "parseError")
    .map((event) => event.parseErrorId);
  const traceAligned = traceIds.every((id) => typeof id === "string" && id.length > 0);
  const specRefs = firstIds.map((id) => getParseErrorSpecRef(id));
  const specRefStable = specRefs.every((url) => url === "https://html.spec.whatwg.org/multipage/parsing.html#parse-errors");

  return {
    ok: idsPresent && deterministic && traceAligned && specRefStable,
    details: {
      count: firstIds.length,
      firstIds,
      deterministic,
      traceAligned,
      specRefStable
    }
  };
}

async function main() {
  const features = {
    trace: { ok: false, details: {} },
    spans: { ok: false, details: {} },
    patch: { ok: false, details: {} },
    outline: { ok: false, details: {} },
    chunk: { ok: false, details: {} },
    streamToken: { ok: false, details: {} },
    visibleText: { ok: false, details: {} },
    parseErrorId: { ok: false, details: {} }
  };

  try {
    features.trace = evaluateTraceFeature();
  } catch (error) {
    features.trace = { ok: false, details: { error: makeReportFailure(error) } };
  }

  try {
    features.spans = evaluateSpansFeature();
  } catch (error) {
    features.spans = { ok: false, details: { error: makeReportFailure(error) } };
  }

  try {
    features.patch = evaluatePatchFeature();
  } catch (error) {
    features.patch = { ok: false, details: { error: makeReportFailure(error) } };
  }

  try {
    features.outline = evaluateOutlineFeature();
  } catch (error) {
    features.outline = { ok: false, details: { error: makeReportFailure(error) } };
  }

  try {
    features.chunk = evaluateChunkFeature();
  } catch (error) {
    features.chunk = { ok: false, details: { error: makeReportFailure(error) } };
  }

  try {
    features.streamToken = await evaluateStreamTokenFeature();
  } catch (error) {
    features.streamToken = { ok: false, details: { error: makeReportFailure(error) } };
  }

  try {
    features.visibleText = evaluateVisibleTextFeature();
  } catch (error) {
    features.visibleText = { ok: false, details: { error: makeReportFailure(error) } };
  }

  try {
    features.parseErrorId = evaluateParseErrorIdFeature();
  } catch (error) {
    features.parseErrorId = { ok: false, details: { error: makeReportFailure(error) } };
  }

  const overall = {
    ok: Object.values(features).every((featureResult) => featureResult.ok)
  };

  await writeJson("reports/agent.json", {
    suite: "agent",
    timestamp: new Date().toISOString(),
    features,
    overall
  });

  if (!overall.ok) {
    console.error("Agent report checks failed. See reports/agent.json");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
