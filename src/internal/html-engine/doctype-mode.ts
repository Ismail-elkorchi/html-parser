import type { HtmlDoctypeToken } from "./tokens.js";

/** Rendering mode selected by the tree builder's initial insertion mode. */
export type HtmlDocumentMode = "no-quirks" | "limited-quirks" | "quirks";

const QUIRKS_PUBLIC_EXACT = new Set([
  "-//w3o//dtd w3 html strict 3.0//en//",
  "-/w3c/dtd html 4.0 transitional/en",
  "html"
]);

const QUIRKS_PUBLIC_PREFIXES = Object.freeze([
  "+//silmaril//dtd html pro v0r11 19970101//",
  "-//as//dtd html 3.0 aswedit + extensions//",
  "-//advasoft ltd//dtd html 3.0 aswedit + extensions//",
  "-//ietf//dtd html 2.0 level 1//",
  "-//ietf//dtd html 2.0 level 2//",
  "-//ietf//dtd html 2.0 strict level 1//",
  "-//ietf//dtd html 2.0 strict level 2//",
  "-//ietf//dtd html 2.0 strict//",
  "-//ietf//dtd html 2.0//",
  "-//ietf//dtd html 2.1e//",
  "-//ietf//dtd html 3.0//",
  "-//ietf//dtd html 3.2 final//",
  "-//ietf//dtd html 3.2//",
  "-//ietf//dtd html 3//",
  "-//ietf//dtd html level 0//",
  "-//ietf//dtd html level 1//",
  "-//ietf//dtd html level 2//",
  "-//ietf//dtd html level 3//",
  "-//ietf//dtd html strict level 0//",
  "-//ietf//dtd html strict level 1//",
  "-//ietf//dtd html strict level 2//",
  "-//ietf//dtd html strict level 3//",
  "-//ietf//dtd html strict//",
  "-//ietf//dtd html//",
  "-//metrius//dtd metrius presentational//",
  "-//microsoft//dtd internet explorer 2.0 html strict//",
  "-//microsoft//dtd internet explorer 2.0 html//",
  "-//microsoft//dtd internet explorer 2.0 tables//",
  "-//microsoft//dtd internet explorer 3.0 html strict//",
  "-//microsoft//dtd internet explorer 3.0 html//",
  "-//microsoft//dtd internet explorer 3.0 tables//",
  "-//netscape comm. corp.//dtd html//",
  "-//netscape comm. corp.//dtd strict html//",
  "-//o'reilly and associates//dtd html 2.0//",
  "-//o'reilly and associates//dtd html extended 1.0//",
  "-//o'reilly and associates//dtd html extended relaxed 1.0//",
  "-//sq//dtd html 2.0 hotmetal + extensions//",
  "-//softquad software//dtd hotmetal pro 6.0::19990601::extensions to html 4.0//",
  "-//softquad//dtd hotmetal pro 4.0::19971010::extensions to html 4.0//",
  "-//spyglass//dtd html 2.0 extended//",
  "-//sun microsystems corp.//dtd hotjava html//",
  "-//sun microsystems corp.//dtd hotjava strict html//",
  "-//w3c//dtd html 3 1995-03-24//",
  "-//w3c//dtd html 3.2 draft//",
  "-//w3c//dtd html 3.2 final//",
  "-//w3c//dtd html 3.2//",
  "-//w3c//dtd html 3.2s draft//",
  "-//w3c//dtd html 4.0 frameset//",
  "-//w3c//dtd html 4.0 transitional//",
  "-//w3c//dtd html experimental 19960712//",
  "-//w3c//dtd html experimental 970421//",
  "-//w3c//dtd w3 html//",
  "-//w3o//dtd w3 html 3.0//",
  "-//webtechs//dtd mozilla html 2.0//",
  "-//webtechs//dtd mozilla html//"
]);

const HTML_401_PREFIXES = Object.freeze([
  "-//w3c//dtd html 4.01 frameset//",
  "-//w3c//dtd html 4.01 transitional//"
]);

const LIMITED_QUIRKS_PUBLIC_PREFIXES = Object.freeze([
  "-//w3c//dtd xhtml 1.0 frameset//",
  "-//w3c//dtd xhtml 1.0 transitional//"
]);

function startsWithAny(value: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

/** Applies the pinned Standard's complete quirks-mode DOCTYPE table. */
export function documentModeForDoctype(token: HtmlDoctypeToken): HtmlDocumentMode {
  const name = token.name?.toLowerCase() ?? "";
  const publicIdentifier = token.publicIdentifier?.toLowerCase() ?? null;
  const systemIdentifier = token.systemIdentifier?.toLowerCase() ?? null;
  if (
    token.forceQuirks ||
    name !== "html" ||
    (publicIdentifier !== null && QUIRKS_PUBLIC_EXACT.has(publicIdentifier)) ||
    systemIdentifier === "http://www.ibm.com/data/dtd/v11/ibmxhtml1-transitional.dtd" ||
    (publicIdentifier !== null && startsWithAny(publicIdentifier, QUIRKS_PUBLIC_PREFIXES)) ||
    (publicIdentifier !== null &&
      (systemIdentifier === null || systemIdentifier.length === 0) &&
      startsWithAny(publicIdentifier, HTML_401_PREFIXES))
  ) {
    return "quirks";
  }
  if (
    publicIdentifier !== null &&
    (startsWithAny(publicIdentifier, LIMITED_QUIRKS_PUBLIC_PREFIXES) ||
      (systemIdentifier !== null &&
        systemIdentifier.length > 0 &&
        startsWithAny(publicIdentifier, HTML_401_PREFIXES)))
  ) {
    return "limited-quirks";
  }
  return "no-quirks";
}
