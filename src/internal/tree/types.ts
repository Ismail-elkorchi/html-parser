export interface TreeBudgets {
  readonly maxNodes?: number;
  readonly maxDepth?: number;
  readonly maxAttributesPerElement?: number;
  readonly maxAttributeBytes?: number;
}

export interface TreeSpan {
  readonly start: number;
  readonly end: number;
}

export interface TreeAttribute {
  readonly name: string;
  readonly value: string;
  readonly span?: TreeSpan;
}

export interface TreeBuildOptions {
  readonly fragmentContextTagName?: string;
  readonly scriptingEnabled?: boolean;
  readonly captureSpans?: boolean;
  readonly onParseError?: (error: TreeBuilderError) => void;
  readonly onInsertionModeTransition?: (transition: TreeInsertionModeTransition) => void;
}

export interface TreeNodeDocument {
  readonly kind: "document";
  readonly children: readonly TreeNode[];
}

export interface TreeNodeElement {
  readonly kind: "element";
  readonly name: string;
  readonly attributes: readonly TreeAttribute[];
  readonly children: readonly TreeNode[];
  readonly span?: TreeSpan;
}

export interface TreeNodeText {
  readonly kind: "text";
  readonly value: string;
  readonly span?: TreeSpan;
}

export interface TreeNodeComment {
  readonly kind: "comment";
  readonly value: string;
  readonly span?: TreeSpan;
}

export interface TreeNodeDoctype {
  readonly kind: "doctype";
  readonly name: string;
  readonly publicId: string;
  readonly systemId: string;
  readonly span?: TreeSpan;
}

export type TreeNode =
  | TreeNodeElement
  | TreeNodeText
  | TreeNodeComment
  | TreeNodeDoctype;

export interface TreeBuilderError {
  readonly code: string;
  readonly tokenIndex: number;
  readonly startOffset?: number;
  readonly endOffset?: number;
}

export interface TreeInsertionModeTransition {
  readonly fromMode: string;
  readonly toMode: string;
  readonly tokenType: string | null;
  readonly tokenTagName: string | null;
  readonly tokenStartOffset: number | null;
  readonly tokenEndOffset: number | null;
}

export interface TreeBuildResult {
  readonly document: TreeNodeDocument;
  readonly errors: readonly TreeBuilderError[];
}
