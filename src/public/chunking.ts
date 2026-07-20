import { countNodes } from "./model.ts";
import {
  createOperationContext,
  normalizeChunkOptions
} from "./operation.ts";
import { serializeNodes } from "./serialization.ts";

import type {
  Chunk,
  ChunkOptions,
  DocumentTree,
  FragmentTree,
  NodeId
} from "./types.ts";

/** Groups serialized top-level nodes without splitting a node across chunks. */
export function chunk(tree: DocumentTree | FragmentTree, options: ChunkOptions = {}): Chunk[] {
  const startedAt = performance.now();
  const normalizedOptions = normalizeChunkOptions(options);
  const operation = createOperationContext(
    normalizedOptions.maxTimeMs,
    normalizedOptions.signal,
    startedAt
  );
  operation.checkpoint();
  const maxChars = normalizedOptions.maxChars ?? 8192;
  const maxNodes = normalizedOptions.maxNodes ?? 256;
  const maxBytes = normalizedOptions.maxBytes ?? Number.POSITIVE_INFINITY;
  const textEncoder = new TextEncoder();
  const chunks: Chunk[] = [];
  let activeContent = "";
  let activeNodes = 0;
  let activeBytes = 0;
  let activeNodeId: NodeId | null = null;
  let index = 0;

  const flush = () => {
    if (activeNodeId === null) {
      return;
    }

    chunks.push({
      index,
      nodeId: activeNodeId,
      content: activeContent,
      nodes: activeNodes
    });

    index += 1;
    activeContent = "";
    activeNodes = 0;
    activeBytes = 0;
    activeNodeId = null;
  };

  for (const node of tree.children) {
    operation.checkpoint();
    const content = serializeNodes(
      [node],
      operation,
      null,
      tree.kind === "fragment" ? tree.scriptingMode : "inert"
    );
    const nodes = countNodes(node, operation);
    const bytes = textEncoder.encode(content).length;
    const nextChars = activeContent.length + content.length;
    const nextNodes = activeNodes + nodes;
    const nextBytes = activeBytes + bytes;

    if (activeNodeId !== null && (nextChars > maxChars || nextNodes > maxNodes || nextBytes > maxBytes)) {
      flush();
    }

    if (activeNodeId === null) {
      activeNodeId = node.id;
    }

    activeContent += content;
    activeNodes += nodes;
    activeBytes += bytes;
  }

  flush();
  return chunks;
}
