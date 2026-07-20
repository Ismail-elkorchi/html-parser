import {
  HTML_NAMESPACE_URI,
  type HtmlNode,
  type ProcessingInstructionToken,
  type TemplateContentNode,
  type Token,
  extractText,
  isHtmlOperationalError,
  parse,
  serialize
} from "@ismail-elkorchi/html-parser";

const parsed = parse("<?build release?><template><p>x</p></template>", {
  captureSpans: true,
  sourceRetention: "text"
});
const nodes: readonly HtmlNode[] = parsed.tree.children;
const templateContent: TemplateContentNode | undefined = nodes
  .filter((node) => node.kind === "element")
  .flatMap((node) => node.templateContent === undefined ? [] : [node.templateContent])[0];
const token: ProcessingInstructionToken = {
  kind: "processingInstruction",
  target: "build",
  data: "release"
};
const tokens: readonly Token[] = [token];
const text = extractText(parsed.tree, {
  policy: "text-content-v1",
  maxOutputBytes: 128,
  maxTokens: 16
});

void HTML_NAMESPACE_URI;
void templateContent;
void tokens;
void text;
void serialize(parsed.tree);
void isHtmlOperationalError(new Error("consumer probe"));
