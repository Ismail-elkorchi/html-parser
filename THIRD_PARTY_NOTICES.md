# Third-party notices

## html5lib-tests
- Source: https://github.com/html5lib/html5lib-tests
- Location in repository: `vendor/html5lib-tests`
- License: MIT
- Notice: Fixture data is used for conformance evaluation.

## WHATWG entities dataset
- Source: https://html.spec.whatwg.org/entities.json
- Location in repository: `vendor/whatwg/entities.json`
- Generated lookup: `src/internal/entities.ts`
- License/attribution: HTML Standard content and attribution requirements apply.
- Notice: Snapshot is vendored for deterministic named character reference decoding.

## parse5 runtime source (vendored subset)
- Source: https://github.com/inikulin/parse5
- Location in repository: `src/internal/vendor/parse5`
- License: MIT
- Notice: Vendored parser/tokenizer runtime subset used to keep production artifacts self-contained.

## entities runtime source (vendored subset)
- Source: https://github.com/fb55/entities
- Location in repository: `src/internal/vendor/entities`
- License: BSD-2-Clause
- Notice: Vendored entity decoder subset used by the vendored tokenizer runtime.
