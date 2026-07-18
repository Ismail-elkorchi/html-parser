export function collectDocSymbols(docJson) {
  if (!isRecord(docJson)) return [];
  if (Array.isArray(docJson.nodes)) return docJson.nodes.filter(isRecord);
  if (!isRecord(docJson.nodes)) return [];

  return Object.values(docJson.nodes).flatMap((moduleNode) => {
    if (!isRecord(moduleNode) || !Array.isArray(moduleNode.symbols)) return [];
    return moduleNode.symbols.filter(isRecord).map(normalizeSymbol);
  });
}

function normalizeSymbol(symbol) {
  if (!Array.isArray(symbol.declarations)) return symbol;
  const declarations = symbol.declarations.filter(isRecord);
  const declaration =
    declarations.find((candidate) => candidate.declarationKind === "export") ?? declarations[0];
  if (declaration === undefined) return symbol;
  return {
    name: symbol.name,
    jsDoc: declaration.jsDoc,
    functionDef: declaration.def ?? declaration.functionDef
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
