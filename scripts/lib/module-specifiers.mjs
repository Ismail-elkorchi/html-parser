import ts from "typescript";

function stringLiteralText(node) {
  return ts.isStringLiteralLike(node) ? node.text : null;
}

/** Returns syntactic module references without matching comments or strings. */
export function collectModuleSpecifiers(source, fileName = "module.ts") {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS
  );
  const references = [];

  function add(kind, node) {
    const specifier = stringLiteralText(node);
    if (specifier !== null) references.push(Object.freeze({ kind, specifier }));
  }

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      add("import", node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      add("export", node.moduleSpecifier);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const argument = node.arguments[0];
      if (argument !== undefined && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add("dynamic-import", argument);
      } else if (argument !== undefined &&
          ts.isIdentifier(node.expression) && node.expression.text === "require") {
        add("require", argument);
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add("import-type", node.argument.literal);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return Object.freeze(references);
}
