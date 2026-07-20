import { failInternalState } from "../foundation/internal-state-error.ts";

import type { EngineResourceGuard } from "./resource-guard.ts";
import type { HtmlStartTagToken } from "./tokens.ts";
import type { HtmlTreeElement } from "./tree-model.ts";

interface ActiveFormattingElementEntry {
  readonly kind: "element";
  readonly element: HtmlTreeElement;
  readonly token: HtmlStartTagToken;
}

interface ActiveFormattingMarker {
  readonly kind: "marker";
}

export type ActiveFormattingEntry = ActiveFormattingElementEntry | ActiveFormattingMarker;

interface FormattingNode {
  value: ActiveFormattingEntry;
  previous: FormattingNode | null;
  next: FormattingNode | null;
  subjectPrevious: FormattingNode | null;
  subjectNext: FormattingNode | null;
  readonly previousGeneration: number | null;
  readonly subjectKey: string | null;
  readonly familyKey: string | null;
}

interface SubjectBucket {
  first: FormattingNode;
  last: FormattingNode;
}

function formattingEntry(element: HtmlTreeElement, token: HtmlStartTagToken): ActiveFormattingElementEntry {
  return Object.freeze({ kind: "element", element, token });
}

function markerEntry(): ActiveFormattingMarker {
  return Object.freeze({ kind: "marker" });
}

/** Marker-delimited creation history used by formatting reconstruction and adoption. */
export class ActiveFormattingList {
  readonly #resources: EngineResourceGuard;
  readonly #nodeByEntry = new WeakMap<ActiveFormattingEntry, FormattingNode>();
  readonly #nodeByElement = new WeakMap<HtmlTreeElement, FormattingNode>();
  readonly #bySubject = new Map<string, SubjectBucket>();
  readonly #byFamily = new Map<string, FormattingNode[]>();
  #last: FormattingNode | null = null;
  #length = 0;
  #generation = 0;
  #nextGeneration = 1;

  constructor(resources: EngineResourceGuard) {
    this.#resources = resources;
  }

  get length(): number {
    return this.#length;
  }

  last(): ActiveFormattingEntry | null {
    return this.#last?.value ?? null;
  }

  previous(entry: ActiveFormattingEntry): ActiveFormattingEntry | null {
    return this.#node(entry).previous?.value ?? null;
  }

  next(entry: ActiveFormattingEntry): ActiveFormattingEntry | null {
    return this.#node(entry).next?.value ?? null;
  }

  pushMarker(): ActiveFormattingMarker {
    this.#resources.checkpoint();
    const value = markerEntry();
    const node = this.#createNode(value, this.#generation, null, null);
    this.#generation = this.#nextGeneration;
    this.#nextGeneration += 1;
    this.#appendNode(node);
    return value;
  }

  pushElement(element: HtmlTreeElement, token: HtmlStartTagToken): ActiveFormattingElementEntry {
    this.#resources.checkpoint();
    const family = this.#familyFor(element);
    const subjectKey = this.#subjectKey(element);
    const familyKey = `${String(this.#generation)}\u0000${family}`;
    const familyBucket = this.#byFamily.get(familyKey);
    if (familyBucket !== undefined && familyBucket.length >= 3) {
      const earliest = familyBucket[0];
      if (earliest === undefined) failInternalState("TREE_BUILDER_FORMATTING_ENTRY_MISSING");
      this.#removeNode(earliest);
    }

    const value = formattingEntry(element, token);
    const node = this.#createNode(value, null, subjectKey, familyKey);
    this.#appendNode(node);
    this.#appendIndexes(node);
    return value;
  }

