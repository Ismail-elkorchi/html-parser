import { readFileSync } from "node:fs";

export const HTML5LIB_TOKENIZER_CORPUS_ROOT =
  "test/fixtures/upstream/html5lib-tokenizer";

interface CorpusManifest {
  readonly corpus?: unknown;
  readonly sourceRoot?: unknown;
  readonly files?: unknown;
}

export interface Html5libFixtureSource {
  readonly path: string;
  readonly upstreamPath: string;
}

/** Loads the tokenizer inventory from its provenance manifest. */
export function loadHtml5libTokenizerInventory(): readonly Html5libFixtureSource[] {
  const manifest = JSON.parse(
    readFileSync(`${HTML5LIB_TOKENIZER_CORPUS_ROOT}/manifest.json`, "utf8")
  ) as CorpusManifest;
  if (
    manifest.corpus !== "tokenizer" ||
    manifest.sourceRoot !== "tokenizer" ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("html5lib tokenizer manifest has an invalid identity or file inventory");
  }

  const fixtures: Html5libFixtureSource[] = [];
  for (const file of manifest.files as readonly unknown[]) {
    if (file === null || typeof file !== "object") continue;
    const entry = file as Record<string, unknown>;
    if (
      entry["kind"] !== "fixture" ||
      typeof entry["path"] !== "string" ||
      typeof entry["upstreamPath"] !== "string"
    ) {
      continue;
    }
    fixtures.push(Object.freeze({
      path: `${HTML5LIB_TOKENIZER_CORPUS_ROOT}/${entry["path"]}`,
      upstreamPath: entry["upstreamPath"]
    }));
  }
  if (fixtures.length === 0) {
    throw new Error("html5lib tokenizer manifest does not contain fixtures");
  }
  return Object.freeze(fixtures);
}
