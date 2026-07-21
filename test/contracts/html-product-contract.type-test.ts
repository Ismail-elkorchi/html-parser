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
const disabledDocument = parse("<noscript>x</noscript>", {
  scriptingMode: "disabled",
  budgets: { maxSteps: 10_000 }
});
const documentScriptingMode: HtmlScriptingMode = disabledDocument.tree.scriptingMode;
const observedSteps: number | null = disabledDocument.metadata.resourceUsage.steps;
void documentScriptingMode;
void observedSteps;
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
const normalizedContext: HtmlFragmentContext = contextualFragment.tree.context;
const documentMode: HtmlDocumentMode = contextualFragment.tree.documentMode;
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
const parseError = parse("<p><div></p>").tree.errors[0];
if (parseError !== undefined) {
  // @ts-expect-error - diagnostics do not claim a node identity the parser cannot establish.
  void parseError.nodeId;
}
const element = parsed.tree.children.find((node) => node.kind === "element");
if (element?.kind === "element") {
  void element.localName;
  const elementPrefix: string | undefined = element.prefix;
  void elementPrefix;
  // @ts-expect-error - qualified names are derived during serialization.
  void element.tagName;
  const attribute = element.attributes[0];
  if (attribute !== undefined) {
    void attribute.localName;
    const attributePrefix: string | undefined = attribute.prefix;
    void attributePrefix;
    // @ts-expect-error - qualified attribute names are not retained.
    void attribute.name;
  }
}
const tokenPromise = tokenizeByteStreamEager(new ReadableStream());
const tokenKinds: readonly (
  ProcessingInstructionToken |
  Exclude<Awaited<typeof tokenPromise>["tokens"][number], ProcessingInstructionToken>
)[] = (await tokenPromise).tokens;
void fragment;
void templateContent;
void instruction;
void tokenPromise;
void tokenKinds;
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
