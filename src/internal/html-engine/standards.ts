/** Exact WHATWG revisions used by the first independent-engine implementation. */
export const ENGINE_STANDARD_BASELINE = Object.freeze({
  html: "56674fb3ac40279141a202e5d19b84f30d99854d",
  encoding: "a985b62a9b45c17da3e17a9f0a0b4e30c34c4a8a",
  infra: "3f984adcd24a6d5c53cc26b3e737701808003f3e",
  dom: "8a5f57c61ca1de8dc21b7e114501b1b57882e935"
} as const);

/** Exact HTML Standard revision used by the engine. */
export const HTML_STANDARD_REVISION = ENGINE_STANDARD_BASELINE.html;
