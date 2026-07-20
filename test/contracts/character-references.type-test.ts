import {
  CharacterReferenceConsumer,
  type CharacterReferenceResult
} from "../../src/internal/html-engine/character-reference-consumer.js";
import { HtmlInputCursor } from "../../src/internal/html-engine/input-cursor.js";
import { createEngineResourceGuard } from "../../src/internal/html-engine/resource-guard.js";

const guard = createEngineResourceGuard();
const cursor = new HtmlInputCursor(guard);
cursor.write("&amp;");
cursor.consume();
const consumer = new CharacterReferenceConsumer(cursor, guard, {
  context: "attribute",
  ampersandSpan: { startUtf16Offset: 0, endUtf16Offset: 1 },
  additionalAllowedCharacter: "\""
});
const result: CharacterReferenceResult = consumer.step();
if (result.kind === "resolved") {
  const source: "named" | "numeric" = result.source;
  void source;
  // @ts-expect-error completed results are immutable
  result.value = "changed";
} else if (result.kind === "literal") {
  const consumed: number = result.consumedUtf16;
  void consumed;
} else {
  const offset: number = result.position.utf16Offset;
  void offset;
}

// @ts-expect-error context is a closed internal union
new CharacterReferenceConsumer(cursor, guard, { context: "rcdata", ampersandSpan: { startUtf16Offset: 0, endUtf16Offset: 1 } });

// @ts-expect-error lookahead distance must be a number
cursor.peekCodeUnit("1");
