import * as PublicApi from "../../../src/mod.js";

import type {
  InternalStateComponent,
  InternalStateErrorReason
} from "../../../src/internal/foundation/internal-state-error.js";

const reason: InternalStateErrorReason = "TOKENIZER_STATE_UNREACHABLE";
const component: InternalStateComponent = "tokenizer";
void reason;
void component;

// @ts-expect-error internal-state reasons form a closed union
const unknownReason: InternalStateErrorReason = "UNKNOWN_INTERNAL_STATE";
void unknownReason;

// @ts-expect-error private internal-state failures are not part of the public package surface
void PublicApi.InternalStateError;
