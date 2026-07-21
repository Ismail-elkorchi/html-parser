/** Expands reviewed known-difference groups into an exact per-engine case inventory. */
export function expandKnownDifferenceGroups(groups, engineNames) {
  if (!Array.isArray(groups)) {
    throw new Error("Document browser baseline requires reviewed known-difference groups");
  }
  const byEngine = new Map(engineNames.map((name) => [name, new Map()]));
  for (const group of groups) {
    if (typeof group?.classification !== "string" || group.classification.length === 0 ||
        typeof group.explanation !== "string" || group.explanation.length === 0 ||
        !Array.isArray(group.engines) || group.engines.length === 0) {
      throw new Error("Document browser baseline has an invalid known-difference classification");
    }
    if (group.caseIds !== undefined && !Array.isArray(group.caseIds)) {
      throw new Error("Document browser baseline has an invalid case-id inventory");
    }
    const caseIds = [...(group.caseIds ?? [])];
    if (group.caseIdPrefix !== undefined || group.caseNumbers !== undefined) {
      if (typeof group.caseIdPrefix !== "string" || !Array.isArray(group.caseNumbers)) {
        throw new Error("Document browser baseline has an invalid case-id expansion");
      }
      for (const caseNumber of group.caseNumbers) {
        if (!Number.isSafeInteger(caseNumber) || caseNumber < 1) {
          throw new Error("Document browser baseline case numbers must be positive integers");
        }
        caseIds.push(`${group.caseIdPrefix}${String(caseNumber)}`);
      }
    }
    if (caseIds.length === 0 || caseIds.some((id) => typeof id !== "string" || id.length === 0)) {
      throw new Error("Document browser baseline classification must identify every case");
    }
    if (new Set(group.engines).size !== group.engines.length) {
      throw new Error("Document browser baseline repeats an engine in one classification");
    }
    for (const engine of group.engines) {
      const inventory = byEngine.get(engine);
      if (inventory === undefined) {
        throw new Error(`Document browser baseline names unsupported engine ${String(engine)}`);
      }
      for (const id of caseIds) {
        if (inventory.has(id)) {
          throw new Error(`Document browser baseline classifies ${id} twice for ${engine}`);
        }
        inventory.set(id, Object.freeze({
          classification: group.classification,
          explanation: group.explanation
        }));
      }
    }
  }
  return byEngine;
}
