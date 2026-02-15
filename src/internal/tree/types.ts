export interface TreeBudgets {
  readonly maxNodes?: number;
  readonly maxDepth?: number;
  readonly maxAttributesPerElement?: number;
  readonly maxAttributeBytes?: number;
}

export interface TreeNodeDocument {
  readonly kind: "document";
  readonly children: readonly TreeNode[];
}

export interface TreeNodeElement {
  readonly kind: "element";
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly TreeNode[];
}

export interface TreeNodeText {
  readonly kind: "text";
  readonly value: string;
}

export interface TreeNodeComment {
  readonly kind: "comment";
  readonly value: string;
}

export interface TreeNodeDoctype {
  readonly kind: "doctype";
  readonly name: string;
}

export type TreeNode =
  | TreeNodeElement
  | TreeNodeText
  | TreeNodeComment
  | TreeNodeDoctype;

export interface TreeBuilderError {
  readonly code: string;
  readonly tokenIndex: number;
}

export interface TreeBuildResult {
  readonly document: TreeNodeDocument;
  readonly errors: readonly TreeBuilderError[];
}
