import { foreignAttributeAdjustment } from "../foundation/foreign-attribute-adjustment.ts";

import { MATHML_NAMESPACE, SVG_NAMESPACE } from "./namespaces.ts";

import type { HtmlStartTagToken, HtmlTokenAttribute } from "./tokens.ts";
import type { HtmlTreeAttributeInput, HtmlTreeElement } from "./tree-model.ts";

type ForeignElementNamespaceUri = typeof MATHML_NAMESPACE | typeof SVG_NAMESPACE;

const MATHML_TEXT_INTEGRATION_POINTS = new Set(["mi", "mo", "mn", "ms", "mtext"]);
const SVG_HTML_INTEGRATION_POINTS = new Set(["foreignObject", "desc", "title"]);

const SVG_TAG_NAMES = new Map<string, string>([
  ["altglyph", "altGlyph"],
  ["altglyphdef", "altGlyphDef"],
  ["altglyphitem", "altGlyphItem"],
  ["animatecolor", "animateColor"],
  ["animatemotion", "animateMotion"],
  ["animatetransform", "animateTransform"],
  ["clippath", "clipPath"],
  ["feblend", "feBlend"],
  ["fecolormatrix", "feColorMatrix"],
  ["fecomponenttransfer", "feComponentTransfer"],
  ["fecomposite", "feComposite"],
  ["feconvolvematrix", "feConvolveMatrix"],
  ["fediffuselighting", "feDiffuseLighting"],
  ["fedisplacementmap", "feDisplacementMap"],
  ["fedistantlight", "feDistantLight"],
  ["fedropshadow", "feDropShadow"],
  ["feflood", "feFlood"],
  ["fefunca", "feFuncA"],
  ["fefuncb", "feFuncB"],
  ["fefuncg", "feFuncG"],
  ["fefuncr", "feFuncR"],
  ["fegaussianblur", "feGaussianBlur"],
  ["feimage", "feImage"],
  ["femerge", "feMerge"],
  ["femergenode", "feMergeNode"],
  ["femorphology", "feMorphology"],
  ["feoffset", "feOffset"],
  ["fepointlight", "fePointLight"],
  ["fespecularlighting", "feSpecularLighting"],
  ["fespotlight", "feSpotLight"],
  ["fetile", "feTile"],
  ["feturbulence", "feTurbulence"],
  ["foreignobject", "foreignObject"],
  ["glyphref", "glyphRef"],
  ["lineargradient", "linearGradient"],
  ["radialgradient", "radialGradient"],
  ["textpath", "textPath"]
]);

const SVG_ATTRIBUTE_NAMES = new Map<string, string>([
  ["attributename", "attributeName"],
  ["attributetype", "attributeType"],
  ["basefrequency", "baseFrequency"],
  ["baseprofile", "baseProfile"],
  ["calcmode", "calcMode"],
  ["clippathunits", "clipPathUnits"],
  ["diffuseconstant", "diffuseConstant"],
  ["edgemode", "edgeMode"],
  ["filterunits", "filterUnits"],
  ["glyphref", "glyphRef"],
  ["gradienttransform", "gradientTransform"],
  ["gradientunits", "gradientUnits"],
  ["kernelmatrix", "kernelMatrix"],
  ["kernelunitlength", "kernelUnitLength"],
  ["keypoints", "keyPoints"],
  ["keysplines", "keySplines"],
  ["keytimes", "keyTimes"],
  ["lengthadjust", "lengthAdjust"],
  ["limitingconeangle", "limitingConeAngle"],
  ["markerheight", "markerHeight"],
  ["markerunits", "markerUnits"],
  ["markerwidth", "markerWidth"],
  ["maskcontentunits", "maskContentUnits"],
  ["maskunits", "maskUnits"],
  ["numoctaves", "numOctaves"],
  ["pathlength", "pathLength"],
  ["patterncontentunits", "patternContentUnits"],
  ["patterntransform", "patternTransform"],
  ["patternunits", "patternUnits"],
  ["pointsatx", "pointsAtX"],
  ["pointsaty", "pointsAtY"],
  ["pointsatz", "pointsAtZ"],
  ["preservealpha", "preserveAlpha"],
  ["preserveaspectratio", "preserveAspectRatio"],
  ["primitiveunits", "primitiveUnits"],
  ["refx", "refX"],
  ["refy", "refY"],
  ["repeatcount", "repeatCount"],
  ["repeatdur", "repeatDur"],
  ["requiredextensions", "requiredExtensions"],
  ["requiredfeatures", "requiredFeatures"],
  ["specularconstant", "specularConstant"],
  ["specularexponent", "specularExponent"],
  ["spreadmethod", "spreadMethod"],
  ["startoffset", "startOffset"],
  ["stddeviation", "stdDeviation"],
  ["stitchtiles", "stitchTiles"],
  ["surfacescale", "surfaceScale"],
  ["systemlanguage", "systemLanguage"],
  ["tablevalues", "tableValues"],
  ["targetx", "targetX"],
  ["targety", "targetY"],
  ["textlength", "textLength"],
  ["viewbox", "viewBox"],
  ["viewtarget", "viewTarget"],
  ["xchannelselector", "xChannelSelector"],
  ["ychannelselector", "yChannelSelector"],
  ["zoomandpan", "zoomAndPan"]
]);

