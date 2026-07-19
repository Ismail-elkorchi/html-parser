import { failInternalState } from "../foundation/internal-state-error.js";

import {
  HTML_NAMESPACE,
  XLINK_NAMESPACE,
  XML_NAMESPACE,
  XMLNS_NAMESPACE
} from "./namespaces.js";
import { sourceSpan } from "./positions.js";

import type {
  HtmlAttributeNamespaceUri,
  HtmlElementNamespaceUri
} from "./namespaces.js";
import type { EngineObserver, TreeMutationKind } from "./observer.js";
import type { SourceSpan } from "./positions.js";
import type { EngineResourceGuard } from "./resource-guard.js";
import type { InternalStateErrorReason } from "../foundation/internal-state-error.js";

/** Precise shared internal-state reasons owned by the direct tree model. */
export type HtmlTreeModelErrorReason = Extract<
  InternalStateErrorReason,
  `TREE_MODEL_${string}`
>;

/** Stable private identity; intentionally not assignable to the public numeric NodeId. */
export interface HtmlTreeNodeIdentity {
  readonly serial: number;
}

interface HtmlTreeContainer {
  readonly childCount: number;
  childAt(index: number): HtmlTreeNode | null;
}

interface SubtreeDepthAssignment {
  readonly state: NodeState;
  readonly depth: number | null;
}

interface HtmlTreeNodeBase {
  readonly identity: HtmlTreeNodeIdentity;
  readonly parent: HtmlTreeParent | null;
  readonly sourceSpan: SourceSpan | null;
}

export interface HtmlTreeDocument extends HtmlTreeContainer {
  readonly kind: "document";
  readonly identity: HtmlTreeNodeIdentity;
}

export interface HtmlTreeFragment extends HtmlTreeContainer {
  readonly kind: "fragment";
  readonly identity: HtmlTreeNodeIdentity;
}

export interface HtmlTemplateContents extends HtmlTreeContainer {
  readonly kind: "template-contents";
  readonly host: HtmlTreeElement;
}

/** Immutable attribute value retained in token order. */
export interface HtmlTreeAttribute {
  readonly namespaceUri: HtmlAttributeNamespaceUri;
  readonly prefix: string | null;
  readonly localName: string;
  readonly qualifiedName: string;
  readonly value: string;
  readonly sourceSpan: SourceSpan | null;
}

export interface HtmlTreeAttributeInput {
  readonly namespaceUri: HtmlAttributeNamespaceUri;
  readonly prefix: string | null;
  readonly localName: string;
  readonly qualifiedName: string;
  readonly value: string;
  readonly sourceSpan?: SourceSpan | null;
}

export interface HtmlTreeElement extends HtmlTreeNodeBase, HtmlTreeContainer {
  readonly kind: "element";
  readonly namespaceUri: HtmlElementNamespaceUri;
  readonly prefix: string | null;
  readonly localName: string;
  readonly qualifiedName: string;
  readonly attributeCount: number;
  attributeAt(index: number): HtmlTreeAttribute | null;
  readonly templateContents: HtmlTemplateContents | null;
}

export interface HtmlTreeText extends HtmlTreeNodeBase {
  readonly kind: "text";
  readonly data: string;
}

export interface HtmlTreeComment extends HtmlTreeNodeBase {
  readonly kind: "comment";
  readonly data: string;
}

export interface HtmlTreeProcessingInstruction extends HtmlTreeNodeBase {
  readonly kind: "processing-instruction";
  readonly target: string;
  readonly data: string;
}

export type HtmlTreeDoctypeExternalId =
  | { readonly kind: "none" }
  | {
      readonly kind: "public";
      readonly publicIdentifier: string;
      readonly systemIdentifier: string | null;
    }
  | { readonly kind: "system"; readonly systemIdentifier: string };

export interface HtmlTreeDoctype extends HtmlTreeNodeBase {
  readonly kind: "doctype";
  readonly name: string;
  readonly externalId: HtmlTreeDoctypeExternalId;
}

export type HtmlTreeRoot = HtmlTreeDocument | HtmlTreeFragment;
export type HtmlTreeNode =
  | HtmlTreeElement
  | HtmlTreeText
  | HtmlTreeComment
  | HtmlTreeProcessingInstruction
  | HtmlTreeDoctype;
export type HtmlTreeParent = HtmlTreeRoot | HtmlTreeElement | HtmlTemplateContents;

