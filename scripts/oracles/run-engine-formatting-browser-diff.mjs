import { runBrowserTreeDifferential } from "./browser-tree-diff.mjs";

const CASES = Object.freeze([
  { id: "reconstruction-after-block", html: "<p><b>one<div>two</b>three" },
  { id: "misnested-link", html: "<a><p></a></p>" },
  { id: "nested-formatting-adoption", html: "<b>1<i>2<p>3</b>4" },
  { id: "noah-family-cap", html: "<p><b><b><b><b><p>x" },
  { id: "nobr-recovery", html: "<!doctype html><nobr><nobr></nobr><nobr>" },
  { id: "ruby-implied-ends", html: "<html><ruby>a<rtc>b<rt>c<rb>d</ruby></html>" },
  { id: "form-pointer-removal", html: "<!doctype html><form><div></form><div>" },
  { id: "formatting-across-plaintext", html: "<!doctype html><p><a><plaintext>b" }
]);

await runBrowserTreeDifferential({
  schema: "engine-formatting-browser-diff/v1",
  cases: CASES
});
