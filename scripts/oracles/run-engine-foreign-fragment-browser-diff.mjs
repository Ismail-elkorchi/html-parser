import {
  HTML_NAMESPACE,
  MATHML_NAMESPACE,
  SVG_NAMESPACE
} from "../../dist/internal/html-engine/namespaces.js";
import { runBrowserTreeDifferential } from "./browser-tree-diff.mjs";

const fragment = (namespaceUri, localName, attributes = []) => Object.freeze({
  namespaceUri,
  localName,
  attributes: Object.freeze(attributes)
});

const CASES = Object.freeze([
  {
    id: "svg-adjustments",
    html: "<!doctype html><svg viewbox='0 0 1 1'><lineargradient xlink:href='#x'/></svg>"
  },
  {
    id: "foreign-integration-points",
    html: "<!doctype html><svg><foreignObject><p>x</p></foreignObject></svg><math><mi><b>y</b></mi></math>"
  },
  {
    id: "foreign-breakout",
    html: "<!doctype html><svg><g><table><tr><td>x</table>"
  },
  {
    id: "foreign-cdata",
    html: "<!doctype html><svg><g><![CDATA[x<y]]></g></svg>"
  },
  {
    id: "html-fragment",
    html: "<b>x</b><table><td>y",
    fragmentContext: fragment(HTML_NAMESPACE, "div")
  },
  {
    id: "rcdata-fragment",
    html: "a<b>&amp;</textarea>c",
    fragmentContext: fragment(HTML_NAMESPACE, "textarea")
  },
  {
    id: "template-fragment",
    html: "<table><td>x</table><p>y",
    fragmentContext: fragment(HTML_NAMESPACE, "template")
  },
  {
    id: "svg-fragment",
    html: "<![CDATA[x]]><lineargradient/><foreignObject><p>y</p></foreignObject>",
    fragmentContext: fragment(SVG_NAMESPACE, "svg"),
    acceptedBrowserTrees: {
      chromium: {
        engineSha256: "42278369a614073b4364f5d1192665416147edcd73009ac0f7b61d7ae511804d",
        browserSha256: "a272d20371abcdf6af1ecc030cd51e3b2cb3835d57414bd3279c06ccf50035e3",
        reason: "Chromium 149 treats CDATA as a comment for innerHTML on an external SVG context; the pinned WPT fragment result is text"
      }
    }
  },
  {
    id: "svg-integration-fragment",
    html: "<![CDATA[x]]><b>y</b>",
    fragmentContext: fragment(SVG_NAMESPACE, "title"),
    acceptedBrowserTrees: {
      chromium: {
        engineSha256: "eaad90b4bdf3c88d2d748c93e97d78216582fecb93802dcd3383251a4b81829f",
        browserSha256: "0a0d0255f522b197518ecd2bfda73dcfa7a8f185e402a61c917d35379ad8193a",
        reason: "Chromium 149 treats CDATA as a comment for innerHTML on an external SVG integration-point context; the pinned WPT fragment result is text"
      }
    }
  },
  {
    id: "mathml-text-integration-fragment",
    html: "<b>x</b><mglyph/>",
    fragmentContext: fragment(MATHML_NAMESPACE, "mi")
  },
  {
    id: "mathml-annotation-html-fragment",
    html: "<p>x</p><svg><circle/></svg>",
    fragmentContext: fragment(MATHML_NAMESPACE, "annotation-xml", [{
      namespaceUri: null,
      prefix: null,
      localName: "encoding",
      qualifiedName: "encoding",
      value: "text/html"
    }]),
    acceptedBrowserTrees: {
      firefox: {
        engineSha256: "c4d540bde33519679ab2d289f1e76963c15e1ac3a4569c4e0a9c070567e15baa",
        browserSha256: "2c14e71105a44a9596b4f8a1ce46943132dcc28dca8bc02e78b62e1c823f0b30",
        reason: "Firefox 151 does not apply the annotation-xml encoding integration point for innerHTML on an external MathML context; the pinned WPT fragment result uses HTML namespace"
      }
    }
  }
]);

await runBrowserTreeDifferential({
  schema: "engine-foreign-fragment-browser-diff/v1",
  cases: CASES
});