export interface HtmlTreeElementInput {
  readonly namespaceUri: HtmlElementNamespaceUri;
  readonly prefix: string | null;
  readonly localName: string;
  readonly qualifiedName: string;
  readonly attributes?: readonly HtmlTreeAttributeInput[];
  readonly sourceSpan?: SourceSpan | null;
}

export interface HtmlTreeDoctypeInput {
  readonly name: string;
  readonly externalId: HtmlTreeDoctypeExternalId;
  readonly sourceSpan?: SourceSpan | null;
}

export interface HtmlTreeModelOptions {
  readonly rootKind: HtmlTreeRoot["kind"];
  readonly resources: EngineResourceGuard;
  readonly observer?: EngineObserver;
}

export interface HtmlTreeWalkEntry {
  readonly node: HtmlTreeNode;
  readonly depth: number;
}

export interface HtmlTreeValidationResult {
  readonly allocatedNodes: number;
  readonly attachedNodes: number;
  readonly maxDepth: number;
}

interface NodeState {
  readonly owner: HtmlTreeModel;
  parent: HtmlTreeParent | null;
  sourceSpan: SourceSpan | null;
  depth: number | null;
}

interface ParentState {
  readonly owner: HtmlTreeModel;
  readonly children: HtmlTreeNode[];
}

interface ElementState {
  readonly attributes: HtmlTreeAttribute[];
  templateContents: HtmlTemplateContents | null;
}

interface TextState {
  data: string;
}

const NODE_STATES = new WeakMap<HtmlTreeNode, NodeState>();
const PARENT_STATES = new WeakMap<HtmlTreeParent, ParentState>();
const ELEMENT_STATES = new WeakMap<HtmlTreeElement, ElementState>();
const TEXT_STATES = new WeakMap<HtmlTreeText, TextState>();

function fail(reason: HtmlTreeModelErrorReason): never {
  return failInternalState(reason);
}

function checkedSpan(span: SourceSpan | null | undefined): SourceSpan | null {
  if (span === null || span === undefined) return null;
  validateSpan(span);
  return sourceSpan(span.startUtf16Offset, span.endUtf16Offset);
}

function validateSpan(span: SourceSpan): void {
  if (
    !Number.isSafeInteger(span.startUtf16Offset) ||
    !Number.isSafeInteger(span.endUtf16Offset) ||
    span.startUtf16Offset < 0 ||
    span.endUtf16Offset < span.startUtf16Offset
  ) {
    fail("TREE_MODEL_INVALID_SOURCE_SPAN");
  }
}

function validateName(localName: string, prefix: string | null, qualifiedName: string): void {
  if (localName.length === 0) fail("TREE_MODEL_EMPTY_LOCAL_NAME");
  if (prefix !== null && prefix.length === 0) fail("TREE_MODEL_EMPTY_PREFIX");
  const expected = prefix === null ? localName : `${prefix}:${localName}`;
  if (qualifiedName !== expected) fail("TREE_MODEL_INVALID_QUALIFIED_NAME");
}

function validateAttributeNamespace(attribute: HtmlTreeAttributeInput): void {
  const { namespaceUri, prefix, localName } = attribute;
  const valid =
    (namespaceUri === null && prefix === null) ||
    (namespaceUri === XLINK_NAMESPACE && prefix === "xlink") ||
    (namespaceUri === XML_NAMESPACE && prefix === "xml") ||
    (namespaceUri === XMLNS_NAMESPACE &&
      ((prefix === null && localName === "xmlns") || prefix === "xmlns"));
  if (!valid) fail("TREE_MODEL_ATTRIBUTE_NAMESPACE_PREFIX_MISMATCH");
}

function attributeKey(attribute: Pick<HtmlTreeAttributeInput, "namespaceUri" | "localName">): string {
  return `${attribute.namespaceUri ?? ""}\u0000${attribute.localName}`;
}

function validateAttributeInputs(attributes: readonly HtmlTreeAttributeInput[]): void {
  const expandedNames = new Set<string>();
  for (const attribute of attributes) {
    validateName(attribute.localName, attribute.prefix, attribute.qualifiedName);
    validateAttributeNamespace(attribute);
    if (attribute.sourceSpan !== null && attribute.sourceSpan !== undefined) {
      validateSpan(attribute.sourceSpan);
    }
    const key = attributeKey(attribute);
    if (expandedNames.has(key)) fail("TREE_MODEL_DUPLICATE_ATTRIBUTE");
    expandedNames.add(key);
  }
}

