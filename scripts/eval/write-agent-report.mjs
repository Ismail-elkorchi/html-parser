import {
  BudgetExceededError,
  applyPatchPlan,
  chunk,
  computePatch,
  outline,
  parse,
  parseFragment
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
  const deterministic = JSON.stringify(firstTrace) === JSON.stringify(secondTrace);

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
  const ok = hasAtLeastThreeKinds && hasBudgetEvent && deterministic && tightBudgetPass;

  return {
    ok,
    details: {
      traceLength: firstTrace.length,
      distinctKinds,
      hasAtLeastThreeKinds,
      hasBudgetEvent,
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
  const textSource = "<p>alpha</p>";
  const textTree = parse(textSource, { captureSpans: true });
  const textNode = findFirstNode(textTree.children, (node) => node.kind === "text");
  if (!textNode) {
    return {
      ok: false,
      details: {
        reason: "text node not found in text patch fixture"
      }
    };
  }

  const textPatchPlanA = computePatch(textSource, [{ nodeId: textNode.id, replacementHtml: "beta" }]);
  const textPatchPlanB = computePatch(textSource, [{ nodeId: textNode.id, replacementHtml: "beta" }]);
  const textPatchedHtml = applyPatchPlan(textSource, textPatchPlanA);
  const textPatchedTree = parse(textPatchedHtml);
  const textPatchedValue = findFirstNode(textPatchedTree.children, (node) => node.kind === "text")?.value ?? "";
  const textEditOk = textPatchedValue.includes("beta") && !textPatchedValue.includes("alpha");

  const elementSource = "<div><span>a</span></div>";
  const elementTree = parse(elementSource, { captureSpans: true });
  const spanNode = findFirstNode(
    elementTree.children,
    (node) => node.kind === "element" && node.tagName === "span"
  );
  if (!spanNode) {
    return {
      ok: false,
      details: {
        reason: "span element not found in element patch fixture"
      }
    };
  }

  const elementPatchPlan = computePatch(elementSource, [{ nodeId: spanNode.id, replacementHtml: "<strong>b</strong>" }]);
  const elementPatchedHtml = applyPatchPlan(elementSource, elementPatchPlan);
  const elementPatchedTree = parse(elementPatchedHtml);
  const hasStrongNode = findFirstNode(
    elementPatchedTree.children,
    (node) => node.kind === "element" && node.tagName === "strong"
  ) !== null;

  const deterministicPlan = JSON.stringify(textPatchPlanA.steps) === JSON.stringify(textPatchPlanB.steps);
  const ok = textEditOk && hasStrongNode && deterministicPlan;

  return {
    ok,
    details: {
      textEditOk,
      elementEditOk: hasStrongNode,
      deterministicPlan,
      textPatchedHtml,
      elementPatchedHtml,
      textSteps: textPatchPlanA.steps.length,
      elementSteps: elementPatchPlan.steps.length
    }
  };
}

function evaluateOutlineFeature() {
  const html = "<h1>Main</h1><h2>Sub</h2><p>text</p>";
  const firstTree = parse(html);
  const secondTree = parse(html);
  const firstOutline = outline(firstTree);
  const secondOutline = outline(secondTree);

  const deterministic = JSON.stringify(firstOutline) === JSON.stringify(secondOutline);
  const hasEntries = firstOutline.entries.length > 0;
  const ok = deterministic && hasEntries;

  return {
    ok,
    details: {
      entryCount: firstOutline.entries.length,
      deterministic
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

async function main() {
  const features = {
    trace: { ok: false, details: {} },
    spans: { ok: false, details: {} },
    patch: { ok: false, details: {} },
    outline: { ok: false, details: {} },
    chunk: { ok: false, details: {} }
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
