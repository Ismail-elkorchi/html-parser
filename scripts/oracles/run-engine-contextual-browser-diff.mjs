import { runBrowserTreeDifferential } from "./browser-tree-diff.mjs";

const CASES = Object.freeze([
  { id: "foster-parented-text", html: "<!doctype html><p>lead<table>x<tr><td>cell</table>tail" },
  { id: "quirks-table-paragraph", html: "<p><table></p>" },
  { id: "synthesized-table-containers", html: "<!doctype html><table><td>a<td>b" },
  { id: "cell-end-tag-recovery", html: "<!doctype html><table><template><td></tr><div></template></table>" },
  { id: "template-table", html: "<!doctype html><template><table><tr><td>x</template><p>y" },
  { id: "template-column-group", html: "<!doctype html><template><col>Hello</template>" },
  { id: "template-body-attributes", html: "<!doctype html><body data=kept><template><body data=ignored></template>" },
  {
    id: "relaxed-select",
    html: "<!doctype html><select><div>x<option>a<select><option>b",
    acceptedBrowserTrees: {
      firefox: {
        engineSha256: "e950f95225e1683318230ae941f94b4d2052282b4b8bed4cf4542ba4abfc88c3",
        browserSha256: "dc41b5a343e78d2bcb7644bcd63cf137b0b69500a9580e759c34383acfc78e6e",
        reason: "Playwright Firefox 151 predates the fix tracked by Mozilla bug 1933591"
      }
    }
  },
  { id: "table-select", html: "<!doctype html><table><select><option>a</select></table>" },
  { id: "frameset", html: "<!doctype html><frameset cols=*><frame src=x></frameset></html>" }
]);

await runBrowserTreeDifferential({
  schema: "engine-contextual-browser-diff/v1",
  cases: CASES
});
