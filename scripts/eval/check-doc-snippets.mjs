import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";

import ts from "typescript";

import { nowIso, writeJson } from "./eval-primitives.mjs";

const TEMP_DIR = "tmp/doc-snippets";
const TSCONFIG_PATH = `${TEMP_DIR}/tsconfig.json`;
const REPORT_PATH = "reports/doc-snippets.json";
const CANONICAL_IMPORT_SPECIFIER = "@ismail-elkorchi/html-parser";
const PACKAGE_IMPORT_ALIASES = new Set([
  CANONICAL_IMPORT_SPECIFIER,
  "html-parser",
  "@html-parser/core"
]);

function extractTsBlocks(markdownText) {
  const blocks = [];
  const fenceRegex = /```(?:ts|typescript)\s*\r?\n([\s\S]*?)```/g;
  let match = fenceRegex.exec(markdownText);
  while (match) {
    blocks.push(match[1]);
    match = fenceRegex.exec(markdownText);
  }
  return blocks;
}

function makeSnippetSource(blockText) {
  const trimmedBlock = blockText.trim();
  if (trimmedBlock.length === 0) {
    return "export {};\n";
  }

  const hasModuleSyntax = /\b(?:import|export)\b/.test(blockText);
  if (hasModuleSyntax) {
    return blockText.endsWith("\n") ? blockText : `${blockText}\n`;
  }

  return `${blockText}${blockText.endsWith("\n") ? "" : "\n"}\nexport {};\n`;
}

function collectImportSpecifiers(codeText) {
  const importSpecifiers = [];
  const importRegex = /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g;
  let match = importRegex.exec(codeText);
  while (match) {
    importSpecifiers.push(match[1]);
    match = importRegex.exec(codeText);
  }
  return importSpecifiers;
}

async function listMarkdownFiles() {
  const files = ["README.md"];
  const docsEntries = await readdir("docs", { withFileTypes: true });
  for (const docsEntry of docsEntries) {
    if (docsEntry.isFile() && docsEntry.name.endsWith(".md")) {
      files.push(`docs/${docsEntry.name}`);
    }
  }
  return files.sort();
}

function flattenDiagnosticMessage(diagnostic) {
  const messageText = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const diagnosticCode = `TS${String(diagnostic.code)}`;

  if (diagnostic.file && Number.isFinite(diagnostic.start)) {
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return `${diagnosticCode} ${messageText} (${position.line + 1}:${position.character + 1})`;
  }

  return `${diagnosticCode} ${messageText}`;
}

async function compileSnippets(snippetFileNames) {
  const tsConfig = {
    compilerOptions: {
      noEmit: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: false,
      skipLibCheck: true,
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      types: [],
      baseUrl: "../..",
      paths: {
        [CANONICAL_IMPORT_SPECIFIER]: ["dist/mod.d.ts"]
      }
    },
    files: snippetFileNames
  };

  await writeFile(TSCONFIG_PATH, `${JSON.stringify(tsConfig, null, 2)}\n`, "utf8");

  const resolvedTsConfigPath = resolve(TSCONFIG_PATH);
  const parsedConfigFile = ts.readConfigFile(resolvedTsConfigPath, ts.sys.readFile);
  if (parsedConfigFile.error) {
    return [parsedConfigFile.error];
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    parsedConfigFile.config,
    ts.sys,
    dirname(resolvedTsConfigPath)
  );

  const program = ts.createProgram({
    rootNames: parsedConfig.fileNames,
    options: parsedConfig.options
  });

  return ts.getPreEmitDiagnostics(program);
}

async function main() {
  await rm(TEMP_DIR, { recursive: true, force: true });
  await mkdir(TEMP_DIR, { recursive: true });

  const markdownFiles = await listMarkdownFiles();
  const snippetMeta = [];
  const failures = [];

  for (const markdownFile of markdownFiles) {
    const markdownText = await readFile(markdownFile, "utf8");
    const tsBlocks = extractTsBlocks(markdownText);

    for (let blockIndex = 0; blockIndex < tsBlocks.length; blockIndex += 1) {
      const snippetCode = tsBlocks[blockIndex];
      const snippetNumber = snippetMeta.length + 1;
      const snippetBasename = `snippet-${String(snippetNumber).padStart(4, "0")}.ts`;
      const snippetPath = resolve(TEMP_DIR, snippetBasename);
      const snippetSource = makeSnippetSource(snippetCode);
      await writeFile(snippetPath, snippetSource, "utf8");

      const packageImports = collectImportSpecifiers(snippetCode).filter((specifier) =>
        PACKAGE_IMPORT_ALIASES.has(specifier)
      );
      const nonCanonicalImports = packageImports.filter((specifier) => specifier !== CANONICAL_IMPORT_SPECIFIER);
      if (nonCanonicalImports.length > 0) {
        failures.push({
          file: markdownFile,
          index: blockIndex + 1,
          error: `non-canonical import specifier(s): ${nonCanonicalImports.join(", ")}`
        });
      }

      snippetMeta.push({
        markdownFile,
        markdownIndex: blockIndex + 1,
        snippetPath
      });
    }
  }

  const snippetFileNames = snippetMeta.map((entry) => relative(resolve(TEMP_DIR), entry.snippetPath));
  const diagnostics = await compileSnippets(snippetFileNames);

  const snippetPathToMeta = new Map(
    snippetMeta.map((entry) => [resolve(entry.snippetPath), entry])
  );

  for (const diagnostic of diagnostics) {
    if (diagnostic.file) {
      const diagnosticFilePath = resolve(diagnostic.file.fileName);
      const diagnosticMeta = snippetPathToMeta.get(diagnosticFilePath);
      if (diagnosticMeta) {
        failures.push({
          file: diagnosticMeta.markdownFile,
          index: diagnosticMeta.markdownIndex,
          error: flattenDiagnosticMessage(diagnostic)
        });
        continue;
      }
    }

    failures.push({
      file: "docs-snippets",
      index: 0,
      error: flattenDiagnosticMessage(diagnostic)
    });
  }

  const report = {
    suite: "doc-snippets",
    timestamp: nowIso(),
    ok: failures.length === 0,
    filesScanned: markdownFiles.length,
    snippetsChecked: snippetMeta.length,
    failures
  };

  await writeJson(REPORT_PATH, report);

  if (report.ok) {
    return;
  }

  console.error(
    `Doc snippet check failed: ${String(report.failures.length)} failure(s) across ${String(report.snippetsChecked)} snippet(s).`
  );
  for (const failure of report.failures.slice(0, 20)) {
    console.error(`- ${failure.file}#${String(failure.index)}: ${failure.error}`);
  }
  if (report.failures.length > 20) {
    console.error(`... ${String(report.failures.length - 20)} additional failure(s) omitted`);
  }

  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
