import { HtmlPatchPlanningError } from "./errors.js";
import { ownedChildNodes } from "./model.js";
import {
  parsedDocumentRegistration,
  patchPlanBelongsTo,
  registerPatchPlan
} from "./parsed-document-registry.js";
import { escapeAttribute, escapeText } from "./serialization.js";

import type {
  Edit,
  HtmlNode,
  HtmlPatchPlanningReason,
  NodeId,
  ParsedDocument,
  PatchPlan,
  PatchStep,
  Span,
  SpanProvenance
} from "./types.js";

interface IndexedNodeSpan {
  readonly span?: Span;
  readonly provenance: SpanProvenance;
}

function indexNodeSpans(nodes: readonly HtmlNode[], into: Map<NodeId, IndexedNodeSpan>): void {
  const stack = [...nodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    into.set(node.id, {
      provenance: node.spanProvenance,
      ...(node.kind !== "templateContent" && node.span ? { span: node.span } : {})
    });

    const descendants = ownedChildNodes(node);
    if (descendants.length > 0) {
      for (let index = descendants.length - 1; index >= 0; index -= 1) {
        const child = descendants[index];
        if (child !== undefined) {
          stack.push(child);
        }
      }
    }
  }
}

function indexNodes(nodes: readonly HtmlNode[], into: Map<NodeId, HtmlNode>): void {
  const stack = [...nodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    into.set(node.id, node);
    const descendants = ownedChildNodes(node);
    if (descendants.length > 0) {
      for (let index = descendants.length - 1; index >= 0; index -= 1) {
        const child = descendants[index];
        if (child !== undefined) {
          stack.push(child);
        }
      }
    }
  }
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\t" || char === "\r" || char === "\f";
}

function findElementStartTagClose(originalHtml: string, span: Span): number {
  let quote: "\"" | "'" | null = null;

  for (let index = span.start; index < originalHtml.length; index += 1) {
    const current = originalHtml[index];
    if (current === undefined) {
      break;
    }

    if (quote === null && (current === "\"" || current === "'")) {
      quote = current;
      continue;
    }

    if (quote !== null && current === quote) {
      quote = null;
      continue;
    }

    if (quote === null && current === ">") {
      return index;
    }
  }

  return -1;
}

function findAttributeInsertOffset(originalHtml: string, closeIndex: number, tagStart: number): number {
  let cursor = closeIndex - 1;
  while (cursor > tagStart && isWhitespace(originalHtml[cursor] ?? "")) {
    cursor -= 1;
  }

  if (originalHtml[cursor] === "/") {
    return cursor;
  }

  return closeIndex;
}

function applyPatchSteps(originalHtml: string, plan: PatchPlan): string {
  let cursor = 0;
  let output = "";

  for (const step of plan.steps) {
    if (step.kind === "slice") {
      if (step.start < cursor || step.end < step.start || step.end > originalHtml.length) {
        throw new HtmlPatchPlanningError("INVALID_PLAN_SLICE", {
          detail: "slice bounds must be ordered, non-overlapping, and within the source"
        });
      }

      output += originalHtml.slice(step.start, step.end);
      cursor = step.end;
      continue;
    }

    if (step.at !== cursor || step.at > originalHtml.length) {
      throw new HtmlPatchPlanningError("INVALID_PLAN_INSERTION", {
        detail: "insertion offset must equal the current source cursor"
      });
    }

    output += step.text;
  }

  return output;
}

function requireParsedDocumentSource(document: ParsedDocument): string {
  const registration = parsedDocumentRegistration(document);
  if (registration === undefined) {
    failPatchPlanning("UNRECOGNIZED_PARSED_DOCUMENT", {
      detail: "document must be the exact object returned by a full-document parse"
    });
  }
  const source = registration.sourceText;
  if (source === null) {
    failPatchPlanning("SOURCE_NOT_RETAINED", {
      detail: 'parse with sourceRetention: "text" before planning or applying patches'
    });
  }
  return source;
}

/** Applies a registered patch plan to the exact parsed document that produced it. */
export function applyPatchPlan(document: ParsedDocument, plan: PatchPlan): string {
  const originalHtml = requireParsedDocumentSource(document);
  if (!patchPlanBelongsTo(plan, document)) {
    failPatchPlanning("PLAN_SOURCE_MISMATCH", {
      detail: "plan must be applied to the exact parsed document used to create it"
    });
  }
  return applyPatchSteps(originalHtml, plan);
}

interface PlannedReplacement {
  readonly sourceIndex: number;
  readonly target: NodeId;
  readonly start: number;
  readonly end: number;
  readonly replacementHtml: string;
}

