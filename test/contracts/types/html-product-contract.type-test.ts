import {
  extractText,
  iterateText,
  parse,
  parseFragment,
  tokenizeByteStreamEager
} from "../../../src/mod.js";

import type {
  HtmlScriptingMode,
  ProcessingInstructionNode,
  ProcessingInstructionToken,
  SerializeOptions,
  TemplateContentNode
} from "../../../src/public/types.js";

const parsed = parse("<?build release?><template>x</template>");
const fragment = parseFragment("x", "template");
const templateContent: TemplateContentNode | undefined = parsed.tree.children
  .filter((node) => node.kind === "element")
  .flatMap((node) => node.templateContent ? [node.templateContent] : [])[0];
const instruction: ProcessingInstructionNode | undefined = parsed.tree.children.find(
  (node): node is ProcessingInstructionNode => node.kind === "processingInstruction"
);
const tokenPromise: Promise<readonly (
  ProcessingInstructionToken | Exclude<Awaited<ReturnType<typeof tokenizeByteStreamEager>>[number], ProcessingInstructionToken>
)[]> = tokenizeByteStreamEager(new ReadableStream());
void fragment;
void templateContent;
void instruction;
void tokenPromise;
const scriptingMode: HtmlScriptingMode = "inert";
const serializeOptions: SerializeOptions = { scriptingMode, maxTimeMs: 10 };
void serializeOptions;
const visibleOptions = {
  policy: "visible-text-html-v1",
  maxOutputBytes: 128,
  maxTokens: 16,
  maxFallbackInputBytes: 256,
  maxFallbackNodes: 32
} as const;
const extraction = extractText(parsed.tree, visibleOptions);
const extractionIterator = iterateText(parsed.tree, visibleOptions);
void extraction;
void extractionIterator;
