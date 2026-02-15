export type TokenizerState =
  | "Data"
  | "TagOpen"
  | "StartTag"
  | "EndTag"
  | "Comment"
  | "Doctype";

export type TokenizerInitialState =
  | "Data state"
  | "RCDATA state"
  | "RAWTEXT state"
  | "Script data state"
  | "PLAINTEXT state"
  | "CDATA section state";

export interface StartTagToken {
  readonly type: "StartTag";
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly selfClosing: boolean;
}

export interface EndTagToken {
  readonly type: "EndTag";
  readonly name: string;
}

export interface CommentToken {
  readonly type: "Comment";
  readonly data: string;
}

export interface DoctypeToken {
  readonly type: "Doctype";
  readonly name: string;
  readonly publicId: string | null;
  readonly systemId: string | null;
  readonly forceQuirks: boolean;
}

export interface CharacterToken {
  readonly type: "Character";
  readonly data: string;
}

export interface EOFToken {
  readonly type: "EOF";
}

export type HtmlToken =
  | StartTagToken
  | EndTagToken
  | CommentToken
  | DoctypeToken
  | CharacterToken
  | EOFToken;

export interface TokenizerParseError {
  readonly code: string;
  readonly index: number;
}

export interface TokenizerBudgets {
  readonly maxTextBytes?: number;
  readonly maxTokenBytes?: number;
  readonly maxParseErrors?: number;
  readonly maxTimeMs?: number;
}

export interface TokenizerDebugOptions {
  readonly enabled?: boolean;
  readonly windowCodePoints?: number;
  readonly lastTokens?: number;
}

export interface TokenizeOptions {
  readonly budgets?: TokenizerBudgets;
  readonly debug?: TokenizerDebugOptions;
  readonly initialState?: TokenizerInitialState;
  readonly lastStartTag?: string;
  readonly doubleEscaped?: boolean;
  readonly xmlViolationMode?: boolean;
}

export interface TokenizerDebugSnapshot {
  readonly currentState: TokenizerState;
  readonly inputWindow: string;
  readonly lastTokens: readonly HtmlToken[];
}

export interface TokenizeResult {
  readonly tokens: readonly HtmlToken[];
  readonly errors: readonly TokenizerParseError[];
  readonly debug?: TokenizerDebugSnapshot;
}
