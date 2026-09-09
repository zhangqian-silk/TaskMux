/**
 * Managed-runtime deadline hierarchy. Each outer boundary must outlive the
 * inner operation it awaits, with enough margin to persist observations and
 * return the enclosing acknowledgement.
 */
export const PROVIDER_ACCEPT_TIMEOUT_MS = 60_000;
const RUNTIME_ENVELOPE_MARGIN_MS = 15_000;
export const AGENT_HOST_CONTROL_TIMEOUT_MS =
  PROVIDER_ACCEPT_TIMEOUT_MS + RUNTIME_ENVELOPE_MARGIN_MS;
export const AGENT_HOST_READY_TIMEOUT_MS = AGENT_HOST_CONTROL_TIMEOUT_MS;
export const AGENT_HOST_LAUNCH_TICKET_TTL_MS = AGENT_HOST_READY_TIMEOUT_MS;
export const LIFECYCLE_REQUEST_TIMEOUT_MS =
  AGENT_HOST_CONTROL_TIMEOUT_MS + RUNTIME_ENVELOPE_MARGIN_MS;
export const CONTROLLER_SHUTDOWN_TIMEOUT_MS =
  LIFECYCLE_REQUEST_TIMEOUT_MS + RUNTIME_ENVELOPE_MARGIN_MS;
export const RELEASE_HANDOVER_OLD_OWNER_GRACE_MS =
  CONTROLLER_SHUTDOWN_TIMEOUT_MS + RUNTIME_ENVELOPE_MARGIN_MS;
export const RELEASE_HANDOVER_PROMOTION_TIMEOUT_MS =
  RELEASE_HANDOVER_OLD_OWNER_GRACE_MS + RUNTIME_ENVELOPE_MARGIN_MS;
/** Grace for an owned Provider client to exit after the Host asks it to stop. */
export const AGENT_HOST_CLIENT_EXIT_GRACE_MS = 10_000;
/**
 * Bounded wait for Endpoint implementation references to drain during shutdown.
 * Strictly inside the owned client's exit grace, so reporting the remaining
 * references never delays the Host past the point where it stops waiting for
 * that client. Expiry reports what is still in use; it never kills anything.
 */
export const ENDPOINT_DRAIN_TIMEOUT_MS = AGENT_HOST_CLIENT_EXIT_GRACE_MS / 2;
