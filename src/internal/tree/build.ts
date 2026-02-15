import type {
  TreeBudgets,
  TreeBuildResult,
  TreeBuilderError,
  TreeNode,
  TreeNodeComment,
  TreeNodeDoctype,
  TreeNodeElement,
  TreeNodeText
} from "./types.js";
import type { HtmlToken } from "../tokenizer/tokens.js";

class MutableElement {
  readonly kind = "element" as const;
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: TreeNode[] = [];

  constructor(name: string, attributes: Readonly<Record<string, string>>) {
    this.name = name;
    this.attributes = attributes;
  }
}

function enforceTreeBudgets(
  stack: readonly MutableElement[],
  nodeCount: number,
  budgets: TreeBudgets | undefined,
  errors: TreeBuilderError[],
  tokenIndex: number
): void {
  const maxDepth = budgets?.maxDepth;
  if (maxDepth !== undefined && stack.length > maxDepth) {
    errors.push({ code: "max-depth-exceeded", tokenIndex });
  }

  const maxNodes = budgets?.maxNodes;
  if (maxNodes !== undefined && nodeCount > maxNodes) {
    errors.push({ code: "max-nodes-exceeded", tokenIndex });
  }
}

function normalizeAttributes(
  attrs: Readonly<Record<string, string>>,
  budgets: TreeBudgets | undefined,
  errors: TreeBuilderError[],
  tokenIndex: number
): Readonly<Record<string, string>> {
  const entries = Object.entries(attrs).sort((left, right) => left[0].localeCompare(right[0]));

  const maxAttributesPerElement = budgets?.maxAttributesPerElement;
  if (maxAttributesPerElement !== undefined && entries.length > maxAttributesPerElement) {
    errors.push({ code: "max-attributes-per-element-exceeded", tokenIndex });
  }

  const record: Record<string, string> = {};
  let totalAttributeBytes = 0;

  for (const [name, value] of entries) {
    totalAttributeBytes += name.length + value.length;
    record[name] = value;
  }

  const maxAttributeBytes = budgets?.maxAttributeBytes;
  if (maxAttributeBytes !== undefined && totalAttributeBytes > maxAttributeBytes) {
    errors.push({ code: "max-attribute-bytes-exceeded", tokenIndex });
  }

  return Object.freeze(record);
}

function materialize(node: MutableElement): TreeNodeElement {
  return {
    kind: "element",
    name: node.name,
    attributes: node.attributes,
    children: node.children.map((child) => {
      if (child.kind !== "element") {
        return child;
      }
      return materialize(child as MutableElement);
    })
  };
}

export function buildTreeFromTokens(
  tokens: readonly HtmlToken[],
  budgets?: TreeBudgets
): TreeBuildResult {
  const root = new MutableElement("document-fragment", Object.freeze({}));
  const stack: MutableElement[] = [root];
  const errors: TreeBuilderError[] = [];
  let nodeCount = 0;

  for (const [tokenIndex, token] of tokens.entries()) {
    if (token.type === "EOF") {
      continue;
    }

    const parent = stack[stack.length - 1] ?? root;

    if (token.type === "StartTag") {
      const element = new MutableElement(token.name, normalizeAttributes(token.attributes, budgets, errors, tokenIndex));
      parent.children.push(element as unknown as TreeNode);
      nodeCount += 1;
      enforceTreeBudgets(stack, nodeCount, budgets, errors, tokenIndex);

      if (!token.selfClosing) {
        stack.push(element);
      }
      continue;
    }

    if (token.type === "EndTag") {
      let matchIndex = -1;
      for (let index = stack.length - 1; index >= 1; index -= 1) {
        if (stack[index]?.name === token.name) {
          matchIndex = index;
          break;
        }
      }

      if (matchIndex === -1) {
        errors.push({ code: "unexpected-end-tag", tokenIndex });
        continue;
      }

      stack.splice(matchIndex);
      continue;
    }

    if (token.type === "Character") {
      const textNode: TreeNodeText = {
        kind: "text",
        value: token.data
      };
      parent.children.push(textNode);
      nodeCount += 1;
      enforceTreeBudgets(stack, nodeCount, budgets, errors, tokenIndex);
      continue;
    }

    if (token.type === "Comment") {
      const commentNode: TreeNodeComment = {
        kind: "comment",
        value: token.data
      };
      parent.children.push(commentNode);
      nodeCount += 1;
      enforceTreeBudgets(stack, nodeCount, budgets, errors, tokenIndex);
      continue;
    }

    const doctypeNode: TreeNodeDoctype = {
      kind: "doctype",
      name: token.name
    };
    parent.children.push(doctypeNode);
    nodeCount += 1;
    enforceTreeBudgets(stack, nodeCount, budgets, errors, tokenIndex);
  }

  return {
    document: {
      kind: "document",
      children: root.children.map((child) => {
        if (child.kind !== "element") {
          return child;
        }
        return materialize(child as MutableElement);
      })
    },
    errors
  };
}