function copyAttribute(attribute: HtmlTreeAttributeInput): HtmlTreeAttribute {
  return Object.freeze({
    namespaceUri: attribute.namespaceUri,
    prefix: attribute.prefix,
    localName: attribute.localName,
    qualifiedName: attribute.qualifiedName,
    value: attribute.value,
    sourceSpan: checkedSpan(attribute.sourceSpan)
  });
}

function copyExternalId(externalId: HtmlTreeDoctypeExternalId): HtmlTreeDoctypeExternalId {
  switch (externalId.kind) {
    case "none":
      return Object.freeze({ kind: "none" });
    case "public":
      return Object.freeze({
        kind: "public",
        publicIdentifier: externalId.publicIdentifier,
        systemIdentifier: externalId.systemIdentifier
      });
    case "system":
      return Object.freeze({ kind: "system", systemIdentifier: externalId.systemIdentifier });
  }
}

function isRoot(parent: HtmlTreeParent): parent is HtmlTreeRoot {
  return parent.kind === "document" || parent.kind === "fragment";
}

/** Direct mutation-time model used by the independent tree builder. */
export class HtmlTreeModel {
  readonly root: HtmlTreeRoot;

  readonly #resources: EngineResourceGuard;
  readonly #observer: EngineObserver | undefined;
  readonly #nodes = new Map<number, HtmlTreeRoot | HtmlTreeNode>();
  #nextSerial = 1;

  constructor(options: HtmlTreeModelOptions) {
    this.#resources = options.resources;
    this.#observer = options.observer;
    this.#resources.reserveNodeAtDepth(1);

    const identity = this.#newIdentity();
    const parentState: ParentState = { owner: this, children: [] };
    if (options.rootKind === "document") {
      const root: HtmlTreeDocument = Object.freeze({
        kind: "document",
        identity,
        get childCount(): number { return parentState.children.length; },
        childAt(index: number): HtmlTreeNode | null { return parentState.children[index] ?? null; }
      });
      this.root = root;
    } else {
      const root: HtmlTreeFragment = Object.freeze({
        kind: "fragment",
        identity,
        get childCount(): number { return parentState.children.length; },
        childAt(index: number): HtmlTreeNode | null { return parentState.children[index] ?? null; }
      });
      this.root = root;
    }
    PARENT_STATES.set(this.root, parentState);
    this.#nodes.set(identity.serial, this.root);
    this.#emit("node-created", identity.serial, null);
  }

  createElement(input: HtmlTreeElementInput): HtmlTreeElement {
    validateName(input.localName, input.prefix, input.qualifiedName);
    const attributes = input.attributes ?? [];
    validateAttributeInputs(attributes);
    const span = checkedSpan(input.sourceSpan);
    this.#resources.reserveNode();

    const identity = this.#newIdentity();
    const nodeState: NodeState = { owner: this, parent: null, sourceSpan: span, depth: null };
    const parentState: ParentState = { owner: this, children: [] };
    let templateContents: HtmlTemplateContents | null = null;
    const elementState: ElementState = {
      attributes: attributes.map(copyAttribute),
      templateContents: null
    };
    const element: HtmlTreeElement = Object.freeze({
      kind: "element",
      identity,
      namespaceUri: input.namespaceUri,
      prefix: input.prefix,
      localName: input.localName,
      qualifiedName: input.qualifiedName,
      get parent(): HtmlTreeParent | null { return nodeState.parent; },
      get sourceSpan(): SourceSpan | null { return nodeState.sourceSpan; },
      get childCount(): number { return parentState.children.length; },
      childAt(index: number): HtmlTreeNode | null { return parentState.children[index] ?? null; },
      get attributeCount(): number { return elementState.attributes.length; },
      attributeAt(index: number): HtmlTreeAttribute | null {
        return elementState.attributes[index] ?? null;
      },
      get templateContents(): HtmlTemplateContents | null { return templateContents; }
    });

    if (input.namespaceUri === HTML_NAMESPACE && input.localName === "template") {
      const templateState: ParentState = { owner: this, children: [] };
      templateContents = Object.freeze({
        kind: "template-contents",
        host: element,
        get childCount(): number { return templateState.children.length; },
        childAt(index: number): HtmlTreeNode | null { return templateState.children[index] ?? null; }
      });
      PARENT_STATES.set(templateContents, templateState);
    }

    elementState.templateContents = templateContents;
    NODE_STATES.set(element, nodeState);
    PARENT_STATES.set(element, parentState);
    ELEMENT_STATES.set(element, elementState);
    this.#nodes.set(identity.serial, element);
    this.#emit("node-created", identity.serial, null);
    return element;
  }

