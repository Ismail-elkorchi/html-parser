import { failInternalState } from "../foundation/internal-state-error.ts";

import {
  HTML_NAMESPACE,
  XLINK_NAMESPACE,
  XML_NAMESPACE,
  XMLNS_NAMESPACE
} from "./namespaces.ts";
import { sourceSpan } from "./positions.ts";

import type {
  HtmlAttributeNamespaceUri,
  HtmlElementNamespaceUri
} from "./namespaces.ts";
import type { EngineObserver, TreeMutationKind } from "./observer.ts";
import type { SourceSpan } from "./positions.ts";
import type { EngineResourceGuard } from "./resource-guard.ts";
import type { InternalStateErrorReason } from "../foundation/internal-state-error.ts";

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
  readonly identity: HtmlTreeNodeIdentity;
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

const MODEL_OWNER = Symbol("html-tree-model-owner");
const NODE_STATE = Symbol("html-tree-node-state");
const PARENT_STATE = Symbol("html-tree-parent-state");
const ELEMENT_STATE = Symbol("html-tree-element-state");
const TEXT_STATE = Symbol("html-tree-text-state");

interface ModelOwnedObject {
  readonly [MODEL_OWNER]?: HtmlTreeModel;
  readonly [NODE_STATE]?: NodeState;
  readonly [PARENT_STATE]?: ParentState;
  readonly [ELEMENT_STATE]?: ElementState;
  readonly [TEXT_STATE]?: TextState;
}

function modelOwner(value: object): HtmlTreeModel | undefined {
  return (value as ModelOwnedObject)[MODEL_OWNER];
}

class TreeElementNode implements HtmlTreeElement, HtmlTreeNodeIdentity {
  readonly kind = "element";
  readonly identity: HtmlTreeNodeIdentity = this;
  readonly [MODEL_OWNER]: HtmlTreeModel;
  readonly [NODE_STATE]: NodeState;
  readonly [PARENT_STATE]: ParentState;
  readonly [ELEMENT_STATE]: ElementState;

  constructor(
    owner: HtmlTreeModel,
    readonly serial: number,
    readonly namespaceUri: HtmlElementNamespaceUri,
    readonly prefix: string | null,
    readonly localName: string,
    readonly qualifiedName: string,
    nodeState: NodeState,
    parentState: ParentState,
    elementState: ElementState
  ) {
    this[MODEL_OWNER] = owner;
    this[NODE_STATE] = nodeState;
    this[PARENT_STATE] = parentState;
    this[ELEMENT_STATE] = elementState;
    Object.freeze(this);
  }

  get parent(): HtmlTreeParent | null { return this[NODE_STATE].parent; }
  get sourceSpan(): SourceSpan | null { return this[NODE_STATE].sourceSpan; }
  get childCount(): number { return this[PARENT_STATE].children.length; }
  childAt(index: number): HtmlTreeNode | null { return this[PARENT_STATE].children[index] ?? null; }
  get attributeCount(): number { return this[ELEMENT_STATE].attributes.length; }
  attributeAt(index: number): HtmlTreeAttribute | null {
    return this[ELEMENT_STATE].attributes[index] ?? null;
  }
  get templateContents(): HtmlTemplateContents | null {
    return this[ELEMENT_STATE].templateContents;
  }
}

class TreeTemplateContentsNode implements HtmlTemplateContents, HtmlTreeNodeIdentity {
  readonly kind = "template-contents";
  readonly identity: HtmlTreeNodeIdentity = this;
  readonly [MODEL_OWNER]: HtmlTreeModel;
  readonly [PARENT_STATE]: ParentState;

  constructor(
    owner: HtmlTreeModel,
    readonly serial: number,
    readonly host: HtmlTreeElement,
    parentState: ParentState
  ) {
    this[MODEL_OWNER] = owner;
    this[PARENT_STATE] = parentState;
    Object.freeze(this);
  }

