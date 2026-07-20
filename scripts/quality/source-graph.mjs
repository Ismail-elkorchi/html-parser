import path from "node:path";

import { collectModuleSpecifiers } from "../lib/module-specifiers.mjs";

function sourceLayer(filePath) {
  if (filePath === "src/mod.ts") return "entrypoint";
  if (filePath.startsWith("src/public/")) return "public";
  if (filePath.startsWith("src/internal/foundation/")) return "foundation";
  if (filePath.startsWith("src/internal/encoding/")) return "encoding";
  if (filePath.startsWith("src/internal/html-engine/")) return "engine";
  if (filePath.startsWith("src/internal/")) return "internal";
  return "unknown";
}

function allowedDependency(from, to) {
  switch (from) {
    case "entrypoint": return to === "public";
    case "public": {
      return to === "public" || to === "foundation" || to === "encoding" || to === "engine";
    }
    case "engine": return to === "engine" || to === "foundation";
    case "encoding": return to === "encoding" || to === "foundation";
    case "foundation": return to === "foundation";
    case "internal": return to === "internal" || to === "foundation";
    case "unknown": return false;
  }
}

function resolveRelativeSpecifier(fromPath, specifier) {
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
  return resolved.endsWith(".js") ? `${resolved.slice(0, -3)}.ts` : resolved;
}

function findCycles(graph) {
  let nextIndex = 0;
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const cycles = [];

  function visit(filePath) {
    indices.set(filePath, nextIndex);
    lowLinks.set(filePath, nextIndex);
    nextIndex += 1;
    stack.push(filePath);
    onStack.add(filePath);

    for (const dependency of graph.get(filePath) ?? []) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(filePath, Math.min(lowLinks.get(filePath), lowLinks.get(dependency)));
      } else if (onStack.has(dependency)) {
        lowLinks.set(filePath, Math.min(lowLinks.get(filePath), indices.get(dependency)));
      }
    }

    if (lowLinks.get(filePath) !== indices.get(filePath)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      if (member === undefined) break;
      onStack.delete(member);
      component.push(member);
    } while (member !== filePath);
    if (component.length > 1 || (graph.get(filePath) ?? []).includes(filePath)) {
      cycles.push(Object.freeze(component.sort()));
    }
  }

  for (const filePath of graph.keys()) {
    if (!indices.has(filePath)) visit(filePath);
  }
  return Object.freeze(cycles.sort((left, right) => left[0].localeCompare(right[0])));
}

function unreachableFrom(graph, root) {
  if (!graph.has(root)) return Object.freeze([...graph.keys()].sort());
  const reachable = new Set([root]);
  const pending = [root];
  while (pending.length > 0) {
    const filePath = pending.pop();
    if (filePath === undefined) continue;
    for (const dependency of graph.get(filePath) ?? []) {
      if (reachable.has(dependency)) continue;
      reachable.add(dependency);
      pending.push(dependency);
    }
  }
  return Object.freeze([...graph.keys()].filter((filePath) =>
    !reachable.has(filePath)
  ).sort());
}

/** Analyzes the complete production source graph without relying on comments or text matches. */
export function analyzeSourceGraph(sources) {
  const sourceByPath = new Map(sources.map(({ filePath, source }) => [filePath, source]));
  const graph = new Map([...sourceByPath.keys()].map((filePath) => [filePath, []]));
  const unresolved = [];
  const externalReferences = [];
  const commonJsReferences = [];
  const layerViolations = [];
  const engineIngress = [];
  const generatedIngress = [];

  for (const [filePath, source] of sourceByPath) {
    for (const reference of collectModuleSpecifiers(source, filePath)) {
      if (reference.kind === "require") {
        commonJsReferences.push(Object.freeze({ filePath, specifier: reference.specifier }));
      }
      if (!reference.specifier.startsWith(".")) {
        externalReferences.push(Object.freeze({
          filePath,
          kind: reference.kind,
          specifier: reference.specifier
        }));
        continue;
      }
      const dependency = resolveRelativeSpecifier(filePath, reference.specifier);
      if (!sourceByPath.has(dependency)) {
        unresolved.push(Object.freeze({ filePath, specifier: reference.specifier, dependency }));
        continue;
      }
      graph.get(filePath)?.push(dependency);
      const fromLayer = sourceLayer(filePath);
      const toLayer = sourceLayer(dependency);
      if (!allowedDependency(fromLayer, toLayer)) {
        layerViolations.push(Object.freeze({ filePath, dependency, fromLayer, toLayer }));
      }
      if (toLayer === "engine" && fromLayer !== "engine") {
        engineIngress.push(Object.freeze({ filePath, dependency }));
      }
      if (dependency.startsWith("src/internal/html-engine/generated/")) {
        generatedIngress.push(Object.freeze({ filePath, dependency }));
      }
    }
  }

  return Object.freeze({
    files: sourceByPath.size,
    edges: [...graph.values()].reduce((total, dependencies) => total + dependencies.length, 0),
    unresolved: Object.freeze(unresolved),
    externalReferences: Object.freeze(externalReferences),
    commonJsReferences: Object.freeze(commonJsReferences),
    cycles: findCycles(graph),
    entrypointFound: graph.has("src/mod.ts"),
    unreachableFromEntrypoint: unreachableFrom(graph, "src/mod.ts"),
    layerViolations: Object.freeze(layerViolations),
    engineIngress: Object.freeze(engineIngress),
    generatedIngress: Object.freeze(generatedIngress)
  });
}