function failPatchPlanning(
  reason: HtmlPatchPlanningReason,
  options: { readonly target?: NodeId; readonly detail?: string } = {}
): never {
  throw new HtmlPatchPlanningError(reason, options);
}

function requireNode(nodeById: Map<NodeId, HtmlNode>, target: NodeId): HtmlNode {
  const node = nodeById.get(target);
  if (!node) {
    failPatchPlanning("NODE_NOT_FOUND", { target });
  }
  return node;
}

function requireNodeSpan(spanByNode: Map<NodeId, IndexedNodeSpan>, target: NodeId): Span {
  const indexedSpan = spanByNode.get(target);
  if (!indexedSpan) {
    failPatchPlanning("MISSING_NODE_SPAN", { target });
  }
  if (indexedSpan.provenance !== "input") {
    failPatchPlanning("NON_INPUT_SPAN_PROVENANCE", {
      target,
      detail: indexedSpan.provenance
    });
  }
  if (!indexedSpan.span) {
    failPatchPlanning("MISSING_NODE_SPAN", { target });
  }
  return indexedSpan.span;
}

function requireElementNode(nodeById: Map<NodeId, HtmlNode>, target: NodeId): Extract<HtmlNode, { kind: "element" }> {
  const node = requireNode(nodeById, target);
  if (node.kind !== "element") {
    failPatchPlanning("INVALID_EDIT_TARGET", { target, detail: "expected element node target" });
  }
  return node;
}

function buildSetAttrReplacement(
  originalHtml: string,
  nodeById: Map<NodeId, HtmlNode>,
  spanByNode: Map<NodeId, IndexedNodeSpan>,
  edit: Extract<Edit, { readonly kind: "setAttr" }>,
  sourceIndex: number
): PlannedReplacement {
  const element = requireElementNode(nodeById, edit.target);
  const existing = element.attributes.find((entry) => entry.name === edit.name);
  const rendered = `${edit.name}="${escapeAttribute(edit.value)}"`;

  if (existing) {
    if (!existing.span) {
      failPatchPlanning("ATTRIBUTE_SPAN_MISSING", { target: edit.target, detail: edit.name });
    }
    return {
      sourceIndex,
      target: edit.target,
      start: existing.span.start,
      end: existing.span.end,
      replacementHtml: rendered
    };
  }

  const elementSpan = requireNodeSpan(spanByNode, edit.target);
  const closeIndex = findElementStartTagClose(originalHtml, elementSpan);
  if (closeIndex === -1) {
    failPatchPlanning("ELEMENT_START_TAG_NOT_FOUND", { target: edit.target });
  }
  const insertAt = findAttributeInsertOffset(originalHtml, closeIndex, elementSpan.start);
  return {
    sourceIndex,
    target: edit.target,
    start: insertAt,
    end: insertAt,
    replacementHtml: ` ${rendered}`
  };
}

function buildRemoveAttrReplacement(
  originalHtml: string,
  nodeById: Map<NodeId, HtmlNode>,
  spanByNode: Map<NodeId, IndexedNodeSpan>,
  edit: Extract<Edit, { readonly kind: "removeAttr" }>,
  sourceIndex: number
): PlannedReplacement {
  const element = requireElementNode(nodeById, edit.target);
  const existing = element.attributes.find((entry) => entry.name === edit.name);
  if (!existing) {
    failPatchPlanning("ATTRIBUTE_NOT_FOUND", { target: edit.target, detail: edit.name });
  }
  if (!existing.span) {
    failPatchPlanning("ATTRIBUTE_SPAN_MISSING", { target: edit.target, detail: edit.name });
  }

  const elementSpan = requireNodeSpan(spanByNode, edit.target);
  const closeIndex = findElementStartTagClose(originalHtml, elementSpan);
  if (closeIndex === -1) {
    failPatchPlanning("ELEMENT_START_TAG_NOT_FOUND", { target: edit.target });
  }

  let start = existing.span.start;
  let end = existing.span.end;
  while (start > elementSpan.start + 1 && isWhitespace(originalHtml[start - 1] ?? "")) {
    start -= 1;
  }
  if (start === existing.span.start) {
    while (end < closeIndex && isWhitespace(originalHtml[end] ?? "")) {
      end += 1;
    }
  }

  return {
    sourceIndex,
    target: edit.target,
    start,
    end,
    replacementHtml: ""
  };
}