  get childCount(): number { return this[PARENT_STATE].children.length; }
  childAt(index: number): HtmlTreeNode | null { return this[PARENT_STATE].children[index] ?? null; }
}

class TreeTextNode implements HtmlTreeText, HtmlTreeNodeIdentity {
  readonly kind = "text";
  readonly identity: HtmlTreeNodeIdentity = this;
  readonly [MODEL_OWNER]: HtmlTreeModel;
  readonly [NODE_STATE]: NodeState;
  readonly [TEXT_STATE]: TextState;

  constructor(
    owner: HtmlTreeModel,
    readonly serial: number,
    nodeState: NodeState,
    textState: TextState
  ) {
    this[MODEL_OWNER] = owner;
    this[NODE_STATE] = nodeState;
    this[TEXT_STATE] = textState;
    Object.freeze(this);
  }

  get parent(): HtmlTreeParent | null { return this[NODE_STATE].parent; }
  get sourceSpan(): SourceSpan | null { return this[NODE_STATE].sourceSpan; }
  get data(): string { return this[TEXT_STATE].data; }
}

class TreeRootNode<Kind extends "document" | "fragment"> {
  readonly identity: HtmlTreeNodeIdentity = this;
  readonly [MODEL_OWNER]: HtmlTreeModel;
  readonly [PARENT_STATE]: ParentState;

  constructor(
    readonly kind: Kind,
    readonly serial: number,
    owner: HtmlTreeModel,
    parentState: ParentState
  ) {
    this[MODEL_OWNER] = owner;
    this[PARENT_STATE] = parentState;
    Object.freeze(this);
  }

  get childCount(): number { return this[PARENT_STATE].children.length; }
  childAt(index: number): HtmlTreeNode | null {
    return this[PARENT_STATE].children[index] ?? null;
  }
}

function fail(reason: HtmlTreeModelErrorReason): never {
  return failInternalState(reason);
}

