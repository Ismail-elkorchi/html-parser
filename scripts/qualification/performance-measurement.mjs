import process from "node:process";

/** Fixed collection policy shared by measurement and its report. */
export const PERFORMANCE_MEMORY_COLLECTION = Object.freeze({
  fullGcPasses: 8
});

/** Cohort sizes large enough to amortize fixed process-level parser work. */
export const PERFORMANCE_RETAINED_RESULT_COUNTS = Object.freeze({
  "parse-medium": 32,
  "parse-large": 8,
  "serialize-medium": 128,
  "serialize-large": 32
});

/** Returns heap usage after the qualification's fixed full-collection sequence. */
export function fullyCollectedHeapUsed() {
  if (typeof globalThis.gc !== "function") {
    throw new Error("Heap measurement requires --expose-gc");
  }
  let heapUsed = 0;
  for (
    let pass = 1;
    pass <= PERFORMANCE_MEMORY_COLLECTION.fullGcPasses;
    pass += 1
  ) {
    globalThis.gc();
    heapUsed = process.memoryUsage().heapUsed;
  }
  return {
    heapUsed,
    fullGcPasses: PERFORMANCE_MEMORY_COLLECTION.fullGcPasses
  };
}