  createText(data: string, span: SourceSpan | null = null): HtmlTreeText {
    if (data.length === 0) fail("TREE_MODEL_EMPTY_TEXT_DATA");
    const source = checkedSpan(span);
    this.#resources.reserveNode();
    const identity = this.#newIdentity();
    const nodeState: NodeState = { owner: this, parent: null, sourceSpan: source, depth: null };
    const textState: TextState = { data };
    const text: HtmlTreeText = Object.freeze({
      kind: "text",
      identity,
      get parent(): HtmlTreeParent | null { return nodeState.parent; },
      get sourceSpan(): SourceSpan | null { return nodeState.sourceSpan; },
      get data(): string { return textState.data; }
    });
    NODE_STATES.set(text, nodeState);
    TEXT_STATES.set(text, textState);
    this.#nodes.set(identity.serial, text);
    this.#emit("node-created", identity.serial, null);
    return text;
  }

  createComment(data: string, span: SourceSpan | null = null): HtmlTreeComment {
    const source = checkedSpan(span);
    this.#resources.reserveNode();
    const identity = this.#newIdentity();
    const nodeState: NodeState = { owner: this, parent: null, sourceSpan: source, depth: null };
    const comment: HtmlTreeComment = Object.freeze({
      kind: "comment",
      identity,
      data,
      get parent(): HtmlTreeParent | null { return nodeState.parent; },
      get sourceSpan(): SourceSpan | null { return nodeState.sourceSpan; }
    });
    NODE_STATES.set(comment, nodeState);
    this.#nodes.set(identity.serial, comment);
    this.#emit("node-created", identity.serial, null);
    return comment;
  }

  createProcessingInstruction(
    target: string,
    data: string,
    span: SourceSpan | null = null
  ): HtmlTreeProcessingInstruction {
    if (target.length === 0) fail("TREE_MODEL_EMPTY_PROCESSING_INSTRUCTION_TARGET");
    const source = checkedSpan(span);
    this.#resources.reserveNode();
    const identity = this.#newIdentity();
    const nodeState: NodeState = { owner: this, parent: null, sourceSpan: source, depth: null };
    const instruction: HtmlTreeProcessingInstruction = Object.freeze({
      kind: "processing-instruction",
      identity,
      target,
      data,
      get parent(): HtmlTreeParent | null { return nodeState.parent; },
      get sourceSpan(): SourceSpan | null { return nodeState.sourceSpan; }
    });
    NODE_STATES.set(instruction, nodeState);
    this.#nodes.set(identity.serial, instruction);
    this.#emit("node-created", identity.serial, null);
    return instruction;
  }

  createDoctype(input: HtmlTreeDoctypeInput): HtmlTreeDoctype {
    const span = checkedSpan(input.sourceSpan);
    this.#resources.reserveNode();
    const identity = this.#newIdentity();
    const nodeState: NodeState = { owner: this, parent: null, sourceSpan: span, depth: null };
    const doctype: HtmlTreeDoctype = Object.freeze({
      kind: "doctype",
      identity,
      name: input.name,
      externalId: copyExternalId(input.externalId),
      get parent(): HtmlTreeParent | null { return nodeState.parent; },
      get sourceSpan(): SourceSpan | null { return nodeState.sourceSpan; }
    });
    NODE_STATES.set(doctype, nodeState);
    this.#nodes.set(identity.serial, doctype);
    this.#emit("node-created", identity.serial, null);
    return doctype;
  }

  append(parent: HtmlTreeParent, node: HtmlTreeNode): void {
    this.insertBefore(parent, node, null);
  }

