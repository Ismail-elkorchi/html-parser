import type {
  DocumentTree,
  FragmentTree,
  ParsedDocument,
  PatchPlan
} from "./types.ts";

interface ParsedDocumentRegistration {
  readonly sourceText: string | null;
  readonly spansCaptured: boolean;
}

const parsedDocuments = new WeakMap<ParsedDocument, ParsedDocumentRegistration>();
const parserOwnedTrees = new WeakSet<DocumentTree | FragmentTree>();
const patchPlans = new WeakMap<PatchPlan, ParsedDocument>();

/** Registers identity-bound state which must not be forgeable through public object shapes. */
export function registerParsedDocument(
  document: ParsedDocument,
  sourceText: string | null,
  spansCaptured: boolean
): void {
  parsedDocuments.set(document, Object.freeze({ sourceText, spansCaptured }));
  parserOwnedTrees.add(document.tree);
}

/** Registers an immutable parser-owned fragment tree. */
export function registerParsedFragmentTree(tree: FragmentTree): void {
  parserOwnedTrees.add(tree);
}

/** Returns identity-bound parse state, or undefined for an unrecognized object. */
export function parsedDocumentRegistration(
  document: ParsedDocument
): ParsedDocumentRegistration | undefined {
  return parsedDocuments.get(document);
}

/** Whether a root is a deeply frozen tree produced by this module instance. */
export function isParserOwnedTree(value: unknown): value is DocumentTree | FragmentTree {
  return typeof value === "object" && value !== null && parserOwnedTrees.has(value as DocumentTree);
}

/** Binds a frozen patch plan to the exact parsed document which produced it. */
export function registerPatchPlan(plan: PatchPlan, document: ParsedDocument): void {
  patchPlans.set(plan, document);
}

/** Tests the identity binding between a patch plan and parsed document. */
export function patchPlanBelongsTo(plan: PatchPlan, document: ParsedDocument): boolean {
  return patchPlans.get(plan) === document;
}
