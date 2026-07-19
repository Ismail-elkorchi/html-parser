export interface TreeBudgets {
  readonly maxNodes?: number;
  readonly maxDepth?: number;
  readonly maxParseErrors?: number;
  readonly maxAttributesPerElement?: number;
  readonly maxAttributeBytes?: number;
}

export interface TreeSpan {
  readonly start: number;
  readonly end: number;
}

export interface TreeAttribute {
  readonly namespaceUri: string | null;
  readonly prefix: string | null;
  readonly localName: string;
  readonly name: string;
  readonly value: string;
  readonly span?: TreeSpan;
}

export interface TreeBuildOptions {
  readonly fragmentContextTagName?: string;
  readonly scriptingEnabled?: boolean;
  readonly captureSpans?: boolean;
  readonly checkpoint?: () => void;
  readonly onToken?: (kind: TreeTokenKind, token: TreeTokenDetails) => void;
  readonly onParseError?: (error: TreeBuilderError) => void;
  readonly onInsertionModeTransition?: (transition: TreeInsertionModeTransition) => void;
}

export interface TreeTokenDetails {
  readonly attributes?: readonly Readonly<{ readonly name: string; readonly value: string }>[];
  readonly name?: string | null;
  readonly publicId?: string | null;
  readonly systemId?: string | null;
}

export type TreeTokenKind =
  | "startTag"
  | "endTag"
  | "comment"
  | "doctype"
  | "character"
  | "eof";

export interface TreeNodeDocument {
  readonly kind: "document";
  readonly children: readonly TreeNode[];
}

export interface TreeNodeElement {
  readonly kind: "element";
  readonly namespaceUri: string;
  readonly prefix: string | null;
  readonly localName: string;
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

export type TreeDoctypeExternalId =
  | { readonly kind: "none" }
  | {
      readonly kind: "public";
      readonly publicId: string;
      readonly systemId: string | null;
    }
  | { readonly kind: "system"; readonly systemId: string };

export interface TreeNodeDoctype {
  readonly kind: "doctype";
  readonly name: string;
  readonly externalId: TreeDoctypeExternalId;
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
  readonly resourceUsage: TreeResourceUsage;
}

export interface TreeResourceUsage {
  readonly nodes: number;
  readonly maxDepth: number;
  readonly parseErrors: number;
  readonly attributes: number;
  readonly attributeUtf8Bytes: number;
}
