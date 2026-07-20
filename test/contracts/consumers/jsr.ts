import {
  type HtmlNode,
  type ProcessingInstructionToken,
  type TemplateContentNode,
  type Token,
  extractText,
  parse,
  serialize
} from "../../../jsr/mod.ts";

const parsed = parse("<?build release?><template><p>x</p></template>");
const nodes: readonly HtmlNode[] = parsed.tree.children;
const templateContent: TemplateContentNode | undefined = nodes
  .filter((node) => node.kind === "element")
  .flatMap((node) => node.templateContent === undefined ? [] : [node.templateContent])[0];
const instruction: ProcessingInstructionToken = {
  kind: "processingInstruction",
  target: "build",
  data: "release"
};
const tokens: readonly Token[] = [instruction];

void templateContent;
void tokens;
void serialize(parsed.tree);
void extractText(parsed.tree, {
  policy: "text-content-v1",
  maxOutputBytes: 128,
  maxTokens: 16
});
