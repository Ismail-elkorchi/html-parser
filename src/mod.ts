export { chunk } from "./public/chunking.ts";
export {
  HtmlAbortError,
  HtmlBudgetExceededError,
  HtmlConfigurationError,
  HtmlPatchPlanningError,
  HtmlStreamReadError,
  isHtmlAbortError,
  isHtmlBudgetExceededError,
  isHtmlConfigurationError,
  isHtmlOperationalError,
  isHtmlPatchPlanningError,
  isHtmlStreamReadError
} from "./public/errors.ts";
export {
  HTML_NAMESPACE_URI,
  MATHML_NAMESPACE_URI,
  SVG_NAMESPACE_URI,
  XLINK_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  XMLNS_NAMESPACE_URI
} from "./public/model.ts";
export { outline } from "./public/outlining.ts";
export {
  getParseErrorSpecRef,
  parse,
  parseBytes,
  parseFragment,
  parseStream,
  tokenizeByteStreamEager
} from "./public/parsing.ts";
export { applyPatchPlan, computePatch } from "./public/patching.ts";
export {
  findAllByAttr,
  findAllByAttrNS,
  findAllByTagName,
  findAllByTagNameNS,
  findById,
  walk,
  walkElements
} from "./public/querying.ts";
export { serialize } from "./public/serialization.ts";
export {
  TEXT_CONTENT_POLICY,
  VISIBLE_TEXT_HTML_POLICY,
  extractText,
  getAttributeValue,
  getAttributeValueNS,
  hasAttribute,
  hasAttributeNS,
  iterateText
} from "./public/text-extraction.ts";

export type { HtmlOperationalError } from "./public/errors.ts";
export type * from "./public/types.ts";
