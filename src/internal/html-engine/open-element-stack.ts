import { failInternalState, requireInternalValue } from "../foundation/internal-state-error.js";

import type { HtmlElementNamespaceUri } from "./namespaces.js";
import type { HtmlTreeElement } from "./tree-model.js";

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
  #nextOrder = 1;

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

  remove(element: HtmlTreeElement): void {
    if (!this.#open.has(element)) failInternalState("TREE_BUILDER_OPEN_ELEMENT_NOT_PRESENT");
    const index = this.#entries.lastIndexOf(element);
    if (index < 0) failInternalState("TREE_BUILDER_OPEN_ELEMENT_NOT_PRESENT");
    this.#entries.splice(index, 1);
    this.#removeIndex(element);
  }

  hasInScope(
    namespaceUri: HtmlElementNamespaceUri,
    localName: string,
    htmlBoundaryNames: ReadonlySet<string>
  ): boolean {
    const target = this.#lastByName(namespaceUri, localName);
    if (target === null) return false;
    const targetOrder = this.#elementOrder(target);
    let latestBoundaryOrder = -1;
    for (const boundaryName of htmlBoundaryNames) {
      const boundary = this.#lastByName(namespaceUri, boundaryName);
      if (boundary !== null) latestBoundaryOrder = Math.max(latestBoundaryOrder, this.#elementOrder(boundary));
    }
    return targetOrder >= latestBoundaryOrder;
  }

  lastInScope(
    namespaceUri: HtmlElementNamespaceUri,
    localNames: ReadonlySet<string>,
    htmlBoundaryNames: ReadonlySet<string>
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
      const boundary = this.#lastByName(namespaceUri, boundaryName);
      if (boundary !== null) latestBoundaryOrder = Math.max(latestBoundaryOrder, this.#elementOrder(boundary));
    }
    return targetOrder >= latestBoundaryOrder ? target : null;
  }

  some(predicate: (element: HtmlTreeElement) => boolean): boolean {
    return this.#entries.some(predicate);
  }

  #lastByName(namespaceUri: HtmlElementNamespaceUri, localName: string): HtmlTreeElement | null {
    return this.#byExpandedName.get(expandedName(namespaceUri, localName))?.at(-1) ?? null;
  }

  #elementOrder(element: HtmlTreeElement): number {
    return requireInternalValue(this.#order.get(element), "TREE_BUILDER_OPEN_ELEMENT_NOT_PRESENT");
  }

  #removeIndex(element: HtmlTreeElement): void {
    this.#open.delete(element);
    const key = expandedName(element.namespaceUri, element.localName);
    const matches = this.#byExpandedName.get(key);
    if (matches === undefined) failInternalState("TREE_BUILDER_OPEN_ELEMENT_NOT_PRESENT");
    const index = matches.lastIndexOf(element);
    if (index < 0) failInternalState("TREE_BUILDER_OPEN_ELEMENT_NOT_PRESENT");
    matches.splice(index, 1);
    if (matches.length === 0) this.#byExpandedName.delete(key);
  }
}
