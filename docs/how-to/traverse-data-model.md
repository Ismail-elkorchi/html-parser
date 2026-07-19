# Traverse The Data Model

## Goal
Walk the parsed tree to find elements, inspect attributes, and collect text
without guessing the output structure.

## Prerequisites
- `@ismail-elkorchi/html-parser` installed
- HTML input that you want to query structurally

## Copy/paste
```ts
import {
  SVG_NAMESPACE_URI,
  findAllByAttr,
  findAllByTagName,
  findAllByTagNameNS,
  getAttributeValue,
  extractText,
  parse,
  TEXT_CONTENT_POLICY,
  walkElements
} from "@ismail-elkorchi/html-parser";

const { tree: documentTree } = parse(`
  <main>
    <article data-kind="news"><h1>Launch</h1><p>Stable docs</p></article>
    <article data-kind="note"><h1>Heads up</h1></article>
  </main>
`);

const articles = [...findAllByTagName(documentTree, "article")];
const newsArticles = [...findAllByAttr(documentTree, "data-kind", "news")];
const svgTitles = [...findAllByTagNameNS(documentTree, SVG_NAMESPACE_URI, "title")];
const firstKind = newsArticles[0] ? getAttributeValue(newsArticles[0], "DATA-KIND") : undefined;

walkElements(documentTree, (node, depth) => {
  if (node.tagName === "h1") {
    console.log(depth, extractText(node, {
      policy: TEXT_CONTENT_POLICY,
      maxOutputBytes: 1_024,
      maxTokens: 128
    }).text);
  }
});

console.log(articles.length);
console.log(newsArticles.length);
console.log(svgTitles.length);
console.log(firstKind);
```

## Expected output
```txt
3 Launch
3 Heads up
2
1
0
news
```

## Common failure modes
- Treating `DocumentTree` and `FragmentTree` as if they were raw arrays instead
  of objects with `kind`, `children`, and `errors`.
- Assuming every node is an element; text, comment, and doctype nodes are part
  of the public model.
- Using the HTML-only convenience queries for SVG or MathML. Use the `NS`
  variants when namespace identity matters.
- Comparing `attribute.name` without considering `namespaceUri` and
  `localName`; use the shared attribute helpers.
- Reimplementing recursive traversal when stack-safe helpers such as
  `walkElements`, `findAllByTagName`, and `findAllByAttr` already fit the job.

## Related reference
- [Data model](../reference/data-model.md)
- [API overview](../reference/api-overview.md)
- [Options](../reference/options.md)
