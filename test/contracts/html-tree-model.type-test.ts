import { ActiveFormattingList } from "../../src/internal/html-engine/active-formatting-list.js";
import {
  HTML_NAMESPACE,
  XML_NAMESPACE,
  type HtmlAttributeNamespaceUri
} from "../../src/internal/html-engine/namespaces.js";
import { createEngineResourceGuard } from "../../src/internal/html-engine/resource-guard.js";
import {
  HtmlTreeModel,
  type HtmlTreeDoctypeExternalId,
  type HtmlTreeNode,
  type HtmlTreeParent
} from "../../src/internal/html-engine/tree-model.js";

import type { NodeId } from "../../src/mod.js";

const model = new HtmlTreeModel({
  rootKind: "fragment",
  resources: createEngineResourceGuard()
});
const element = model.createElement({
  namespaceUri: HTML_NAMESPACE,
  prefix: null,
  localName: "p",
  qualifiedName: "p",
  attributes: [{
    namespaceUri: XML_NAMESPACE,
    prefix: "xml",
    localName: "lang",
    qualifiedName: "xml:lang",
    value: "en"
  }]
});
const parent: HtmlTreeParent = model.root;
const node: HtmlTreeNode = element;
const instruction: HtmlTreeNode = model.createProcessingInstruction("target", "data");
const formatting = new ActiveFormattingList(createEngineResourceGuard());
const formattingEntry = formatting.pushElement(element, {
  kind: "start-tag",
  name: "p",
  attributes: [],
  selfClosing: false,
  span: { startUtf16Offset: 0, endUtf16Offset: 3 }
});
const destination = model.createElement({
  namespaceUri: HTML_NAMESPACE,
  prefix: null,
  localName: "div",
  qualifiedName: "div"
});
model.moveChildren(element, destination);
const externalId: HtmlTreeDoctypeExternalId = {
  kind: "public",
  publicIdentifier: "",
  systemIdentifier: null
};
void parent;
void node;
void instruction;
void formattingEntry;
void externalId;

// @ts-expect-error - private identities cannot be reused as public NodeId values.
const publicId: NodeId = element.identity;
void publicId;

// @ts-expect-error - parser-assigned attribute namespaces are a closed union.
const unknownNamespace: HtmlAttributeNamespaceUri = "urn:unknown";
void unknownNamespace;

// @ts-expect-error - a text node is not a tree parent.
const invalidParent: HtmlTreeParent = model.createText("x");
void invalidParent;

// @ts-expect-error - tree node identities are immutable.
element.identity.serial = 2;

// @ts-expect-error - formatting entries are immutable creation records.
formattingEntry.element = destination;

// @ts-expect-error - bulk child movement is deliberately element-to-element.
model.moveChildren(model.root, destination);

// @ts-expect-error - a public numeric node id is not an internal identity.
const privateIdentity = 1 as NodeId satisfies typeof element.identity;
void privateIdentity;
