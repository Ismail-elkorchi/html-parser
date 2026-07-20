import {
  HTML_NAMESPACE_URI,
  MATHML_NAMESPACE_URI,
  extractText,
  iterateText,
  parse,
  parseFragment,
  tokenizeByteStreamEager
} from "../../src/mod.js";

import type {
  HtmlAttributeNamespaceUri,
  HtmlDocumentMode,
  HtmlFragmentContext,
  HtmlFragmentContextInput,
  HtmlScriptingMode,
  ProcessingInstructionNode,
  ProcessingInstructionToken,
  SerializeOptions,
  TemplateContentNode
} from "../../src/public/types.js";

const parsed = parse("<?build release?><template>x</template>");
const fragment = parseFragment("x", {
  namespaceUri: HTML_NAMESPACE_URI,
  localName: "template"
});
const mathContext: HtmlFragmentContextInput = {
  namespaceUri: MATHML_NAMESPACE_URI,
  localName: "annotation-xml",
  attributes: [{ namespaceUri: null, localName: "encoding", value: "text/html" }]
};
const contextualFragment = parseFragment("<p>x", mathContext, {
  scriptingMode: "disabled",
  documentMode: "limited-quirks",
  hasFormAncestor: true
});
const normalizedContext: HtmlFragmentContext = contextualFragment.context;
const documentMode: HtmlDocumentMode = contextualFragment.documentMode;
const attributeNamespace: HtmlAttributeNamespaceUri = normalizedContext.attributes[0]?.namespaceUri ?? null;
void documentMode;
void attributeNamespace;

// @ts-expect-error - callers describe only an external form ancestor; the effective chain is derived.
parseFragment("x", mathContext, { hasFormInContextChain: true });

// @ts-expect-error - a tag-name string omits required namespace identity.
parseFragment("x", "div");
parseFragment("x", {
  namespaceUri: HTML_NAMESPACE_URI,
  localName: "div",
  attributes: [{
    namespaceUri: null,
    localName: "id",
    value: "x",
    // @ts-expect-error - prefixes are derived rather than configurable.
    prefix: null
  }]
});
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
