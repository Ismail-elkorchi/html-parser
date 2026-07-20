import { fragmentTokenizerMode } from "./fragment-context.ts";
import {
  HTML_NAMESPACE,
  MATHML_NAMESPACE,
  SVG_NAMESPACE,
  XLINK_NAMESPACE,
  XML_NAMESPACE,
  XMLNS_NAMESPACE
} from "./namespaces.ts";
import {
  createEngineResourceGuard,
  EngineConfigurationError,
  type EngineResourceGuardOptions,
  type EngineResourceUsage
} from "./resource-guard.ts";
import { ENGINE_STANDARD_BASELINE } from "./standards.ts";
import { HtmlTokenizer } from "./tokenizer/tokenizer.ts";
import { HtmlTreeBuilder, type HtmlTreeBuilderState } from "./tree-builder.ts";
import { HtmlTreeModel } from "./tree-model.ts";

import type { EngineParseError } from "./diagnostics.ts";
import type { HtmlFragmentContext, HtmlFragmentContextAttribute } from "./fragment-context.ts";
import type { EngineObserver } from "./observer.ts";
import type { NonExecutingScriptingMode } from "./parser-state.ts";

/** Document parser configuration supported by the independent engine. */
interface HtmlEngineDocumentConfiguration {
  readonly kind: "document";
  readonly scriptingMode: NonExecutingScriptingMode;
}

/** Fragment parser configuration supported by the independent engine. */
interface HtmlEngineFragmentConfiguration {
  readonly kind: "fragment";
  readonly scriptingMode: NonExecutingScriptingMode;
  readonly context: HtmlFragmentContext;
}

type HtmlEngineParserConfiguration =
  | HtmlEngineDocumentConfiguration
  | HtmlEngineFragmentConfiguration;

interface HtmlEngineOptions extends EngineResourceGuardOptions {
  readonly inputChunks: readonly string[];
  readonly parser: HtmlEngineParserConfiguration;
  readonly observer?: EngineObserver;
  readonly retainNodeSpans?: boolean;
}

interface HtmlEngineResult {
  readonly standardBaseline: typeof ENGINE_STANDARD_BASELINE;
  readonly parser: HtmlEngineParserConfiguration;
  readonly model: HtmlTreeModel;
  readonly state: HtmlTreeBuilderState;
  readonly parseErrors: readonly EngineParseError[];
  readonly resources: EngineResourceUsage;
}

function assertAllowedKeys(
  value: Readonly<Record<PropertyKey, unknown>>,
  allowed: ReadonlySet<PropertyKey>,
  option: string
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (!allowed.has(key)) {
      throw new EngineConfigurationError(`${option}.${String(key)}`, "is not supported");
    }
  }
}

function isRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateInputChunks(inputChunks: unknown): readonly string[] {
  if (!Array.isArray(inputChunks)) {
    throw new EngineConfigurationError("options.inputChunks", "must be an array of strings");
  }
  const validated: string[] = [];
  for (const chunk of inputChunks) {
    if (typeof chunk !== "string") {
      throw new EngineConfigurationError("options.inputChunks", "must be an array of strings");
    }
    validated.push(chunk);
  }
  return Object.freeze(validated);
}

