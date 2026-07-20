import { readFileSync } from "node:fs";

import {
  createEngineResourceGuard,
  type EngineResourceUsage
} from "../../src/internal/html-engine/resource-guard.js";
import {
  HtmlTokenizer,
  type HtmlTokenizerInitialState
} from "../../src/internal/html-engine/tokenizer/tokenizer.js";

import type { EngineParseError } from "../../src/internal/html-engine/diagnostics.js";
import type { HtmlToken } from "../../src/internal/html-engine/tokens.js";

const TOKENIZER_FIXTURE_PATHS = Object.freeze([
  "vendor/html5lib-tests/tokenizer/test1.test",
  "vendor/html5lib-tests/tokenizer/test2.test",
  "vendor/html5lib-tests/tokenizer/test3.test",
  "vendor/html5lib-tests/tokenizer/test4.test",
  "vendor/html5lib-tests/tokenizer/entities.test",
  "vendor/html5lib-tests/tokenizer/namedEntities.test",
  "vendor/html5lib-tests/tokenizer/numericEntities.test",
  "vendor/html5lib-tests/tokenizer/unicodeChars.test",
  "vendor/html5lib-tests/tokenizer/unicodeCharsProblematic.test",
  "vendor/html5lib-tests/tokenizer/domjs.test",
  "vendor/html5lib-tests/tokenizer/escapeFlag.test",
  "vendor/html5lib-tests/tokenizer/contentModelFlags.test",
  "vendor/html5lib-tests/tokenizer/pendingSpecChanges.test",
  "vendor/html5lib-tests/tokenizer/xmlViolation.test"
]);

type FixtureToken = readonly unknown[];

interface RawFixtureError {
  readonly code: string;
  readonly line: number;
  readonly col: number;
}

interface RawTokenizerFixture {
  readonly description?: string;
  readonly input?: string;
  readonly output?: readonly FixtureToken[];
  readonly errors?: readonly RawFixtureError[];
  readonly initialStates?: readonly string[];
  readonly lastStartTag?: string;
  readonly doubleEscaped?: boolean;
}

interface RawTokenizerFixtureFile {
  readonly tests?: readonly RawTokenizerFixture[];
  readonly xmlViolationTests?: readonly RawTokenizerFixture[];
}

export interface EngineTokenizerFixtureCase {
  readonly id: string;
  readonly fixtureId: string;
  readonly input: string;
  readonly expectedTokens: readonly FixtureToken[];
  readonly expectedErrorCodes: readonly string[] | null;
  readonly initialState: string;
  readonly tokenizerInitialState: HtmlTokenizerInitialState;
  readonly lastStartTagName: string | null;
  readonly doubleEscaped: boolean;
  readonly xmlViolationMode: boolean;
  readonly holdout: boolean;
}

export interface EngineTokenizerFixtureOutcome {
  readonly tokens: readonly HtmlToken[];
  readonly fixtureTokens: readonly FixtureToken[];
  readonly errors: readonly EngineParseError[];
  readonly resources: EngineResourceUsage;
}

function fixtureInitialState(initialState: string): HtmlTokenizerInitialState {
  switch (initialState) {
    case "Data state": return "data";
    case "RCDATA state": return "rcdata";
    case "RAWTEXT state": return "rawtext";
    case "Script data state": return "script-data";
    case "PLAINTEXT state": return "plaintext";
    case "CDATA section state": return "cdata-section";
    default: throw new Error(`Unknown tokenizer fixture initial state: ${initialState}`);
  }
}

function computeHoldout(fixtureId: string): boolean {
  let hash = 0;
  for (let index = 0; index < fixtureId.length; index += 1) {
    hash = (Math.imul(hash, 33) + fixtureId.charCodeAt(index)) >>> 0;
  }
  return hash % 10 === 0;
}

