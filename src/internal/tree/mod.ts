export { buildTreeFromHtml, buildTreeFromTokens } from "./build.js";
export { normalizeTree } from "./normalize.js";

export type {
  TreeAttribute,
  TreeBuildOptions,
  TreeBudgets,
  TreeBuildResult,
  TreeBuilderError,
  TreeInsertionModeTransition,
  TreeNode,
  TreeNodeComment,
  TreeNodeDoctype,
  TreeNodeDocument,
  TreeNodeElement,
  TreeSpan,
  TreeNodeText
} from "./types.js";