function buildReplacement(
  originalHtml: string,
  nodeById: Map<NodeId, HtmlNode>,
  spanByNode: Map<NodeId, IndexedNodeSpan>,
  edit: Edit,
  sourceIndex: number
): PlannedReplacement {
  if (edit.kind === "removeNode") {
    const span = requireNodeSpan(spanByNode, edit.target);
    return {
      sourceIndex,
      target: edit.target,
      start: span.start,
      end: span.end,
      replacementHtml: ""
    };
  }

  if (edit.kind === "replaceText") {
    const node = requireNode(nodeById, edit.target);
    if (node.kind !== "text") {
      failPatchPlanning("INVALID_EDIT_TARGET", { target: edit.target, detail: "expected text node target" });
    }
    const span = requireNodeSpan(spanByNode, edit.target);
    return {
      sourceIndex,
      target: edit.target,
      start: span.start,
      end: span.end,
      replacementHtml: escapeText(edit.value)
    };
  }

  if (edit.kind === "setAttr") {
    return buildSetAttrReplacement(originalHtml, nodeById, spanByNode, edit, sourceIndex);
  }

  if (edit.kind === "removeAttr") {
    return buildRemoveAttrReplacement(originalHtml, nodeById, spanByNode, edit, sourceIndex);
  }

  if (edit.kind === "insertHtmlBefore") {
    const span = requireNodeSpan(spanByNode, edit.target);
    return {
      sourceIndex,
      target: edit.target,
      start: span.start,
      end: span.start,
      replacementHtml: edit.html
    };
  }

  const span = requireNodeSpan(spanByNode, edit.target);
  return {
    sourceIndex,
    target: edit.target,
    start: span.end,
    end: span.end,
    replacementHtml: edit.html
  };
}

/** Plans non-overlapping source edits against a span-capturing parsed document. */
export function computePatch(document: ParsedDocument, edits: readonly Edit[]): PatchPlan {
  const originalHtml = requireParsedDocumentSource(document);
  if (parsedDocumentRegistration(document)?.spansCaptured !== true) {
    failPatchPlanning("SPANS_NOT_CAPTURED", {
      detail: "parse with captureSpans: true before planning patches"
    });
  }

  if (edits.length === 0) {
    const steps: readonly PatchStep[] = Object.freeze([
      Object.freeze({ kind: "slice", start: 0, end: originalHtml.length })
    ]);

    const plan = Object.freeze({
      steps,
      result: originalHtml
    });
    registerPatchPlan(plan, document);
    return plan;
  }

  const spanByNode = new Map<NodeId, IndexedNodeSpan>();
  const nodeById = new Map<NodeId, HtmlNode>();
  indexNodeSpans(document.tree.children, spanByNode);
  indexNodes(document.tree.children, nodeById);

  const replacements = edits.map((edit, sourceIndex) =>
    buildReplacement(originalHtml, nodeById, spanByNode, edit, sourceIndex)
  );

  replacements.sort((left, right) => {
    if (left.start !== right.start) {
      return left.start - right.start;
    }

    if (left.end !== right.end) {
      return left.end - right.end;
    }

    return left.sourceIndex - right.sourceIndex;
  });

  let previousEnd = 0;
  for (const replacement of replacements) {
    if (replacement.start < 0 || replacement.end < replacement.start || replacement.end > originalHtml.length) {
      failPatchPlanning("OVERLAPPING_EDITS", {
        target: replacement.target,
        detail: "invalid replacement bounds"
      });
    }
    if (replacement.start < previousEnd) {
      failPatchPlanning("OVERLAPPING_EDITS", { target: replacement.target });
    }
    previousEnd = Math.max(previousEnd, replacement.end);
  }

  const steps: PatchStep[] = [];
  let cursor = 0;
  for (const replacement of replacements) {
    if (cursor < replacement.start) {
      steps.push(
        Object.freeze({
          kind: "slice",
          start: cursor,
          end: replacement.start
        })
      );
    }

    steps.push(
      Object.freeze({
        kind: "insert",
        at: replacement.start,
        text: replacement.replacementHtml
      })
    );
    cursor = replacement.end;
  }

  if (cursor < originalHtml.length) {
    steps.push(
      Object.freeze({
        kind: "slice",
        start: cursor,
        end: originalHtml.length
      })
    );
  }

  const frozenSteps = Object.freeze(steps.map((step) => Object.freeze(step)));
  const result = applyPatchSteps(originalHtml, { steps: frozenSteps, result: "" });

  const plan = Object.freeze({
    steps: frozenSteps,
    result
  });
  registerPatchPlan(plan, document);
  return plan;
}