  insertBefore(parent: HtmlTreeParent, node: HtmlTreeNode, before: HtmlTreeNode | null): void {
    const target = this.insertionParent(parent);
    const targetState = this.#parentState(target);
    const nodeState = this.#nodeState(node);
    const oldParent = nodeState.parent;
    const currentIndex = oldParent === target ? targetState.children.indexOf(node) : -1;
    if (oldParent === target && currentIndex < 0) fail("TREE_MODEL_REFERENCE_NOT_CHILD");

    let reference = before;
    if (reference !== null) {
      this.#nodeState(reference);
      if (reference.parent !== target) fail("TREE_MODEL_REFERENCE_NOT_CHILD");
      if (reference === node) {
        reference = targetState.children[currentIndex + 1] ?? null;
      }
    }
    if (this.#subtreeContainsParent(node, target)) fail("TREE_MODEL_ANCESTOR_CYCLE");
    if (node.kind === "doctype" && target.kind !== "document") {
      fail("TREE_MODEL_DOCTYPE_UNDER_NON_DOCUMENT");
    }
    if (node.kind === "text" && target.kind === "document") {
      fail("TREE_MODEL_TEXT_UNDER_DOCUMENT");
    }

    const referenceIndex = reference === null ? targetState.children.length : targetState.children.indexOf(reference);
    if (referenceIndex < 0) fail("TREE_MODEL_REFERENCE_NOT_CHILD");
    const insertionIndex = referenceIndex - (
      oldParent === target && currentIndex < referenceIndex ? 1 : 0
    );
    if (target.kind === "document") {
      this.#validateDocumentInsertion(targetState.children, node, insertionIndex);
    }

    if (oldParent === target && currentIndex === insertionIndex) {
      this.#resources.checkpoint();
      return;
    }

    const parentDepth = this.#parentDepth(target);
    const depthAssignments = this.#prepareSubtreeDepths(
      node,
      parentDepth === null ? null : parentDepth + 1
    );
    if (parentDepth !== null) {
      this.#resources.observeDepth(parentDepth + depthAssignments.maxRelativeDepth);
      this.#authorizeDepthApplication(depthAssignments.assignments);
    } else {
      this.#resources.checkpoint();
    }

    const oldParentSerial = oldParent === null ? null : this.#observableParentSerial(oldParent);
    if (oldParent !== null) {
      const oldState = this.#parentState(oldParent);
      const oldIndex = oldState.children.indexOf(node);
      if (oldIndex < 0) fail("TREE_MODEL_REFERENCE_NOT_CHILD");
      oldState.children.splice(oldIndex, 1);
    }
    targetState.children.splice(insertionIndex, 0, node);
    nodeState.parent = target;
    this.#applySubtreeDepths(depthAssignments.assignments);

    if (oldParent !== null) this.#emit("node-detached", node.identity.serial, oldParentSerial);
    this.#emit("node-inserted", node.identity.serial, this.#observableParentSerial(target));
  }

  detach(node: HtmlTreeNode): boolean {
    const nodeState = this.#nodeState(node);
    this.#resources.checkpoint();
    const parent = nodeState.parent;
    if (parent === null) return false;
    const parentState = this.#parentState(parent);
    const index = parentState.children.indexOf(node);
    if (index < 0) fail("TREE_MODEL_REFERENCE_NOT_CHILD");
    const depthAssignments = this.#prepareSubtreeDepths(node, null);
    parentState.children.splice(index, 1);
    nodeState.parent = null;
    this.#applySubtreeDepths(depthAssignments.assignments);
    this.#emit("node-detached", node.identity.serial, this.#observableParentSerial(parent));
    return true;
  }

