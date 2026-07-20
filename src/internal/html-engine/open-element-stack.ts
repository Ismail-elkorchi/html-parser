import { failInternalState, requireInternalValue } from "../foundation/internal-state-error.js";

import { HTML_NAMESPACE } from "./namespaces.js";

import type { HtmlElementNamespaceUri } from "./namespaces.js";
import type { EngineResourceGuard } from "./resource-guard.js";
import type { HtmlTreeElement } from "./tree-model.js";

export interface OpenElementName {
  readonly namespaceUri: HtmlElementNamespaceUri;
  readonly localName: string;
}

function expandedName(namespaceUri: HtmlElementNamespaceUri, localName: string): string {
  return `${namespaceUri}\u0000${localName}`;
}

/**
 * Ordered open-element stack with constant-time membership and bounded scope lookups.
 * Middle removals are uncommon but preserve the monotonic order labels of remaining entries.
 */
export class OpenElementStack {
  readonly #entries: HtmlTreeElement[] = [];
  readonly #open = new WeakSet<HtmlTreeElement>();
  readonly #order = new WeakMap<HtmlTreeElement, number>();
  readonly #byExpandedName = new Map<string, HtmlTreeElement[]>();
  readonly #checkpoint: () => void;
  #nextOrder = 1;

  constructor(resources?: Pick<EngineResourceGuard, "checkpoint">) {
    this.#checkpoint = resources === undefined ? () => {} : () => { resources.checkpoint(); };
  }

  get length(): number {
    return this.#entries.length;
  }

  at(index: number): HtmlTreeElement | null {
    const normalized = index < 0 ? this.#entries.length + index : index;
    return this.#entries[normalized] ?? null;
  }

