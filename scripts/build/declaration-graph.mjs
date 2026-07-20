import path from "node:path";

import { collectModuleSpecifiers } from "../eval/module-specifiers.mjs";

function declarationDependency(fromPath, specifier) {
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
  if (resolved.endsWith(".d.ts")) return resolved;
  if (resolved.endsWith(".ts") || resolved.endsWith(".js")) {
    return `${resolved.slice(0, -3)}.d.ts`;
  }
  return `${resolved}.d.ts`;
}

/** Finds the exact declaration closure consumed from one package root. */
export function analyzeDeclarationGraph(sources, root) {
  const reachable = new Set();
  const unresolved = [];
  const pending = sources.has(root) ? [root] : [];
  if (pending.length > 0) reachable.add(root);

  while (pending.length > 0) {
    const filePath = pending.pop();
    const source = filePath === undefined ? undefined : sources.get(filePath);
    if (filePath === undefined || source === undefined) continue;
    for (const { specifier } of collectModuleSpecifiers(source, filePath)) {
      if (!specifier.startsWith(".")) continue;
      const dependency = declarationDependency(filePath, specifier);
      if (!sources.has(dependency)) {
        unresolved.push(Object.freeze({ filePath, specifier, dependency }));
      } else if (!reachable.has(dependency)) {
        reachable.add(dependency);
        pending.push(dependency);
      }
    }
  }

  return Object.freeze({
    rootFound: sources.has(root),
    reachable: Object.freeze([...reachable].sort()),
    unresolved: Object.freeze(unresolved),
    unreachable: Object.freeze([...sources.keys()].filter((filePath) =>
      !reachable.has(filePath)
    ).sort())
  });
}