  insertElementBefore(
    reference: ActiveFormattingEntry | null,
    element: HtmlTreeElement,
    token: HtmlStartTagToken
  ): ActiveFormattingElementEntry {
    this.#resources.checkpoint();
    const before = reference === null ? null : this.#node(reference);
    const value = formattingEntry(element, token);
    const node = this.#createNode(
      value,
      null,
      this.#subjectKey(element),
      `${String(this.#generation)}\u0000${this.#familyFor(element)}`
    );
    this.#insertNodeBefore(node, before);
    this.#insertIndexes(node);
    return value;
  }

  includesElement(element: HtmlTreeElement): boolean {
    return this.#nodeByElement.has(element);
  }

  lastElementWithTagName(localName: string): ActiveFormattingElementEntry | null {
    const key = `${String(this.#generation)}\u0000${localName}`;
    const value = this.#bySubject.get(key)?.last.value ?? null;
    return value?.kind === "element" ? value : null;
  }

  entryForElement(element: HtmlTreeElement): ActiveFormattingElementEntry | null {
    const value = this.#nodeByElement.get(element)?.value ?? null;
    return value?.kind === "element" ? value : null;
  }

  replace(
    entry: ActiveFormattingElementEntry,
    element: HtmlTreeElement
  ): ActiveFormattingElementEntry {
    this.#resources.checkpoint();
    const node = this.#node(entry);
    if (node.value.kind !== "element") failInternalState("TREE_BUILDER_FORMATTING_ENTRY_MISSING");
    this.#nodeByEntry.delete(entry);
    this.#nodeByElement.delete(entry.element);
    const replacement = formattingEntry(element, entry.token);
    node.value = replacement;
    this.#nodeByEntry.set(replacement, node);
    this.#nodeByElement.set(element, node);
    return replacement;
  }

  remove(entry: ActiveFormattingElementEntry): void {
    this.#removeNode(this.#node(entry));
  }

  removeElement(element: HtmlTreeElement): boolean {
    const node = this.#nodeByElement.get(element);
    if (node === undefined) return false;
    this.#removeNode(node);
    return true;
  }

  clearToMarker(): void {
    while (this.#last !== null) {
      const node = this.#last;
      const isMarker = node.value.kind === "marker";
      const previousGeneration = node.previousGeneration;
      this.#removeNode(node);
      if (isMarker) {
        if (previousGeneration === null) {
          failInternalState("TREE_BUILDER_FORMATTING_ENTRY_MISSING");
        }
        this.#generation = previousGeneration;
        return;
      }
    }
  }

  #createNode(
    value: ActiveFormattingEntry,
    previousGeneration: number | null,
    subjectKey: string | null,
    familyKey: string | null
  ): FormattingNode {
    const node: FormattingNode = {
      value,
      previous: null,
      next: null,
      subjectPrevious: null,
      subjectNext: null,
      previousGeneration,
      subjectKey,
      familyKey
    };
    this.#nodeByEntry.set(value, node);
    if (value.kind === "element") this.#nodeByElement.set(value.element, node);
    return node;
  }

  #appendNode(node: FormattingNode): void {
    node.previous = this.#last;
    if (this.#last !== null) this.#last.next = node;
    this.#last = node;
    this.#length += 1;
  }

  #insertNodeBefore(node: FormattingNode, before: FormattingNode | null): void {
    if (before === null) {
      this.#appendNode(node);
      return;
    }
    node.previous = before.previous;
    node.next = before;
    if (before.previous !== null) before.previous.next = node;
    before.previous = node;
    this.#length += 1;
  }

  #appendIndexes(node: FormattingNode): void {
    if (node.subjectKey === null || node.familyKey === null) {
      failInternalState("TREE_BUILDER_FORMATTING_ENTRY_MISSING");
    }
    const subject = this.#bySubject.get(node.subjectKey);
    if (subject === undefined) this.#bySubject.set(node.subjectKey, { first: node, last: node });
    else {
      node.subjectPrevious = subject.last;
      subject.last.subjectNext = node;
      subject.last = node;
    }
    const family = this.#byFamily.get(node.familyKey);
    if (family === undefined) this.#byFamily.set(node.familyKey, [node]);
    else family.push(node);
  }

  #insertIndexes(node: FormattingNode): void {
    if (node.subjectKey === null || node.familyKey === null) {
      failInternalState("TREE_BUILDER_FORMATTING_ENTRY_MISSING");
    }
    let previousSubject: FormattingNode | null = null;
    let previousFamily: FormattingNode | null = null;
    for (let candidate = node.previous; candidate !== null; candidate = candidate.previous) {
      this.#resources.checkpoint();
      if (previousSubject === null && candidate.subjectKey === node.subjectKey) previousSubject = candidate;
      if (previousFamily === null && candidate.familyKey === node.familyKey) previousFamily = candidate;
      if (previousSubject !== null && previousFamily !== null) break;
    }

    const subject = this.#bySubject.get(node.subjectKey);
    if (subject === undefined) {
      this.#bySubject.set(node.subjectKey, { first: node, last: node });
    } else if (previousSubject === null) {
      node.subjectNext = subject.first;
      subject.first.subjectPrevious = node;
      subject.first = node;
    } else {
      node.subjectPrevious = previousSubject;
      node.subjectNext = previousSubject.subjectNext;
      if (previousSubject.subjectNext === null) subject.last = node;
      else previousSubject.subjectNext.subjectPrevious = node;
      previousSubject.subjectNext = node;
    }

    const family = this.#byFamily.get(node.familyKey);
    if (family === undefined) {
      this.#byFamily.set(node.familyKey, [node]);
    } else if (previousFamily === null) {
      family.unshift(node);
    } else {
      const index = family.indexOf(previousFamily);
      if (index < 0) failInternalState("TREE_BUILDER_FORMATTING_ENTRY_MISSING");
      family.splice(index + 1, 0, node);
    }
  }

  #removeNode(node: FormattingNode): void {
    this.#resources.checkpoint();
    if (node.previous !== null) node.previous.next = node.next;
    if (node.next === null) this.#last = node.previous;
    else node.next.previous = node.previous;
    this.#length -= 1;

    const value = node.value;
    this.#nodeByEntry.delete(value);
    if (value.kind === "element") {
      this.#nodeByElement.delete(value.element);
      if (node.subjectKey === null || node.familyKey === null) {
        failInternalState("TREE_BUILDER_FORMATTING_ENTRY_MISSING");
      }
      const subject = this.#bySubject.get(node.subjectKey);
      if (subject === undefined) failInternalState("TREE_BUILDER_FORMATTING_ENTRY_MISSING");
      if (subject.first === node && subject.last === node) {
        this.#bySubject.delete(node.subjectKey);
      } else {
        if (node.subjectPrevious === null) {
          const next = node.subjectNext;
          if (next === null) failInternalState("TREE_BUILDER_FORMATTING_ENTRY_MISSING");
          subject.first = next;
        } else {
          node.subjectPrevious.subjectNext = node.subjectNext;
        }
        if (node.subjectNext === null) {
          const previous = node.subjectPrevious;
          if (previous === null) failInternalState("TREE_BUILDER_FORMATTING_ENTRY_MISSING");
          subject.last = previous;
        } else {
          node.subjectNext.subjectPrevious = node.subjectPrevious;
        }
      }

      const family = this.#byFamily.get(node.familyKey);
      if (family === undefined) failInternalState("TREE_BUILDER_FORMATTING_ENTRY_MISSING");
      const familyIndex = family.indexOf(node);
      if (familyIndex < 0) failInternalState("TREE_BUILDER_FORMATTING_ENTRY_MISSING");
      family.splice(familyIndex, 1);
      if (family.length === 0) this.#byFamily.delete(node.familyKey);
    }
    node.previous = null;
    node.next = null;
    node.subjectPrevious = null;
    node.subjectNext = null;
  }

  #node(entry: ActiveFormattingEntry): FormattingNode {
    const node = this.#nodeByEntry.get(entry);
    if (node === undefined) failInternalState("TREE_BUILDER_FORMATTING_ENTRY_MISSING");
    return node;
  }

  #subjectKey(element: HtmlTreeElement): string {
    return `${String(this.#generation)}\u0000${element.localName}`;
  }

  #familyFor(element: HtmlTreeElement): string {
    let attributes: string[] = [];
    for (let index = 0; index < element.attributeCount; index += 1) {
      this.#resources.checkpoint();
      const attribute = element.attributeAt(index);
      if (attribute !== null) {
        attributes.push(JSON.stringify([attribute.namespaceUri, attribute.localName, attribute.value]));
      }
    }
    for (let width = 1; width < attributes.length; width *= 2) {
      const merged: string[] = [];
      for (let start = 0; start < attributes.length; start += width * 2) {
        let left = start;
        let right = Math.min(start + width, attributes.length);
        const leftEnd = right;
        const rightEnd = Math.min(start + width * 2, attributes.length);
        while (left < leftEnd || right < rightEnd) {
          this.#resources.checkpoint();
          const leftValue = left < leftEnd ? attributes[left] : undefined;
          const rightValue = right < rightEnd ? attributes[right] : undefined;
          if (leftValue !== undefined && (rightValue === undefined || leftValue <= rightValue)) {
            merged.push(leftValue);
            left += 1;
          } else {
            if (rightValue === undefined) {
              failInternalState("TREE_BUILDER_FORMATTING_ENTRY_MISSING");
            }
            merged.push(rightValue);
            right += 1;
          }
        }
      }
      attributes = merged;
    }
    return JSON.stringify([element.namespaceUri, element.localName, attributes]);
  }
}
