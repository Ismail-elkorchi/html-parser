import assert from "node:assert/strict";
import test from "node:test";

import { collectModuleSpecifiers } from "../../scripts/lib/module-specifiers.mjs";

test("module reference scanning reads syntax without matching documentation text", () => {
  const source = `
    /** @example import { parse } from "jsr:@scope/example"; */
    const prose = 'export * from "not-a-module"';
    import value from "./value.js";
    export type { Shape } from "types-package";
    const deferred = import("dynamic-package");
    const loaded = require("node:fs");
    type Imported = import("type-package").Imported;
    void prose; void value; void deferred; void loaded;
  `;

  assert.deepEqual(collectModuleSpecifiers(source), [
    { kind: "import", specifier: "./value.js" },
    { kind: "export", specifier: "types-package" },
    { kind: "dynamic-import", specifier: "dynamic-package" },
    { kind: "require", specifier: "node:fs" },
    { kind: "import-type", specifier: "type-package" }
  ]);
});

test("module reference scanning ignores non-literal dynamic references", () => {
  assert.deepEqual(collectModuleSpecifiers("const name = './x.js'; import(name);"), []);
});
