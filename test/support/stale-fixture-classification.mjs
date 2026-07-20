function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isStaleProcessingInstructionComment(token) {
  return Array.isArray(token) && token[0] === "Comment" &&
    typeof token[1] === "string" && token[1].startsWith("?");
}

function isCurrentProcessingInstruction(token) {
  return Array.isArray(token) && token[0] === "ProcessingInstruction";
}

/**
 * Recognizes only the obsolete comment-token expectation replaced by the
 * current HTML processing-instruction states. Other differences remain hard
 * failures even when the input also contains `<?`.
 */
export function isStaleTokenizerProcessingInstructionExpectation(
  input,
  expectedTokens,
  actualTokens,
  errors
) {
  if (!input.includes("<?")) return false;
  const expectedWithoutStaleComments = expectedTokens.filter(
    (token) => !isStaleProcessingInstructionComment(token)
  );
  const actualWithoutProcessingInstructions = actualTokens.filter(
    (token) => !isCurrentProcessingInstruction(token)
  );
  const removedStaleComment = expectedWithoutStaleComments.length < expectedTokens.length;
  const observedCurrentBehavior = actualWithoutProcessingInstructions.length < actualTokens.length ||
    errors.some((error) => String(error.code).includes("processing-instruction"));
  return removedStaleComment && observedCurrentBehavior &&
    sameValue(expectedWithoutStaleComments, actualWithoutProcessingInstructions);
}

function withoutStaleProcessingInstructionComments(tree) {
  return tree.split("\n").filter((line) => !/^\|\s*<!-- \?.* -->$/.test(line)).join("\n");
}

function withoutCurrentProcessingInstructions(tree) {
  return tree.split("\n").filter((line) => !/^\|\s*<\?.*\?>$/.test(line)).join("\n");
}

/** Recognizes the equivalent obsolete tree-fixture comment expectation. */
export function isStaleTreeProcessingInstructionExpectation(
  input,
  expectedTree,
  actualTree,
  errors
) {
  if (!input.includes("<?")) return false;
  const expectedWithoutStaleComments = withoutStaleProcessingInstructionComments(expectedTree);
  const actualWithoutProcessingInstructions = withoutCurrentProcessingInstructions(actualTree);
  const removedStaleComment = expectedWithoutStaleComments !== expectedTree;
  const observedCurrentBehavior = actualWithoutProcessingInstructions !== actualTree ||
    errors.some((error) => String(error.code).includes("processing-instruction"));
  return removedStaleComment && observedCurrentBehavior &&
    expectedWithoutStaleComments === actualWithoutProcessingInstructions;
}
