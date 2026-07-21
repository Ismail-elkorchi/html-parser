import { HTML_NAMESPACE } from "./namespaces.ts";

import type { EngineResourceGuard } from "./resource-guard.ts";
import type { HtmlTreeElement, HtmlTreeModel } from "./tree-model.ts";

interface SelectState {
  selectedOption: HtmlTreeElement | null;
  primarySelectedContent: HtmlTreeElement | null;
}

function isHtmlElement(element: HtmlTreeElement, localName: string): boolean {
  return element.namespaceUri === HTML_NAMESPACE && element.localName === localName;
}

/** Parser-owned form-element state needed while constructing a direct tree. */
export class HtmlSelectElementState {
  readonly #model: HtmlTreeModel;
  readonly #resources: EngineResourceGuard;
  readonly #optionSelectedness = new WeakMap<HtmlTreeElement, boolean>();
  readonly #selectState = new WeakMap<HtmlTreeElement, SelectState>();

  constructor(model: HtmlTreeModel, resources: EngineResourceGuard) {
    this.#model = model;
    this.#resources = resources;
  }

  elementInserted(element: HtmlTreeElement): void {
    if (isHtmlElement(element, "select")) {
      this.#stateFor(element);
      return;
    }
    if (isHtmlElement(element, "option")) {
      this.#optionInserted(element);
      return;
    }
    if (isHtmlElement(element, "selectedcontent")) this.#selectedContentInserted(element);
  }

  optionPopped(element: HtmlTreeElement): void {
    if (!isHtmlElement(element, "option") || !this.#isSelected(element)) return;
    const select = this.#nearestOptionSelect(element);
    if (select === null || this.#hasAttribute(select, "multiple")) return;
    const selectedContent = this.#stateFor(select).primarySelectedContent;
    if (
      selectedContent !== null &&
      this.#enabledSelectedContentSelect(selectedContent) === select
    ) {
      this.#model.replaceChildrenWithClones(element, selectedContent);
    }
  }

  #optionInserted(option: HtmlTreeElement): void {
    const initiallySelected = this.#hasAttribute(option, "selected");
    this.#optionSelectedness.set(option, initiallySelected);
    const select = this.#nearestOptionSelect(option);
    if (select === null || this.#hasAttribute(select, "multiple")) return;
    const state = this.#stateFor(select);
    if (initiallySelected) {
      if (state.selectedOption !== null) {
        this.#optionSelectedness.set(state.selectedOption, false);
      }
      state.selectedOption = option;
      return;
    }
    if (
      state.selectedOption === null &&
      this.#displaySize(select) === 1 &&
      !this.#isDisabledOption(option)
    ) {
      this.#optionSelectedness.set(option, true);
      state.selectedOption = option;
    }
  }

  #selectedContentInserted(selectedContent: HtmlTreeElement): void {
    let ancestor = this.#parentElement(selectedContent);
    while (ancestor !== null) {
      this.#resources.checkpoint();
      if (isHtmlElement(ancestor, "select")) {
        const state = this.#stateFor(ancestor);
        state.primarySelectedContent ??= selectedContent;
      }
      ancestor = this.#parentElement(ancestor);
    }

    const select = this.#enabledSelectedContentSelect(selectedContent);
    if (select === null) return;
    const state = this.#stateFor(select);
    if (state.primarySelectedContent !== selectedContent) {
      this.#model.clearChildren(selectedContent);
      return;
    }
    if (state.selectedOption === null) this.#model.clearChildren(selectedContent);
    else this.#model.replaceChildrenWithClones(state.selectedOption, selectedContent);
  }

  #enabledSelectedContentSelect(selectedContent: HtmlTreeElement): HtmlTreeElement | null {
    let nearestSelect: HtmlTreeElement | null = null;
    let ancestor = this.#parentElement(selectedContent);
    while (ancestor !== null) {
      this.#resources.checkpoint();
      if (isHtmlElement(ancestor, "option") || isHtmlElement(ancestor, "selectedcontent")) {
        return null;
      }
      if (isHtmlElement(ancestor, "select")) {
        if (nearestSelect !== null) return null;
        nearestSelect = ancestor;
      }
      ancestor = this.#parentElement(ancestor);
    }
    if (nearestSelect === null || this.#hasAttribute(nearestSelect, "multiple")) return null;
    return nearestSelect;
  }

  #nearestOptionSelect(option: HtmlTreeElement): HtmlTreeElement | null {
    let sawOptgroup = false;
    let ancestor = this.#parentElement(option);
    while (ancestor !== null) {
      this.#resources.checkpoint();
      if (
        isHtmlElement(ancestor, "datalist") ||
        isHtmlElement(ancestor, "hr") ||
        isHtmlElement(ancestor, "option")
      ) {
        return null;
      }
      if (isHtmlElement(ancestor, "optgroup")) {
        if (sawOptgroup) return null;
        sawOptgroup = true;
      }
      if (isHtmlElement(ancestor, "select")) return ancestor;
      ancestor = this.#parentElement(ancestor);
    }
    return null;
  }

  #isDisabledOption(option: HtmlTreeElement): boolean {
    if (this.#hasAttribute(option, "disabled")) return true;
    let ancestor = this.#parentElement(option);
    while (ancestor !== null) {
      this.#resources.checkpoint();
      if (isHtmlElement(ancestor, "optgroup")) {
        return this.#hasAttribute(ancestor, "disabled");
      }
      if (isHtmlElement(ancestor, "select")) return false;
      ancestor = this.#parentElement(ancestor);
    }
    return false;
  }

  #displaySize(select: HtmlTreeElement): number {
    const size = this.#model.attribute(select, null, "size")?.value;
    if (size === undefined) return 1;
    const match = /^[\t\n\f\r ]*([0-9]+)/u.exec(size);
    if (match?.[1] === undefined) return 1;
    const parsed = Number(match[1]);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
  }

  #stateFor(select: HtmlTreeElement): SelectState {
    const existing = this.#selectState.get(select);
    if (existing !== undefined) return existing;
    const state: SelectState = { selectedOption: null, primarySelectedContent: null };
    this.#selectState.set(select, state);
    return state;
  }

  #isSelected(option: HtmlTreeElement): boolean {
    return this.#optionSelectedness.get(option) ?? this.#hasAttribute(option, "selected");
  }

  #hasAttribute(element: HtmlTreeElement, localName: string): boolean {
    return this.#model.attribute(element, null, localName) !== null;
  }

  #parentElement(element: HtmlTreeElement): HtmlTreeElement | null {
    const parent = element.parent;
    return parent?.kind === "element" ? parent : null;
  }
}
