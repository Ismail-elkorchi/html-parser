import { HTML_NAMESPACE } from "./namespaces.ts";

import type {
  HtmlAttributeNamespaceUri,
  HtmlElementNamespaceUri
} from "./namespaces.ts";
import type { NonExecutingScriptingMode, TokenizerMode } from "./parser-state.ts";
import type { HtmlTreeAttributeInput } from "./tree-model.ts";

/** One namespace-aware attribute on the external fragment context element. */
export interface HtmlFragmentContextAttribute {
  readonly namespaceUri: HtmlAttributeNamespaceUri;
  readonly prefix: string | null;
  readonly localName: string;
  readonly qualifiedName: string;
  readonly value: string;
}

/** External context retained by an isolated fragment parse. */
export interface HtmlFragmentContext {
  readonly namespaceUri: HtmlElementNamespaceUri;
  readonly localName: string;
  readonly attributes: readonly HtmlFragmentContextAttribute[];
}

/** Selects the fragment tokenizer entry state without treating foreign names as HTML elements. */
export function fragmentTokenizerMode(
  context: HtmlFragmentContext,
  scriptingMode: NonExecutingScriptingMode
): TokenizerMode {
  if (context.namespaceUri !== HTML_NAMESPACE) return "data";
  switch (context.localName) {
    case "title":
    case "textarea":
      return "rcdata";
    case "style":
    case "xmp":
    case "iframe":
    case "noembed":
    case "noframes":
      return "rawtext";
    case "script":
      return "script-data";
    case "noscript":
      return scriptingMode === "disabled" ? "data" : "rawtext";
    case "plaintext":
      return "plaintext";
    default:
      return "data";
  }
}

export function fragmentContextAttributes(
  context: HtmlFragmentContext
): readonly HtmlTreeAttributeInput[] {
  return Object.freeze(context.attributes.map((attribute) => Object.freeze({
    namespaceUri: attribute.namespaceUri,
    prefix: attribute.prefix,
    localName: attribute.localName,
    qualifiedName: attribute.qualifiedName,
    value: attribute.value,
    sourceSpan: null
  })));
}