export function loadEngineTokenizerFixtures(): readonly EngineTokenizerFixtureCase[] {
  const cases: EngineTokenizerFixtureCase[] = [];
  for (const path of TOKENIZER_FIXTURE_PATHS) {
    const fixtureFile = JSON.parse(readFileSync(path, "utf8")) as RawTokenizerFixtureFile;
    const fixtures = fixtureFile.tests ?? fixtureFile.xmlViolationTests ?? [];
    for (let index = 0; index < fixtures.length; index += 1) {
      const fixture = fixtures[index];
      if (fixture === undefined) continue;
      const fixtureId = `${path}#${String(index + 1)}`;
      for (const initialState of fixture.initialStates ?? ["Data state"]) {
        cases.push(Object.freeze({
          id: `${fixtureId}@${initialState}`,
          fixtureId,
          input: fixture.input ?? "",
          expectedTokens: Object.freeze((fixture.output ?? []).slice()),
          expectedErrorCodes: fixture.errors === undefined
            ? null
            : Object.freeze(fixture.errors.map((error) => error.code)),
          initialState,
          tokenizerInitialState: fixtureInitialState(initialState),
          lastStartTagName: fixture.lastStartTag ?? null,
          doubleEscaped: fixture.doubleEscaped ?? false,
          xmlViolationMode: path.endsWith("xmlViolation.test"),
          holdout: computeHoldout(fixtureId)
        }));
      }
    }
  }
  return Object.freeze(cases);
}

function normalizeCharacterData(
  value: string,
  fixture: EngineTokenizerFixtureCase
): string {
  let normalized = value;
  if (fixture.doubleEscaped && fixture.initialState !== "CDATA section state") {
    normalized = normalized.split("\0").join("\uFFFD");
    normalized = normalized.replace(/\\u0000/g, "\\uFFFD");
  }
  if (fixture.xmlViolationMode) {
    normalized = normalized.replace(/[\uFFFE\uFFFF]/g, "\uFFFD");
    normalized = normalized.replace(/\f/g, " ");
  }
  return normalized;
}

function normalizeCommentData(
  value: string,
  fixture: EngineTokenizerFixtureCase
): string {
  let normalized = value;
  if (fixture.doubleEscaped) {
    normalized = normalized.split("\0").join("\uFFFD");
    normalized = normalized.replace(/\\u0000/g, "\\uFFFD");
  }
  if (fixture.xmlViolationMode) normalized = normalized.replace(/--/g, "- -");
  return normalized;
}

function toFixtureTokens(
  tokens: readonly HtmlToken[],
  fixture: EngineTokenizerFixtureCase
): readonly FixtureToken[] {
  const comparable: unknown[][] = [];
  for (const token of tokens) {
    switch (token.kind) {
      case "eof": break;
      case "character": {
        const data = normalizeCharacterData(token.data, fixture);
        const previous = comparable.at(-1);
        if (previous?.[0] === "Character") previous[1] = String(previous[1]) + data;
        else comparable.push(["Character", data]);
        break;
      }
      case "comment":
        comparable.push(["Comment", normalizeCommentData(token.data, fixture)]);
        break;
      case "processing-instruction":
        comparable.push(["ProcessingInstruction", token.target, token.data]);
        break;
      case "start-tag": {
        const attributes: Record<string, string> = {};
        for (const attribute of token.attributes) attributes[attribute.name] = attribute.value;
        comparable.push(
          token.selfClosing
            ? ["StartTag", token.name, attributes, true]
            : ["StartTag", token.name, attributes]
        );
        break;
      }
      case "end-tag":
        comparable.push(["EndTag", token.name]);
        break;
      case "doctype":
        comparable.push([
          "DOCTYPE",
          token.name,
          token.publicIdentifier,
          token.systemIdentifier,
          !token.forceQuirks
        ]);
        break;
    }
  }
  return Object.freeze(comparable.map((token) => Object.freeze(token)));
}

export function runEngineTokenizerFixture(
  fixture: EngineTokenizerFixtureCase,
  chunks: readonly string[]
): EngineTokenizerFixtureOutcome {
  const tokens: HtmlToken[] = [];
  const errors: EngineParseError[] = [];
  const guard = createEngineResourceGuard({
    limits: {
      maxSteps: 1_000_000,
      maxAttributesPerElement: 10_000,
      maxAttributeUtf8BytesPerElement: 16_000,
      maxParseErrors: 2_000
    }
  });
  const tokenizer = new HtmlTokenizer(
    guard,
    {
      accept(token) {
        tokens.push(token);
        return true;
      }
    },
    {
      initialState: fixture.tokenizerInitialState,
      lastStartTagName: fixture.lastStartTagName,
      observer: { onParseError: (error) => errors.push(error) }
    }
  );
  for (const chunk of chunks) tokenizer.write(chunk);
  tokenizer.close();
  return Object.freeze({
    tokens: Object.freeze(tokens),
    fixtureTokens: toFixtureTokens(tokens, fixture),
    errors: Object.freeze(errors),
    resources: guard.snapshot()
  });
}
