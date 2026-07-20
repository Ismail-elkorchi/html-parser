import { parse, parseFragment, serialize } from "../../dist/mod.js";

const input = "<!doctype html><main><p>a&amp;b</p><template><svg><title>x</title></svg></template></main>";
const document = parse(input, { captureSpans: true });
const fragment = parseFragment(
  "<b>x<i>y</b>z</i><table>t<tr><td>c",
  "section",
  { captureSpans: true }
);

const evidence = {
  document: document.tree,
  documentSerialization: serialize(document.tree),
  fragment,
  fragmentSerialization: serialize(fragment),
  resources: document.metadata.resourceUsage
};
process.stdout.write(`${JSON.stringify(evidence)}\n`);