interface ForeignAttributeName {
  readonly namespaceUri: HtmlTreeAttributeInput["namespaceUri"];
  readonly prefix: string | null;
  readonly localName: string;
}

const FOREIGN_BREAKOUT_START_TAGS = new Set([
  "b", "big", "blockquote", "body", "br", "center", "code", "dd", "div", "dl", "dt",
  "em", "embed", "h1", "h2", "h3", "h4", "h5", "h6", "head", "hr", "i", "img",
  "li", "listing", "menu", "meta", "nobr", "ol", "p", "pre", "ruby", "s", "small",
  "span", "strong", "strike", "sub", "sup", "table", "tt", "u", "ul", "var"
]);

export function isForeignBreakoutStartTag(name: string): boolean {
  return FOREIGN_BREAKOUT_START_TAGS.has(name);
}

export function isMathMLTextIntegrationPoint(element: HtmlTreeElement): boolean {
  return element.namespaceUri === MATHML_NAMESPACE &&
    MATHML_TEXT_INTEGRATION_POINTS.has(element.localName);
}

export function isHtmlIntegrationPoint(element: HtmlTreeElement): boolean {
  if (element.namespaceUri === SVG_NAMESPACE) {
    return SVG_HTML_INTEGRATION_POINTS.has(element.localName);
  }
  if (element.namespaceUri !== MATHML_NAMESPACE || element.localName !== "annotation-xml") {
    return false;
  }
  for (let index = 0; index < element.attributeCount; index += 1) {
    const attribute = element.attributeAt(index);
    if (attribute?.namespaceUri !== null || attribute.localName !== "encoding") continue;
    const value = attribute.value.toLowerCase();
    if (value === "text/html" || value === "application/xhtml+xml") return true;
  }
  return false;
}

export function adjustedForeignTagName(name: string, namespaceUri: ForeignElementNamespaceUri): string {
  return namespaceUri === SVG_NAMESPACE ? SVG_TAG_NAMES.get(name) ?? name : name;
}

function adjustedAttributeName(
  attribute: HtmlTokenAttribute,
  namespaceUri: ForeignElementNamespaceUri
): ForeignAttributeName {
  const foreign = foreignAttributeAdjustment(attribute.name);
  if (foreign !== undefined) return foreign;
  let localName = attribute.name;
  if (namespaceUri === MATHML_NAMESPACE && localName === "definitionurl") {
    localName = "definitionURL";
  } else if (namespaceUri === SVG_NAMESPACE) {
    localName = SVG_ATTRIBUTE_NAMES.get(localName) ?? localName;
  }
  return { namespaceUri: null, prefix: null, localName };
}

export function adjustedForeignAttributes(
  attributes: readonly HtmlTokenAttribute[],
  namespaceUri: ForeignElementNamespaceUri
): readonly HtmlTreeAttributeInput[] {
  return Object.freeze(attributes.map((attribute) => {
    const adjusted = adjustedAttributeName(attribute, namespaceUri);
    return Object.freeze({
      namespaceUri: adjusted.namespaceUri,
      prefix: adjusted.prefix,
      localName: adjusted.localName,
      qualifiedName: adjusted.prefix === null
        ? adjusted.localName
        : `${adjusted.prefix}:${adjusted.localName}`,
      value: attribute.value,
      sourceSpan: attribute.span
    });
  }));
}

export function hasForeignBreakoutFontAttribute(token: HtmlStartTagToken): boolean {
  return token.name === "font" && token.attributes.some((attribute) =>
    attribute.name === "color" || attribute.name === "face" || attribute.name === "size"
  );
}