function validateFragmentAttribute(value: unknown, index: number): HtmlFragmentContextAttribute {
  const option = `options.parser.context.attributes[${String(index)}]`;
  if (!isRecord(value)) throw new EngineConfigurationError(option, "must be an object");
  assertAllowedKeys(
    value,
    new Set(["namespaceUri", "prefix", "localName", "qualifiedName", "value"]),
    option
  );
  const namespaceUri = value["namespaceUri"];
  const prefix = value["prefix"];
  const localName = value["localName"];
  const qualifiedName = value["qualifiedName"];
  const attributeValue = value["value"];
  if (
    namespaceUri !== null &&
    namespaceUri !== XLINK_NAMESPACE &&
    namespaceUri !== XML_NAMESPACE &&
    namespaceUri !== XMLNS_NAMESPACE
  ) {
    throw new EngineConfigurationError(`${option}.namespaceUri`, "must be a supported attribute namespace");
  }
  if (prefix !== null && typeof prefix !== "string") {
    throw new EngineConfigurationError(`${option}.prefix`, "must be a string or null");
  }
  if (typeof localName !== "string" || localName.length === 0) {
    throw new EngineConfigurationError(`${option}.localName`, "must be a non-empty string");
  }
  if (typeof qualifiedName !== "string" || qualifiedName.length === 0) {
    throw new EngineConfigurationError(`${option}.qualifiedName`, "must be a non-empty string");
  }
  if (typeof attributeValue !== "string") {
    throw new EngineConfigurationError(`${option}.value`, "must be a string");
  }
  const expectedQualifiedName = prefix === null ? localName : `${prefix}:${localName}`;
  const validNamespacePrefix =
    (namespaceUri === null && prefix === null) ||
    (namespaceUri === XLINK_NAMESPACE && prefix === "xlink") ||
    (namespaceUri === XML_NAMESPACE && prefix === "xml") ||
    (namespaceUri === XMLNS_NAMESPACE &&
      ((prefix === null && localName === "xmlns") || prefix === "xmlns"));
  if (!validNamespacePrefix || qualifiedName !== expectedQualifiedName) {
    throw new EngineConfigurationError(option, "has inconsistent namespace, prefix, or qualified name");
  }
  return Object.freeze({ namespaceUri, prefix, localName, qualifiedName, value: attributeValue });
}

function validateFragmentContext(value: unknown): HtmlFragmentContext {
  const option = "options.parser.context";
  if (!isRecord(value)) throw new EngineConfigurationError(option, "must be an object");
  assertAllowedKeys(value, new Set(["namespaceUri", "localName", "attributes"]), option);
  const namespaceUri = value["namespaceUri"];
  if (
    namespaceUri !== HTML_NAMESPACE &&
    namespaceUri !== SVG_NAMESPACE &&
    namespaceUri !== MATHML_NAMESPACE
  ) {
    throw new EngineConfigurationError(`${option}.namespaceUri`, "must be an HTML, SVG, or MathML namespace");
  }
  const localName = value["localName"];
  if (typeof localName !== "string" || localName.length === 0) {
    throw new EngineConfigurationError(`${option}.localName`, "must be a non-empty string");
  }
  const rawAttributes = value["attributes"] ?? [];
  if (!Array.isArray(rawAttributes)) {
    throw new EngineConfigurationError(`${option}.attributes`, "must be an array");
  }
  const attributes: HtmlFragmentContextAttribute[] = [];
  const expandedNames = new Set<string>();
  for (let index = 0; index < rawAttributes.length; index += 1) {
    if (!Object.hasOwn(rawAttributes, index)) {
      throw new EngineConfigurationError(
        `${option}.attributes[${String(index)}]`,
        "must be an attribute object"
      );
    }
    const attribute = validateFragmentAttribute(rawAttributes[index], index);
    const expandedName = `${attribute.namespaceUri ?? ""}\u0000${attribute.localName}`;
    if (expandedNames.has(expandedName)) {
      throw new EngineConfigurationError(
        `${option}.attributes[${String(index)}]`,
        "must have a unique namespace and local name"
      );
    }
    expandedNames.add(expandedName);
    attributes.push(attribute);
  }
  return Object.freeze({ namespaceUri, localName, attributes: Object.freeze(attributes) });
}

