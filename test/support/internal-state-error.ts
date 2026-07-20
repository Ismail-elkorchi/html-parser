import type {
  InternalStateComponent,
  InternalStateErrorReason
} from "../../src/internal/foundation/internal-state-error.js";

export type ObservedInternalStateError = Error & {
  readonly code: "HTML_INTERNAL_STATE_ERROR";
  readonly component: InternalStateComponent;
  readonly reason: InternalStateErrorReason;
};

export function isInternalStateError(
  error: unknown,
  reason?: InternalStateErrorReason
): error is ObservedInternalStateError {
  return error instanceof Error &&
    error.name === "InternalStateError" &&
    "code" in error && error.code === "HTML_INTERNAL_STATE_ERROR" &&
    "component" in error && typeof error.component === "string" &&
    "reason" in error && typeof error.reason === "string" &&
    (reason === undefined || error.reason === reason);
}
