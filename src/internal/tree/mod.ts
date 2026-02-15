export { buildTreeFromHtml, buildTreeFromTokens } from "./build.js";
export { normalizeTree } from "./normalize.js";

export type {
  TreeBuildOptions,
  TreeBudgets,
  TreeBuildResult,
  TreeBuilderError,
  TreeNode,
  TreeNodeComment,
  TreeNodeDoctype,
  TreeNodeDocument,
  TreeNodeElement,
  TreeNodeText
} from "./types.js";
