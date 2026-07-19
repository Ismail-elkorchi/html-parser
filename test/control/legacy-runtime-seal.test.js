import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LegacyRuntimeSealError,
  verifyLegacyRuntimeSeal
} from "../../scripts/legacy/verify-runtime-seal.mjs";

const SOURCE_RUNTIME_ROOT = path.join("src", "internal", "vendor");

async function withRuntimeCopy(run) {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "html-parser-legacy-seal-"));
  const runtimeRoot = path.join(repositoryRoot, SOURCE_RUNTIME_ROOT);
  try {
    await mkdir(path.dirname(runtimeRoot), { recursive: true });
    await cp(SOURCE_RUNTIME_ROOT, runtimeRoot, { recursive: true });
    await run({ repositoryRoot, runtimeRoot });
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

async function expectSealFailure(repositoryRoot, expectedProblem) {
  await assert.rejects(
    verifyLegacyRuntimeSeal({
      repositoryRoot,
      manifestPath: path.resolve("legacy-runtime-manifest.json")
    }),
    (error) => {
      assert(error instanceof LegacyRuntimeSealError);
      assert(
        error.problems.some((problem) => problem.includes(expectedProblem)),
        `expected a problem containing ${expectedProblem}; got ${error.problems.join(" | ")}`
      );
      return true;
    }
  );
}

test("legacy runtime seal accepts the exact repository inventory", async () => {
  const result = await verifyLegacyRuntimeSeal();
  assert.equal(result.files, 18);
  assert.equal(result.implementationFiles, 16);
  assert.equal(result.licenseFiles, 2);
  assert.equal(result.compositeSha256, "85da9fd67f7b343ffb65a9c66e7ae45ddb34d25173bb6c0f34e0715cca698538");
});

test("legacy runtime seal rejects controlled inventory and byte mutations", async (context) => {
  await context.test("one-byte mutation", async () => {
    await withRuntimeCopy(async ({ repositoryRoot, runtimeRoot }) => {
      const target = path.join(runtimeRoot, "entities", "decode-codepoint.js");
      const bytes = await readFile(target);
      bytes[0] ^= 1;
      await writeFile(target, bytes);
      await expectSealFailure(repositoryRoot, "SHA-256 mismatch");
    });
  });

  await context.test("addition", async () => {
    await withRuntimeCopy(async ({ repositoryRoot, runtimeRoot }) => {
      await writeFile(path.join(runtimeRoot, "unexpected.js"), "export {};\n", "utf8");
      await expectSealFailure(repositoryRoot, "unexpected file");
    });
  });

  await context.test("deletion", async () => {
    await withRuntimeCopy(async ({ repositoryRoot, runtimeRoot }) => {
      await unlink(path.join(runtimeRoot, "entities", "decode-codepoint.js"));
      await expectSealFailure(repositoryRoot, "missing file");
    });
  });

  await context.test("rename", async () => {
    await withRuntimeCopy(async ({ repositoryRoot, runtimeRoot }) => {
      await rename(
        path.join(runtimeRoot, "entities", "decode-codepoint.js"),
        path.join(runtimeRoot, "entities", "renamed.js")
      );
      await expectSealFailure(repositoryRoot, "missing file");
      await expectSealFailure(repositoryRoot, "unexpected file");
    });
  });

  await withRuntimeCopy(async ({ repositoryRoot }) => {
    const restored = await verifyLegacyRuntimeSeal({
      repositoryRoot,
      manifestPath: path.resolve("legacy-runtime-manifest.json")
    });
    assert.equal(restored.files, 18);
  });
});
