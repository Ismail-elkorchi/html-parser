import process from "node:process";

/** Fixed-point collection policy shared by measurement and its report. */
export const PERFORMANCE_MEMORY_COLLECTION = Object.freeze({
  minimumFullGcPasses: 3,
  maximumFullGcPasses: 8,
  heapStabilityBytes: 8_192
});

/** Returns heap usage after weak references and deferred garbage have settled. */
export function stabilizedHeapUsed() {
  if (typeof globalThis.gc !== "function") {
    throw new Error("Heap measurement requires --expose-gc");
  }
  let previous = Number.POSITIVE_INFINITY;
  let heapUsed = 0;
  for (
    let pass = 1;
    pass <= PERFORMANCE_MEMORY_COLLECTION.maximumFullGcPasses;
    pass += 1
  ) {
    globalThis.gc();
    heapUsed = process.memoryUsage().heapUsed;
    if (
      pass >= PERFORMANCE_MEMORY_COLLECTION.minimumFullGcPasses &&
      Math.abs(heapUsed - previous) <= PERFORMANCE_MEMORY_COLLECTION.heapStabilityBytes
    ) {
      return { heapUsed, fullGcPasses: pass };
    }
    previous = heapUsed;
  }
  return {
    heapUsed,
    fullGcPasses: PERFORMANCE_MEMORY_COLLECTION.maximumFullGcPasses
  };
}
