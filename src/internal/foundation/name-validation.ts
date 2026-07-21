const FORBIDDEN_HTML_ATTRIBUTE_SYNTAX = new Set([
  0x20, // ASCII space
  0x22, // "
  0x27, // '
  0x2f, // /
  0x3d, // =
  0x3e // >
]);

function isControl(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

function isXmlNameStart(codePoint: number): boolean {
  return codePoint === 0x5f ||
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a) ||
    (codePoint >= 0xc0 && codePoint <= 0xd6) ||
    (codePoint >= 0xd8 && codePoint <= 0xf6) ||
    (codePoint >= 0xf8 && codePoint <= 0x2ff) ||
    (codePoint >= 0x370 && codePoint <= 0x37d) ||
    (codePoint >= 0x37f && codePoint <= 0x1fff) ||
    (codePoint >= 0x200c && codePoint <= 0x200d) ||
    (codePoint >= 0x2070 && codePoint <= 0x218f) ||
    (codePoint >= 0x2c00 && codePoint <= 0x2fef) ||
    (codePoint >= 0x3001 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfdcf) ||
    (codePoint >= 0xfdf0 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0xeffff);
}

function isXmlNameContinuation(codePoint: number): boolean {
  return isXmlNameStart(codePoint) ||
    codePoint === 0x2d ||
    codePoint === 0x2e ||
    (codePoint >= 0x30 && codePoint <= 0x39) ||
    codePoint === 0xb7 ||
    (codePoint >= 0x300 && codePoint <= 0x36f) ||
    (codePoint >= 0x203f && codePoint <= 0x2040);
}

/** Whether a value is an XML Name without the namespace-separating colon. */
export function isXmlLocalName(value: string): boolean {
  if (value.length === 0) return false;
  let first = true;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined ||
        (first ? !isXmlNameStart(codePoint) : !isXmlNameContinuation(codePoint))) {
      return false;
    }
    first = false;
  }
  return true;
}

/** Whether a value can be emitted as one HTML attribute name without changing tokenization. */
export function isHtmlAttributeName(value: string): boolean {
  if (value.length === 0) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || isControl(codePoint) ||
        FORBIDDEN_HTML_ATTRIBUTE_SYNTAX.has(codePoint) ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return false;
    }
  }
  return true;
}
