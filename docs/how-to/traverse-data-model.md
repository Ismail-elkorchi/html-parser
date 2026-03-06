# Traverse The Data Model

## Goal
Walk the parsed tree to find elements, inspect attributes, and collect text
without guessing the output structure.

## Prerequisites
- `@ismail-elkorchi/html-parser` installed
- HTML input that you want to query structurally

## Copy/paste
```ts
import { findAllByAttr, findAllByTagName, parse, textContent, walkElements } from "@ismail-elkorchi/html-parser";

const documentTree = parse(`
  <main>
    <article data-kind="news"><h1>Launch</h1><p>Stable docs</p></article>
    <article data-kind="note"><h1>Heads up</h1></article>
  </main>
`);

const articles = [...findAllByTagName(documentTree, "article")];
const newsArticles = [...findAllByAttr(documentTree, "data-kind", "news")];

walkElements(documentTree, (node, depth) => {
  if (node.tagName === "h1") {
    console.log(depth, textContent(node));
  }
});

console.log(articles.length);
console.log(newsArticles.length);
```

## Expected output
```txt
3 Launch
3 Heads up
2
1
```

## Common failure modes
- Treating `DocumentTree` and `FragmentTree` as if they were raw arrays instead
  of objects with `kind`, `children`, and `errors`.
- Assuming every node is an element; text, comment, and doctype nodes are part
  of the public model.
- Reimplementing traversal when helpers such as `walkElements`,
  `findAllByTagName`, and `findAllByAttr` already fit the job.

## Related reference
- [Data model](../reference/data-model.md)
- [API overview](../reference/api-overview.md)
- [Options](../reference/options.md)
