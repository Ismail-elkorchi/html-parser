export { buildTreeFromHtml, buildTreeFromTokens } from "./build.js";
export { normalizeTree } from "./normalize.js";

export type {
  TreeAttribute,
  TreeBuildOptions,
  TreeBudgets,
  TreeBuildResult,
  TreeBuilderError,
  TreeNode,
  TreeNodeComment,
  TreeNodeDoctype,
  TreeNodeDocument,
  TreeNodeElement,
  TreeSpan,
  TreeNodeText
} from "./types.js";