  current(): HtmlTreeElement {
    return requireInternalValue(this.#entries.at(-1), "TREE_BUILDER_CURRENT_NODE_MISSING");
  }

  push(element: HtmlTreeElement): void {
    if (this.#open.has(element)) failInternalState("TREE_BUILDER_OPEN_ELEMENT_ALREADY_PRESENT");
    this.#entries.push(element);
    this.#open.add(element);
    this.#order.set(element, this.#nextOrder);
    this.#nextOrder += 1;
    const key = expandedName(element.namespaceUri, element.localName);
    const matches = this.#byExpandedName.get(key);
    if (matches === undefined) this.#byExpandedName.set(key, [element]);
    else matches.push(element);
  }

  pop(): HtmlTreeElement {
    const element = requireInternalValue(
      this.#entries.pop(),
      "TREE_BUILDER_CURRENT_NODE_MISSING"
    );
    this.#removeIndex(element);
    return element;
  }

  includes(element: HtmlTreeElement): boolean {
    return this.#open.has(element);
  }

  indexOf(element: HtmlTreeElement): number {
    if (!this.#open.has(element)) return -1;
    for (let index = this.#entries.length - 1; index >= 0; index -= 1) {
      this.#checkpoint();
      if (this.#entries[index] === element) return index;
    }
    failInternalState("TREE_BUILDER_OPEN_ELEMENT_NOT_PRESENT");
  }

  remove(element: HtmlTreeElement): void {
    if (!this.#open.has(element)) failInternalState("TREE_BUILDER_OPEN_ELEMENT_NOT_PRESENT");
    const index = this.indexOf(element);
    if (index < 0) failInternalState("TREE_BUILDER_OPEN_ELEMENT_NOT_PRESENT");
    this.#entries.splice(index, 1);
    this.#removeIndex(element);
  }

  replace(current: HtmlTreeElement, replacement: HtmlTreeElement): void {
    if (this.#open.has(replacement)) {
      failInternalState("TREE_BUILDER_OPEN_ELEMENT_ALREADY_PRESENT");
    }
    const index = this.indexOf(current);
    if (index < 0) failInternalState("TREE_BUILDER_OPEN_ELEMENT_NOT_PRESENT");
    const order = this.#elementOrder(current);
    this.#entries[index] = replacement;
    this.#removeIndex(current);
    this.#open.add(replacement);
    this.#order.set(replacement, order);
    this.#insertNameIndex(replacement, index);
  }

  insertAfter(reference: HtmlTreeElement, element: HtmlTreeElement): void {
    if (this.#open.has(element)) failInternalState("TREE_BUILDER_OPEN_ELEMENT_ALREADY_PRESENT");
    const referenceIndex = this.indexOf(reference);
    if (referenceIndex < 0) failInternalState("TREE_BUILDER_OPEN_ELEMENT_NOT_PRESENT");
    if (referenceIndex === this.#entries.length - 1) {
      this.push(element);
      return;
    }
    const insertionIndex = referenceIndex + 1;
    this.#entries.splice(insertionIndex, 0, element);
    this.#open.add(element);
    this.#relabel();
    this.#insertNameIndex(element, insertionIndex);
  }

  hasInScope(
    namespaceUri: HtmlElementNamespaceUri,
    localName: string,
    htmlBoundaryNames: ReadonlySet<string>,
    additionalBoundaries: readonly OpenElementName[] = []
  ): boolean {
    const target = this.#lastByName(namespaceUri, localName);
    if (target === null) return false;
    const targetOrder = this.#elementOrder(target);
    let latestBoundaryOrder = -1;
    for (const boundaryName of htmlBoundaryNames) {
      this.#checkpoint();
      const boundary = this.#lastByName(HTML_NAMESPACE, boundaryName);
      if (boundary !== null) latestBoundaryOrder = Math.max(latestBoundaryOrder, this.#elementOrder(boundary));
    }
    latestBoundaryOrder = this.#latestAdditionalBoundaryOrder(
      additionalBoundaries,
      latestBoundaryOrder
    );
    return targetOrder >= latestBoundaryOrder;
  }

  hasElementInScope(
    element: HtmlTreeElement,
    htmlBoundaryNames: ReadonlySet<string>,
    additionalBoundaries: readonly OpenElementName[] = []
  ): boolean {
    if (!this.#open.has(element)) return false;
    const targetOrder = this.#elementOrder(element);
    let latestBoundaryOrder = -1;
    for (const boundaryName of htmlBoundaryNames) {
      this.#checkpoint();
      const boundary = this.#lastByName(HTML_NAMESPACE, boundaryName);
      if (boundary !== null) latestBoundaryOrder = Math.max(latestBoundaryOrder, this.#elementOrder(boundary));
    }
    latestBoundaryOrder = this.#latestAdditionalBoundaryOrder(
      additionalBoundaries,
      latestBoundaryOrder
    );
    return targetOrder >= latestBoundaryOrder;
  }

  lastInScope(
    namespaceUri: HtmlElementNamespaceUri,
    localNames: ReadonlySet<string>,
    htmlBoundaryNames: ReadonlySet<string>,
    additionalBoundaries: readonly OpenElementName[] = []
  ): HtmlTreeElement | null {
    let target: HtmlTreeElement | null = null;
    let targetOrder = -1;
    for (const localName of localNames) {
      const candidate = this.#lastByName(namespaceUri, localName);
      if (candidate === null) continue;
      const order = this.#elementOrder(candidate);
      if (order > targetOrder) {
        target = candidate;
        targetOrder = order;
      }
    }
    if (target === null) return null;
    let latestBoundaryOrder = -1;
    for (const boundaryName of htmlBoundaryNames) {
      this.#checkpoint();
      const boundary = this.#lastByName(HTML_NAMESPACE, boundaryName);
      if (boundary !== null) latestBoundaryOrder = Math.max(latestBoundaryOrder, this.#elementOrder(boundary));
    }
    latestBoundaryOrder = this.#latestAdditionalBoundaryOrder(
      additionalBoundaries,
      latestBoundaryOrder
    );
    return targetOrder >= latestBoundaryOrder ? target : null;
  }

  some(predicate: (element: HtmlTreeElement) => boolean): boolean {
    for (const element of this.#entries) {
      this.#checkpoint();
      if (predicate(element)) return true;
    }
    return false;
  }

  #lastByName(namespaceUri: HtmlElementNamespaceUri, localName: string): HtmlTreeElement | null {
    return this.#byExpandedName.get(expandedName(namespaceUri, localName))?.at(-1) ?? null;
  }

  #latestAdditionalBoundaryOrder(
    boundaries: readonly OpenElementName[],
    initialOrder: number
  ): number {
    let order = initialOrder;
    for (const boundaryName of boundaries) {
      this.#checkpoint();
      const boundary = this.#lastByName(boundaryName.namespaceUri, boundaryName.localName);
      if (boundary !== null) order = Math.max(order, this.#elementOrder(boundary));
    }
    return order;
  }

  #elementOrder(element: HtmlTreeElement): number {
    return requireInternalValue(this.#order.get(element), "TREE_BUILDER_OPEN_ELEMENT_NOT_PRESENT");
  }

  #removeIndex(element: HtmlTreeElement): void {
    this.#open.delete(element);
    this.#order.delete(element);
    const key = expandedName(element.namespaceUri, element.localName);
    const matches = this.#byExpandedName.get(key);
    if (matches === undefined) failInternalState("TREE_BUILDER_OPEN_ELEMENT_NOT_PRESENT");
    const index = matches.lastIndexOf(element);
    if (index < 0) failInternalState("TREE_BUILDER_OPEN_ELEMENT_NOT_PRESENT");
    matches.splice(index, 1);
    if (matches.length === 0) this.#byExpandedName.delete(key);
  }

  #insertNameIndex(element: HtmlTreeElement, stackIndex: number): void {
    const key = expandedName(element.namespaceUri, element.localName);
    const matches = this.#byExpandedName.get(key);
    if (matches === undefined) {
      this.#byExpandedName.set(key, [element]);
      return;
    }
    let matchingBefore = 0;
    for (let index = 0; index < stackIndex; index += 1) {
      this.#checkpoint();
      const candidate = this.#entries[index];
      if (
        candidate?.namespaceUri === element.namespaceUri &&
        candidate.localName === element.localName
      ) {
        matchingBefore += 1;
      }
    }
    matches.splice(matchingBefore, 0, element);
  }

  #relabel(): void {
    for (let index = 0; index < this.#entries.length; index += 1) {
      this.#checkpoint();
      const entry = this.#entries[index];
      if (entry !== undefined) this.#order.set(entry, index + 1);
    }
    this.#nextOrder = this.#entries.length + 1;
  }
}