  /** Moves one element's semantic children to another element in linear mutation order. */
  moveChildren(source: HtmlTreeElement, destination: HtmlTreeElement): number {
    this.#elementState(source);
    this.#elementState(destination);
    if (source === destination) fail("TREE_MODEL_ANCESTOR_CYCLE");
    const sourceParent = this.insertionParent(source);
    const destinationParent = this.insertionParent(destination);
    const sourceState = this.#parentState(sourceParent);
    const destinationState = this.#parentState(destinationParent);
    const children = [...sourceState.children];
    const destinationDepth = this.#parentDepth(destinationParent);
    const childDepthAssignments: SubtreeDepthAssignment[][] = [];

    for (const child of children) {
      this.#resources.checkpoint();
      if (this.#subtreeContainsParent(child, destinationParent)) fail("TREE_MODEL_ANCESTOR_CYCLE");
      const depthAssignments = this.#prepareSubtreeDepths(
        child,
        destinationDepth === null ? null : destinationDepth + 1
      );
      if (destinationDepth !== null) {
        this.#resources.observeDepth(destinationDepth + depthAssignments.maxRelativeDepth);
      }
      childDepthAssignments.push(depthAssignments.assignments);
    }

    for (const assignments of childDepthAssignments) {
      this.#resources.checkpoint();
      if (destinationDepth !== null) this.#authorizeDepthApplication(assignments);
    }

    sourceState.children.length = 0;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      const assignments = childDepthAssignments[index];
      if (child === undefined || assignments === undefined) {
        fail("TREE_MODEL_REFERENCE_NOT_CHILD");
      }
      const state = this.#nodeState(child);
      state.parent = destinationParent;
      destinationState.children.push(child);
      this.#applySubtreeDepths(assignments);
      this.#emit("node-detached", child.identity.serial, this.#observableParentSerial(sourceParent));
      this.#emit("node-inserted", child.identity.serial, this.#observableParentSerial(destinationParent));
    }
    return children.length;
  }

  adoptAttributes(element: HtmlTreeElement, attributes: readonly HtmlTreeAttributeInput[]): number {
    const state = this.#elementState(element);
    validateAttributeInputs(attributes);
    const present = new Set(state.attributes.map(attributeKey));
    let adopted = 0;
    for (const attribute of attributes) {
      this.#resources.checkpoint();
      const key = attributeKey(attribute);
      if (present.has(key)) continue;
      state.attributes.push(copyAttribute(attribute));
      present.add(key);
      adopted += 1;
    }
    if (adopted > 0) {
      const parent = this.#nodeState(element).parent;
      this.#emit(
        "attributes-adopted",
        element.identity.serial,
        parent === null ? null : this.#observableParentSerial(parent)
      );
    }
    return adopted;
  }

  insertText(
    parent: HtmlTreeDocument,
    data: string,
    span: SourceSpan | null,
    before?: HtmlTreeNode | null
  ): null;
  insertText(
    parent: Exclude<HtmlTreeParent, HtmlTreeDocument>,
    data: string,
    span: SourceSpan | null,
    before?: HtmlTreeNode | null
  ): HtmlTreeText;
  insertText(
    parent: HtmlTreeParent,
    data: string,
    span: SourceSpan | null,
    before?: HtmlTreeNode | null
  ): HtmlTreeText | null;
  insertText(
    parent: HtmlTreeParent,
    data: string,
    span: SourceSpan | null,
    before: HtmlTreeNode | null = null
  ): HtmlTreeText | null {
    if (data.length === 0) fail("TREE_MODEL_EMPTY_TEXT_DATA");
    const target = this.insertionParent(parent);
    const targetState = this.#parentState(target);
    if (target.kind === "document") {
      this.#resources.checkpoint();
      return null;
    }
    if (before !== null) {
      this.#nodeState(before);
      if (before.parent !== target) fail("TREE_MODEL_REFERENCE_NOT_CHILD");
    }
    const index = before === null ? targetState.children.length : targetState.children.indexOf(before);
    const previous = targetState.children[index - 1];
    if (previous?.kind === "text") {
      const textState = TEXT_STATES.get(previous);
      const nodeState = NODE_STATES.get(previous);
      if (textState === undefined || nodeState === undefined) fail("TREE_MODEL_UNKNOWN_NODE");
      if (nodeState.owner !== this) fail("TREE_MODEL_FOREIGN_NODE");
      const nextSpan = checkedSpan(span);
      this.#resources.checkpoint();
      textState.data += data;
      nodeState.sourceSpan = this.#coalescedSpan(nodeState.sourceSpan, nextSpan);
      this.#emit("text-coalesced", previous.identity.serial, this.#observableParentSerial(target));
      return previous;
    }
    const text = this.createText(data, span);
    this.insertBefore(target, text, before);
    return text;
  }

  setSourceSpan(node: HtmlTreeNode, span: SourceSpan | null): void {
    const state = this.#nodeState(node);
    const checked = checkedSpan(span);
    this.#resources.checkpoint();
    state.sourceSpan = checked;
  }

  insertionParent(parent: HtmlTreeParent): HtmlTreeParent {
    this.#parentState(parent);
    if (parent.kind !== "element") return parent;
    const contents = this.#elementState(parent).templateContents;
    return contents ?? parent;
  }

  attribute(
    element: HtmlTreeElement,
    namespaceUri: HtmlAttributeNamespaceUri,
    localName: string
  ): HtmlTreeAttribute | null {
    const state = this.#elementState(element);
    return state.attributes.find(
      (attribute) => attribute.namespaceUri === namespaceUri && attribute.localName === localName
    ) ?? null;
  }

  /** Walks every attached non-root node with the root fixed at depth one. */
  *walk(): IterableIterator<HtmlTreeWalkEntry> {
    const children = this.#parentState(this.root).children;
    const stack: Array<{ readonly node: HtmlTreeNode; readonly depth: number }> = [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) stack.push({ node: child, depth: 2 });
    }
    while (stack.length > 0) {
      const entry = stack.pop();
      if (entry === undefined) break;
      yield Object.freeze(entry);
      const descendants = this.#semanticChildren(entry.node);
      for (let index = descendants.length - 1; index >= 0; index -= 1) {
        const child = descendants[index];
        if (child !== undefined) stack.push({ node: child, depth: entry.depth + 1 });
      }
    }
  }

  validate(): HtmlTreeValidationResult {
    const visited = new Set<number>([this.root.identity.serial]);
    let attachedNodes = 1;
    let maxDepth = 1;
    const stack: Array<{ readonly parent: HtmlTreeParent; readonly depth: number }> = [
      { parent: this.root, depth: 1 }
    ];

    while (stack.length > 0) {
      const entry = stack.pop();
      if (entry === undefined) break;
      const parentState = this.#parentState(entry.parent);
      if (entry.parent.kind === "document") this.#validateDocumentChildren(parentState.children);
      const localChildren = new Set<number>();
      for (let index = parentState.children.length - 1; index >= 0; index -= 1) {
        const child = parentState.children[index];
        if (child === undefined) continue;
        const state = this.#nodeState(child);
        if (state.parent !== entry.parent || state.depth !== entry.depth + 1) {
          fail("TREE_MODEL_REFERENCE_NOT_CHILD");
        }
        if (localChildren.has(child.identity.serial) || visited.has(child.identity.serial)) {
          fail("TREE_MODEL_ANCESTOR_CYCLE");
        }
        localChildren.add(child.identity.serial);
        visited.add(child.identity.serial);
        attachedNodes += 1;
        maxDepth = Math.max(maxDepth, entry.depth + 1);
        if (child.kind === "element") {
          const element = this.#elementState(child);
          validateAttributeInputs(element.attributes);
          const childParent = element.templateContents ?? child;
          stack.push({ parent: childParent, depth: entry.depth + 1 });
        }
      }
    }

    return Object.freeze({
      allocatedNodes: this.#nodes.size,
      attachedNodes,
      maxDepth
    });
  }

  #newIdentity(): HtmlTreeNodeIdentity {
    const identity = Object.freeze({ serial: this.#nextSerial });
    this.#nextSerial += 1;
    return identity;
  }

  #nodeState(node: HtmlTreeNode): NodeState {
    const state = NODE_STATES.get(node);
    if (state === undefined) fail("TREE_MODEL_UNKNOWN_NODE");
    if (state.owner !== this) fail("TREE_MODEL_FOREIGN_NODE");
    return state;
  }

  #parentState(parent: HtmlTreeParent): ParentState {
    const state = PARENT_STATES.get(parent);
    if (state === undefined) fail("TREE_MODEL_UNKNOWN_PARENT");
    if (state.owner !== this) fail("TREE_MODEL_FOREIGN_PARENT");
    return state;
  }

  #elementState(element: HtmlTreeElement): ElementState {
    this.#nodeState(element);
    const state = ELEMENT_STATES.get(element);
    if (state === undefined) fail("TREE_MODEL_UNKNOWN_NODE");
    return state;
  }

  #observableParentSerial(parent: HtmlTreeParent): number {
    return parent.kind === "template-contents"
      ? parent.host.identity.serial
      : parent.identity.serial;
  }

  #parentDepth(parent: HtmlTreeParent): number | null {
    if (isRoot(parent)) return 1;
    if (parent.kind === "template-contents") return this.#nodeState(parent.host).depth;
    return this.#nodeState(parent).depth;
  }

  #semanticChildren(node: HtmlTreeNode): readonly HtmlTreeNode[] {
    if (node.kind !== "element") return [];
    const element = this.#elementState(node);
    return this.#parentState(element.templateContents ?? node).children;
  }

  #prepareSubtreeDepths(
    node: HtmlTreeNode,
    depth: number | null
  ): { readonly assignments: SubtreeDepthAssignment[]; readonly maxRelativeDepth: number } {
    const assignments: SubtreeDepthAssignment[] = [];
    let maxRelativeDepth = 1;
    const stack: Array<{
      readonly node: HtmlTreeNode;
      readonly depth: number | null;
      readonly relativeDepth: number;
    }> = [
      { node, depth, relativeDepth: 1 }
    ];
    const visited = new Set<number>();
    while (stack.length > 0) {
      this.#resources.checkpoint();
      const entry = stack.pop();
      if (entry === undefined) break;
      const state = this.#nodeState(entry.node);
      if (visited.has(entry.node.identity.serial)) fail("TREE_MODEL_ANCESTOR_CYCLE");
      visited.add(entry.node.identity.serial);
      assignments.push({ state, depth: entry.depth });
      maxRelativeDepth = Math.max(maxRelativeDepth, entry.relativeDepth);
      const childDepth = entry.depth === null ? null : entry.depth + 1;
      for (const child of this.#semanticChildren(entry.node)) {
        stack.push({ node: child, depth: childDepth, relativeDepth: entry.relativeDepth + 1 });
      }
    }
    return { assignments, maxRelativeDepth };
  }

  #authorizeDepthApplication(assignments: readonly SubtreeDepthAssignment[]): void {
    for (let index = 0; index < assignments.length; index += 1) this.#resources.checkpoint();
  }

  #applySubtreeDepths(assignments: readonly SubtreeDepthAssignment[]): void {
    for (const assignment of assignments) assignment.state.depth = assignment.depth;
  }

  #subtreeContainsParent(node: HtmlTreeNode, parent: HtmlTreeParent): boolean {
    if (isRoot(parent)) return false;
    const target = parent.kind === "template-contents" ? parent.host : parent;
    const stack: HtmlTreeNode[] = [node];
    while (stack.length > 0) {
      this.#resources.checkpoint();
      const current = stack.pop();
      if (current === undefined) break;
      if (current === target) return true;
      for (const child of this.#semanticChildren(current)) stack.push(child);
    }
    return false;
  }

  #validateDocumentChildren(children: readonly HtmlTreeNode[]): void {
    let doctypeIndex = -1;
    let elementIndex = -1;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child?.kind === "text") fail("TREE_MODEL_TEXT_UNDER_DOCUMENT");
      if (child?.kind === "doctype") {
        if (doctypeIndex >= 0) fail("TREE_MODEL_DUPLICATE_DOCUMENT_DOCTYPE");
        doctypeIndex = index;
      } else if (child?.kind === "element") {
        if (elementIndex >= 0) fail("TREE_MODEL_DUPLICATE_DOCUMENT_ELEMENT");
        elementIndex = index;
      }
    }
    if (doctypeIndex >= 0 && elementIndex >= 0 && doctypeIndex > elementIndex) {
      fail("TREE_MODEL_DOCTYPE_AFTER_DOCUMENT_ELEMENT");
    }
  }

  #validateDocumentInsertion(
    children: readonly HtmlTreeNode[],
    node: HtmlTreeNode,
    insertionIndex: number
  ): void {
    if (node.kind === "text") fail("TREE_MODEL_TEXT_UNDER_DOCUMENT");
    if (node.kind !== "doctype" && node.kind !== "element") return;

    let retainedIndex = 0;
    let doctypeIndex = node.kind === "doctype" ? insertionIndex : -1;
    let elementIndex = node.kind === "element" ? insertionIndex : -1;
    for (const child of children) {
      if (child === node) continue;
      if (child.kind === "doctype") {
        if (doctypeIndex >= 0) fail("TREE_MODEL_DUPLICATE_DOCUMENT_DOCTYPE");
        doctypeIndex = retainedIndex;
      } else if (child.kind === "element") {
        if (elementIndex >= 0) fail("TREE_MODEL_DUPLICATE_DOCUMENT_ELEMENT");
        elementIndex = retainedIndex;
      }
      retainedIndex += 1;
    }
    if (doctypeIndex >= 0 && elementIndex >= 0 && doctypeIndex > elementIndex) {
      fail("TREE_MODEL_DOCTYPE_AFTER_DOCUMENT_ELEMENT");
    }
  }

  #coalescedSpan(current: SourceSpan | null, next: SourceSpan | null): SourceSpan | null {
    if (current === null || next === null || current.endUtf16Offset !== next.startUtf16Offset) {
      return null;
    }
    return sourceSpan(current.startUtf16Offset, next.endUtf16Offset);
  }

  #emit(kind: TreeMutationKind, node: number, parent: number | null): void {
    this.#observer?.onTreeMutation?.(Object.freeze({ kind, node, parent }));
  }
}