function checkedSpan(span: SourceSpan | null | undefined): SourceSpan | null {
  if (span === null || span === undefined) return null;
  validateSpan(span);
  return Object.isFrozen(span)
    ? span
    : sourceSpan(span.startUtf16Offset, span.endUtf16Offset);
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
  if (
    (prefix === null && qualifiedName !== localName) ||
    (prefix !== null && qualifiedName !== `${prefix}:${localName}`)
  ) {
    fail("TREE_MODEL_INVALID_QUALIFIED_NAME");
  }
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
  let expandedNames: Set<string> | undefined;
  for (const attribute of attributes) {
    validateName(attribute.localName, attribute.prefix, attribute.qualifiedName);
    validateAttributeNamespace(attribute);
    if (attribute.sourceSpan !== null && attribute.sourceSpan !== undefined) {
      validateSpan(attribute.sourceSpan);
    }
    if (attributes.length > 1) {
      expandedNames ??= new Set<string>();
      const key = attributeKey(attribute);
      if (expandedNames.has(key)) fail("TREE_MODEL_DUPLICATE_ATTRIBUTE");
      expandedNames.add(key);
    }
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
  #nextSerial = 1;

  constructor(options: HtmlTreeModelOptions) {
    this.#resources = options.resources;
    this.#observer = options.observer;
    this.#resources.reserveNodeAtDepth(1);

    const serial = this.#newSerial();
    const parentState: ParentState = { owner: this, children: [] };
    if (options.rootKind === "document") {
      const root: HtmlTreeDocument = new TreeRootNode("document", serial, this, parentState);
      this.root = root;
    } else {
      const root: HtmlTreeFragment = new TreeRootNode("fragment", serial, this, parentState);
      this.root = root;
    }
    this.#emit("node-created", serial, null);
  }

  createElement(input: HtmlTreeElementInput): HtmlTreeElement {
    validateName(input.localName, input.prefix, input.qualifiedName);
    const attributes = input.attributes ?? [];
    validateAttributeInputs(attributes);
    this.#resources.checkElementAttributes(attributes);
    const span = checkedSpan(input.sourceSpan);
    const ownsTemplateContents =
      input.namespaceUri === HTML_NAMESPACE && input.localName === "template";
    this.#resources.reserveNodes(ownsTemplateContents ? 2 : 1);

    const serial = this.#newSerial();
    const elementState: NodeState & ParentState & ElementState = {
      owner: this,
      parent: null,
      sourceSpan: span,
      depth: null,
      children: [],
      attributes: attributes.map(copyAttribute),
      templateContents: null
    };
    let templateContents: HtmlTemplateContents | null = null;
    const element: HtmlTreeElement = new TreeElementNode(
      this,
      serial,
      input.namespaceUri,
      input.prefix,
      input.localName,
      input.qualifiedName,
      elementState,
      elementState,
      elementState
    );

    if (ownsTemplateContents) {
      const contentsSerial = this.#newSerial();
      const templateState: ParentState = { owner: this, children: [] };
      templateContents = new TreeTemplateContentsNode(
        this,
        contentsSerial,
        element,
        templateState
      );
      this.#emit("node-created", contentsSerial, null);
    }

    elementState.templateContents = templateContents;
    this.#emit("node-created", serial, null);
    return element;
  }

  createText(data: string, span: SourceSpan | null = null): HtmlTreeText {
    if (data.length === 0) fail("TREE_MODEL_EMPTY_TEXT_DATA");
    const source = checkedSpan(span);
    this.#resources.reserveNode();
    const serial = this.#newSerial();
    const state: NodeState & TextState = {
      owner: this,
      parent: null,
      sourceSpan: source,
      depth: null,
      data
    };
    const text: HtmlTreeText = new TreeTextNode(this, serial, state, state);
    this.#emit("node-created", serial, null);
    return text;
  }

  createComment(data: string, span: SourceSpan | null = null): HtmlTreeComment {
    const source = checkedSpan(span);
    this.#resources.reserveNode();
    const identity = this.#newIdentity();
    const nodeState: NodeState = { owner: this, parent: null, sourceSpan: source, depth: null };
    const comment: HtmlTreeComment = Object.freeze({
      [MODEL_OWNER]: this,
      [NODE_STATE]: nodeState,
      kind: "comment",
      identity,
      data,
      get parent(): HtmlTreeParent | null { return nodeState.parent; },
      get sourceSpan(): SourceSpan | null { return nodeState.sourceSpan; }
    });
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
      [MODEL_OWNER]: this,
      [NODE_STATE]: nodeState,
      kind: "processing-instruction",
      identity,
      target,
      data,
      get parent(): HtmlTreeParent | null { return nodeState.parent; },
      get sourceSpan(): SourceSpan | null { return nodeState.sourceSpan; }
    });
    this.#emit("node-created", identity.serial, null);
    return instruction;
  }

  createDoctype(input: HtmlTreeDoctypeInput): HtmlTreeDoctype {
    const span = checkedSpan(input.sourceSpan);
    this.#resources.reserveNode();
    const identity = this.#newIdentity();
    const nodeState: NodeState = { owner: this, parent: null, sourceSpan: span, depth: null };
    const doctype: HtmlTreeDoctype = Object.freeze({
      [MODEL_OWNER]: this,
      [NODE_STATE]: nodeState,
      kind: "doctype",
      identity,
      name: input.name,
      externalId: copyExternalId(input.externalId),
      get parent(): HtmlTreeParent | null { return nodeState.parent; },
      get sourceSpan(): SourceSpan | null { return nodeState.sourceSpan; }
    });
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
    const detachedLeaf = oldParent === null && this.#semanticChildren(node).length === 0;
    if (node === target || (!detachedLeaf && this.#subtreeContainsParent(node, target))) {
      fail("TREE_MODEL_ANCESTOR_CYCLE");
    }
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
    let depthAssignments: SubtreeDepthAssignment[] | null = null;
    if (detachedLeaf) {
      if (parentDepth === null) {
        this.#resources.checkpoint();
      } else {
        const relativeDepth = this.#hasTemplateContents(node) ? 2 : 1;
        this.#resources.observeDepth(parentDepth + relativeDepth);
      }
    } else {
      const prepared = this.#prepareSubtreeDepths(
        node,
        parentDepth === null ? null : parentDepth + 1
      );
      depthAssignments = prepared.assignments;
      if (parentDepth !== null) {
        this.#resources.observeDepth(parentDepth + prepared.maxRelativeDepth);
        this.#authorizeDepthApplication(prepared.assignments);
      } else {
        this.#resources.checkpoint();
      }
    }

    const oldParentSerial = oldParent === null ? null : this.#observableParentSerial(oldParent);
    if (oldParent !== null) {
      const oldState = this.#parentState(oldParent);
      const oldIndex = oldState.children.indexOf(node);
      if (oldIndex < 0) fail("TREE_MODEL_REFERENCE_NOT_CHILD");
      oldState.children.splice(oldIndex, 1);
    }
    if (insertionIndex === targetState.children.length) targetState.children.push(node);
    else targetState.children.splice(insertionIndex, 0, node);
    nodeState.parent = target;
    if (depthAssignments === null) nodeState.depth = parentDepth === null ? null : parentDepth + 1;
    else this.#applySubtreeDepths(depthAssignments);

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

  /** Replaces semantic children with deep, spanless clones in one structural commit. */
  replaceChildrenWithClones(source: HtmlTreeElement, destination: HtmlTreeElement): number {
    this.#elementState(source);
    this.#elementState(destination);
    const sourceChildren = [...this.#semanticChildren(source)];
    const clones = sourceChildren.map((child) => this.#cloneSubtree(child));
    this.#replaceChildren(destination, clones);
    return clones.length;
  }

  /** Removes every semantic child in one structural commit. */
  clearChildren(parent: HtmlTreeElement): number {
    this.#elementState(parent);
    const count = this.#semanticChildren(parent).length;
    this.#replaceChildren(parent, []);
    return count;
  }

  adoptAttributes(element: HtmlTreeElement, attributes: readonly HtmlTreeAttributeInput[]): number {
    const state = this.#elementState(element);
    validateAttributeInputs(attributes);
    const present = new Set(state.attributes.map(attributeKey));
    const adopted: HtmlTreeAttributeInput[] = [];
    for (const attribute of attributes) {
      this.#resources.checkpoint();
      const key = attributeKey(attribute);
      if (present.has(key)) continue;
      adopted.push(attribute);
      present.add(key);
    }
    if (adopted.length === 0) return 0;
    this.#resources.checkElementAttributes([...state.attributes, ...adopted]);
    state.attributes.push(...adopted.map(copyAttribute));
    if (adopted.length > 0) {
      const parent = this.#nodeState(element).parent;
      this.#emit(
        "attributes-adopted",
        element.identity.serial,
        parent === null ? null : this.#observableParentSerial(parent)
      );
    }
    return adopted.length;
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
      const ownedPrevious = previous as HtmlTreeText & ModelOwnedObject;
      const textState = ownedPrevious[TEXT_STATE];
      const nodeState = ownedPrevious[NODE_STATE];
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

  /** Returns the model-owned child sequence as a read-only hot-path view. */
  childrenOf(parent: HtmlTreeParent): readonly HtmlTreeNode[] {
    return this.#parentState(parent).children;
  }

  /** Returns the model-owned attribute sequence as a read-only hot-path view. */
  attributesOf(element: HtmlTreeElement): readonly HtmlTreeAttribute[] {
    return this.#elementState(element).attributes;
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
      const descendantDepth = entry.depth + (this.#hasTemplateContents(entry.node) ? 2 : 1);
      for (let index = descendants.length - 1; index >= 0; index -= 1) {
        const child = descendants[index];
        if (child !== undefined) stack.push({ node: child, depth: descendantDepth });
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
          if (element.templateContents !== null) {
            if (visited.has(element.templateContents.identity.serial)) {
              fail("TREE_MODEL_ANCESTOR_CYCLE");
            }
            visited.add(element.templateContents.identity.serial);
            attachedNodes += 1;
            maxDepth = Math.max(maxDepth, entry.depth + 2);
          }
          stack.push({
            parent: childParent,
            depth: entry.depth + (element.templateContents === null ? 1 : 2)
          });
        }
      }
    }

    return Object.freeze({
      allocatedNodes: this.#nextSerial - 1,
      attachedNodes,
      maxDepth
    });
  }

  #newIdentity(): HtmlTreeNodeIdentity {
    return Object.freeze({ serial: this.#newSerial() });
  }

  #newSerial(): number {
    const serial = this.#nextSerial;
    this.#nextSerial += 1;
    return serial;
  }

  #cloneSubtree(source: HtmlTreeNode): HtmlTreeNode {
    const root = this.#cloneNode(source);
    const stack: Array<{
      readonly source: HtmlTreeElement;
      readonly clone: HtmlTreeElement;
    }> = [];
    if (source.kind === "element" && root.kind === "element") {
      stack.push({ source, clone: root });
    }
    while (stack.length > 0) {
      this.#resources.checkpoint();
      const pair = stack.pop();
      if (pair === undefined) break;
      const childPairs: Array<{
        readonly source: HtmlTreeElement;
        readonly clone: HtmlTreeElement;
      }> = [];
      for (const sourceChild of this.#semanticChildren(pair.source)) {
        const childClone = this.#cloneNode(sourceChild);
        this.append(this.insertionParent(pair.clone), childClone);
        if (sourceChild.kind === "element" && childClone.kind === "element") {
          childPairs.push({ source: sourceChild, clone: childClone });
        }
      }
      for (let index = childPairs.length - 1; index >= 0; index -= 1) {
        const childPair = childPairs[index];
        if (childPair !== undefined) stack.push(childPair);
      }
    }
    return root;
  }

  #cloneNode(source: HtmlTreeNode): HtmlTreeNode {
    switch (source.kind) {
      case "element": {
        const state = this.#elementState(source);
        return this.createElement({
          namespaceUri: source.namespaceUri,
          prefix: source.prefix,
          localName: source.localName,
          qualifiedName: source.qualifiedName,
          attributes: state.attributes.map((attribute) => ({
            namespaceUri: attribute.namespaceUri,
            prefix: attribute.prefix,
            localName: attribute.localName,
            qualifiedName: attribute.qualifiedName,
            value: attribute.value,
            sourceSpan: null
          })),
          sourceSpan: null
        });
      }
      case "text": return this.createText(source.data, null);
      case "comment": return this.createComment(source.data, null);
      case "processing-instruction": {
        return this.createProcessingInstruction(source.target, source.data, null);
      }
      case "doctype": return fail("TREE_MODEL_DOCTYPE_UNDER_NON_DOCUMENT");
    }
  }

  #replaceChildren(parent: HtmlTreeElement, replacements: readonly HtmlTreeNode[]): void {
    const target = this.insertionParent(parent);
    const targetState = this.#parentState(target);
    const previous = [...targetState.children];
    const previousDepths = previous.map((child) => this.#prepareSubtreeDepths(child, null));
    const parentDepth = this.#parentDepth(target);
    const replacementDepths = replacements.map((child) => {
      const state = this.#nodeState(child);
      if (state.parent !== null) fail("TREE_MODEL_REFERENCE_NOT_CHILD");
      if (child.kind === "doctype") fail("TREE_MODEL_DOCTYPE_UNDER_NON_DOCUMENT");
      const depths = this.#prepareSubtreeDepths(
        child,
        parentDepth === null ? null : parentDepth + 1
      );
      if (parentDepth !== null) {
        this.#resources.observeDepth(parentDepth + depths.maxRelativeDepth);
      }
      return depths;
    });
    for (const depths of previousDepths) this.#authorizeDepthApplication(depths.assignments);
    for (const depths of replacementDepths) this.#authorizeDepthApplication(depths.assignments);

    targetState.children.length = 0;
    for (let index = 0; index < previous.length; index += 1) {
      const child = previous[index];
      const depths = previousDepths[index];
      if (child === undefined || depths === undefined) fail("TREE_MODEL_REFERENCE_NOT_CHILD");
      this.#nodeState(child).parent = null;
      this.#applySubtreeDepths(depths.assignments);
    }
    for (let index = 0; index < replacements.length; index += 1) {
      const child = replacements[index];
      const depths = replacementDepths[index];
      if (child === undefined || depths === undefined) fail("TREE_MODEL_REFERENCE_NOT_CHILD");
      this.#nodeState(child).parent = target;
      targetState.children.push(child);
      this.#applySubtreeDepths(depths.assignments);
    }

    const parentSerial = this.#observableParentSerial(target);
    for (const child of previous) this.#emit("node-detached", child.identity.serial, parentSerial);
    for (const child of replacements) this.#emit("node-inserted", child.identity.serial, parentSerial);
  }

  #nodeState(node: HtmlTreeNode): NodeState {
    const state = (node as HtmlTreeNode & ModelOwnedObject)[NODE_STATE];
    if (state === undefined) {
      if (modelOwner(node) !== undefined) fail("TREE_MODEL_FOREIGN_NODE");
      fail("TREE_MODEL_UNKNOWN_NODE");
    }
    if (state.owner !== this) fail("TREE_MODEL_FOREIGN_NODE");
    return state;
  }

  #parentState(parent: HtmlTreeParent): ParentState {
    const state = (parent as HtmlTreeParent & ModelOwnedObject)[PARENT_STATE];
    if (state === undefined) {
      if (modelOwner(parent) !== undefined) fail("TREE_MODEL_FOREIGN_PARENT");
      fail("TREE_MODEL_UNKNOWN_PARENT");
    }
    if (state.owner !== this) fail("TREE_MODEL_FOREIGN_PARENT");
    return state;
  }

  #elementState(element: HtmlTreeElement): ElementState {
    this.#nodeState(element);
    const state = (element as HtmlTreeElement & ModelOwnedObject)[ELEMENT_STATE];
    if (state === undefined) fail("TREE_MODEL_UNKNOWN_NODE");
    return state;
  }

  #observableParentSerial(parent: HtmlTreeParent): number {
    return parent.identity.serial;
  }

  #parentDepth(parent: HtmlTreeParent): number | null {
    if (isRoot(parent)) return 1;
    if (parent.kind === "template-contents") {
      const hostDepth = this.#nodeState(parent.host).depth;
      return hostDepth === null ? null : hostDepth + 1;
    }
    return this.#nodeState(parent).depth;
  }

  #hasTemplateContents(node: HtmlTreeNode): boolean {
    return node.kind === "element" && this.#elementState(node).templateContents !== null;
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
      const hasTemplateContents = this.#hasTemplateContents(entry.node);
      maxRelativeDepth = Math.max(
        maxRelativeDepth,
        entry.relativeDepth + (hasTemplateContents ? 1 : 0)
      );
      const childDepth = entry.depth === null
        ? null
        : entry.depth + (hasTemplateContents ? 2 : 1);
      for (const child of this.#semanticChildren(entry.node)) {
        stack.push({
          node: child,
          depth: childDepth,
          relativeDepth: entry.relativeDepth + (hasTemplateContents ? 2 : 1)
        });
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
