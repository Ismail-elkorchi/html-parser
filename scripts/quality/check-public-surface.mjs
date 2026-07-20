import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const ROOT_SOURCE = resolve("src/mod.ts");
const JSR_SOURCE = resolve("jsr/mod.ts");
const JSR_CONSUMER = resolve("test/fixtures/consumers/jsr.ts");
const NPM_DECLARATION = resolve("dist/mod.d.ts");

function moduleInventory(program, filePath) {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(filePath);
  if (!source) throw new Error(`public surface: missing source ${filePath}`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`public surface: missing module symbol ${filePath}`);
  return new Map(checker.getExportsOfModule(moduleSymbol).map((symbol) => {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const hasType = (target.flags & ts.SymbolFlags.Type) !== 0;
    const hasValue = (target.flags & ts.SymbolFlags.Value) !== 0;
    const kind = hasType && hasValue ? "type+value" : hasType ? "type" : hasValue ? "value" : "other";
    return [symbol.getName(), kind];
  }).sort(([left], [right]) => left.localeCompare(right)));
}

function compareInventories(label, expected, actual, issues) {
  for (const [name, kind] of expected) {
    const actualKind = actual.get(name);
    if (actualKind === undefined) issues.push(`${label}: missing ${kind} export ${name}`);
    else if (actualKind !== kind) issues.push(`${label}: ${name} is ${actualKind}, expected ${kind}`);
  }
  for (const [name, kind] of actual) {
    if (!expected.has(name)) issues.push(`${label}: unexpected ${kind} export ${name}`);
  }
}

function exportedDeclarations(source) {
  return source.statements.filter((statement) => {
    if (!(
      ts.isClassDeclaration(statement) ||
      ts.isFunctionDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isVariableStatement(statement)
    )) return false;
    return statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
  });
}

const sourceProgram = ts.createProgram([ROOT_SOURCE, JSR_SOURCE, JSR_CONSUMER], {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
  allowImportingTsExtensions: true,
  noEmit: true,
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  useUnknownInCatchVariables: true,
  noImplicitOverride: true,
  noImplicitReturns: true,
  noFallthroughCasesInSwitch: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  skipLibCheck: false,
  types: []
});
const declarationProgram = ts.createProgram([NPM_DECLARATION], {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
  noEmit: true,
  skipLibCheck: false,
  types: []
});

const diagnostics = [
  ...ts.getPreEmitDiagnostics(sourceProgram),
  ...ts.getPreEmitDiagnostics(declarationProgram)
];
if (diagnostics.length > 0) {
  const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n"
  });
  throw new Error(`public surface: TypeScript diagnostics\n${formatted}`);
}

const canonical = moduleInventory(sourceProgram, ROOT_SOURCE);
const jsr = moduleInventory(sourceProgram, JSR_SOURCE);
const npm = moduleInventory(declarationProgram, NPM_DECLARATION);
const issues = [];
compareInventories("JSR", canonical, jsr, issues);
compareInventories("npm declaration", canonical, npm, issues);

const jsrFile = sourceProgram.getSourceFile(JSR_SOURCE);
if (!jsrFile) throw new Error("public surface: JSR source disappeared");
const duplicatedDeclarations = exportedDeclarations(jsrFile);
if (duplicatedDeclarations.length > 0) {
  issues.push(`JSR: contains ${String(duplicatedDeclarations.length)} manual exported declaration(s)`);
}

const nodeRuntime = Object.keys(await import(pathToFileURL(resolve("dist/mod.js")).href)).sort();
const denoRuntime = JSON.parse(execFileSync(
  "deno",
  [
    "eval",
    "--sloppy-imports",
    'import * as api from "./jsr/mod.ts"; console.log(JSON.stringify(Object.keys(api).sort()));'
  ],
  { encoding: "utf8" }
));
if (JSON.stringify(nodeRuntime) !== JSON.stringify(denoRuntime)) {
  issues.push(`runtime: Node=${nodeRuntime.join(",")} JSR=${denoRuntime.join(",")}`);
}

const apiDocumentation = readFileSync("docs/api.md", "utf8");
for (const name of canonical.keys()) {
  if (!apiDocumentation.includes(`\`${name}`)) {
    issues.push(`docs/api.md: missing ${name}`);
  }
}

if (issues.length > 0) {
  process.stderr.write("public surface qualification failed\n");
  for (const issue of issues) process.stderr.write(`- ${issue}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `public surface: ${String(canonical.size)} canonical exports match npm, JSR, runtime, and docs\n`
  );
}
