import {
  asciiLowercase,
  isHtmlElement,
  iterateNodes
} from "./model.js";
import {
  createOperationContext,
  normalizeOperationOptions
} from "./operation.js";
import {
  TEXT_CONTENT_POLICY,
  extractText
} from "./text-extraction.js";

import type {
  DocumentTree,
  FragmentTree,
  OperationOptions,
  Outline,
  OutlineEntry
} from "./types.js";

/** Builds a heading-and-section outline with bounded text for each entry. */
export function outline(
  tree: DocumentTree | FragmentTree,
  options: OperationOptions = {}
): Outline {
  const startedAt = performance.now();
  const normalizedOptions = normalizeOperationOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  const entries: OutlineEntry[] = [];
  for (const entry of iterateNodes(tree.children, 0, operation)) {
    if (!isHtmlElement(entry.node)) {
      continue;
    }
    const normalized = asciiLowercase(entry.node.localName);
    if (/^h[1-6]$/.test(normalized) || normalized === "section" || normalized === "article") {
      const remainingTimeMs = operation.remainingTimeMs();
      const text = extractText(entry.node, {
        policy: TEXT_CONTENT_POLICY,
        maxOutputBytes: 200,
        maxTokens: Number.MAX_SAFE_INTEGER,
        ...(operation.signal === undefined ? {} : { signal: operation.signal }),
        ...(remainingTimeMs === undefined ? {} : { maxTimeMs: Math.floor(remainingTimeMs) })
      }).text;
      entries.push({
        nodeId: entry.node.id,
        depth: entry.depth,
        tagName: entry.node.tagName,
        text
      });
    }
  }

  return { entries };
}
