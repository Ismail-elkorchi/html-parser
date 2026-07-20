import {
  extractTextWithIndependentEngine,
  iterateTextWithIndependentEngine,
  parseFragmentWithIndependentEngine,
  parseWithIndependentEngine,
  tokenizeByteStreamEagerWithIndependentEngine
} from "../../../src/integration/html-product-adapter.js";

import type * as publicModule from "../../../src/mod.js";
import type {
  ProcessingInstructionNode,
  ProcessingInstructionToken,
  TemplateContentNode
} from "../../../src/public/types.js";

const parsed = parseWithIndependentEngine("<?build release?><template>x</template>");
const fragment = parseFragmentWithIndependentEngine("x", "template");
const templateContent: TemplateContentNode | undefined = parsed.tree.children
  .filter((node) => node.kind === "element")
  .flatMap((node) => node.templateContent ? [node.templateContent] : [])[0];
const instruction: ProcessingInstructionNode | undefined = parsed.tree.children.find(
  (node): node is ProcessingInstructionNode => node.kind === "processingInstruction"
);
const tokenPromise: Promise<readonly (
  ProcessingInstructionToken | Exclude<Awaited<ReturnType<typeof tokenizeByteStreamEagerWithIndependentEngine>>[number], ProcessingInstructionToken>
)[]> = tokenizeByteStreamEagerWithIndependentEngine(new ReadableStream());
void fragment;
void templateContent;
void instruction;
void tokenPromise;
const visibleOptions = {
  policy: "visible-text-html-v1",
  maxOutputBytes: 128,
  maxTokens: 16,
  maxFallbackInputBytes: 256,
  maxFallbackNodes: 32
} as const;
const extraction = extractTextWithIndependentEngine(parsed.tree, visibleOptions);
const extractionIterator = iterateTextWithIndependentEngine(parsed.tree, visibleOptions);
void extraction;
void extractionIterator;

type StagedAdapterName =
  | "parseWithIndependentEngine"
  | "parseBytesWithIndependentEngine"
  | "parseStreamWithIndependentEngine"
  | "parseFragmentWithIndependentEngine"
  | "tokenizeByteStreamEagerWithIndependentEngine"
  | "extractTextWithIndependentEngine"
  | "iterateTextWithIndependentEngine";
type PublicHasStagedAdapter = Extract<StagedAdapterName, keyof typeof publicModule> extends never
  ? false
  : true;
const publicHasStagedAdapter: PublicHasStagedAdapter = false;
void publicHasStagedAdapter;