function validateParser(parser: unknown): HtmlEngineParserConfiguration {
  if (!isRecord(parser)) {
    throw new EngineConfigurationError("options.parser", "must be a parser configuration");
  }
  const record = parser;
  const kind = record["kind"];
  if (kind !== "document" && kind !== "fragment") {
    throw new EngineConfigurationError("options.parser.kind", 'must be "document" or "fragment"');
  }
  assertAllowedKeys(
    record,
    kind === "document"
      ? new Set(["kind", "scriptingMode"])
      : new Set(["kind", "scriptingMode", "context"]),
    "options.parser"
  );
  if (record["scriptingMode"] !== "disabled" && record["scriptingMode"] !== "inert") {
    throw new EngineConfigurationError(
      "options.parser.scriptingMode",
      'must be "disabled" or "inert"'
    );
  }
  if (kind === "document") {
    return Object.freeze({ kind, scriptingMode: record["scriptingMode"] });
  }
  return Object.freeze({
    kind,
    scriptingMode: record["scriptingMode"],
    context: validateFragmentContext(record["context"])
  });
}

function validateObserver(observer: EngineObserver | undefined): EngineObserver | undefined {
  if (observer === undefined) return undefined;
  if (!isRecord(observer)) {
    throw new EngineConfigurationError("options.observer", "must be an object");
  }
  const record = observer;
  const callbackNames = new Set<PropertyKey>([
    "onToken",
    "onParseError",
    "onInsertionModeTransition",
    "onTreeMutation"
  ]);
  assertAllowedKeys(record, callbackNames, "options.observer");
  for (const name of callbackNames) {
    if (record[name] !== undefined && typeof record[name] !== "function") {
      throw new EngineConfigurationError(`options.observer.${String(name)}`, "must be a function");
    }
  }
  return observer;
}

/** Runs one isolated incremental independent-engine operation. */
export function runHtmlEngine(options: HtmlEngineOptions): HtmlEngineResult {
  const unknownOptions: unknown = options;
  if (!isRecord(unknownOptions)) {
    throw new EngineConfigurationError("options", "must be an object");
  }
  const record = unknownOptions;
  assertAllowedKeys(
    record,
    new Set([
      "inputChunks", "parser", "observer", "retainNodeSpans", "limits", "signal", "now", "startedAt"
    ]),
    "options"
  );
  const inputChunks = validateInputChunks(record["inputChunks"]);
  const parser = validateParser(record["parser"]);
  const observer = validateObserver(options.observer);
  if (options.retainNodeSpans !== undefined && typeof options.retainNodeSpans !== "boolean") {
    throw new EngineConfigurationError("options.retainNodeSpans", "must be a boolean");
  }
  const resourceOptions: EngineResourceGuardOptions = {
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.startedAt === undefined ? {} : { startedAt: options.startedAt })
  };
  const resources = createEngineResourceGuard(resourceOptions);
  const parseErrors: EngineParseError[] = [];
  const model = new HtmlTreeModel({
    rootKind: parser.kind,
    resources,
    ...(observer === undefined ? {} : { observer })
  });
  const builder = new HtmlTreeBuilder({
    model,
    resources,
    scriptingMode: parser.scriptingMode,
    retainNodeSpans: options.retainNodeSpans ?? true,
    ...(parser.kind === "fragment" ? { fragmentContext: parser.context } : {}),
    ...(observer === undefined ? {} : { observer }),
    onParseError(error) { parseErrors.push(error); }
  });
  const tokenizer = new HtmlTokenizer(resources, builder, {
    ...(parser.kind === "fragment"
      ? { initialState: fragmentTokenizerMode(parser.context, parser.scriptingMode) }
      : {}),
    protectTokenObservations: observer?.onToken !== undefined,
    observer: {
      ...(observer?.onToken === undefined
        ? {}
        : { onToken(token) { observer.onToken?.(token); } }),
      onParseError(error) {
        parseErrors.push(error);
        observer?.onParseError?.(error);
      }
    }
  });
  builder.connectTokenizer(tokenizer);
  for (const chunk of inputChunks) tokenizer.write(chunk);
  tokenizer.close();
  return Object.freeze({
    standardBaseline: ENGINE_STANDARD_BASELINE,
    parser,
    model,
    state: builder.state(),
    parseErrors: Object.freeze(parseErrors),
    resources: resources.snapshot()
  });
}
