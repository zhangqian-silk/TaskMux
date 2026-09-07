import type { WorkMailbox } from "../coordination/workMailbox.js";
import { usageError } from "../errors/cliError.js";
import {
  activeLiveRoleAgentSession,
  type RoleSessionSet
} from "../executor/agentExecutor.js";
import {
  hasRuntimeLifecycleWork,
  runtimeLifecycleTarget,
  type RuntimeLifecycleTarget,
  type RuntimeRoleOwner
} from "../runtime/lifecycleReservation.js";

export type RoleRuntimeGuardStore = Readonly<{
  getWorkMailbox(target: RuntimeLifecycleTarget): WorkMailbox | null;
}>;

/**
 * Explicit runtime cleanup is an ownership obligation for a Role
 * identity. Mutating or recreating that identity while either obligation is
 * queued can make the controller act on a different launch configuration.
 */
export function assertRoleRuntimeMutationAllowed(
  store: RoleRuntimeGuardStore,
  owner: RuntimeRoleOwner,
  action: string
): void {
  if (!hasRuntimeLifecycleWork(store.getWorkMailbox(runtimeLifecycleTarget(owner)))) return;
  throw usageError(
    `Role ${action} is blocked while a runtime lifecycle transition is pending or processing.`
  );
}

export const LIVE_SESSION_ACKNOWLEDGEMENT_OPTION = "--yes";

/**
 * A live native Session keeps the launch configuration it started with. Changing
 * the desired configuration is therefore a decision about the next Host
 * activation, and the Agent making the change is the one that knows whether the
 * running Session should keep going or be replaced. Report that fact once, here,
 * instead of refusing the Turn that later resumes the Session.
 */
export function assertLiveRoleSessionAcknowledged(input: Readonly<{
  sessions: RoleSessionSet | null;
  roleName: string;
  desiredRevision: number;
  acknowledged: boolean;
  stopCommand: string;
  /** True when the change makes the live Session unusable rather than lagging. */
  endsSession?: boolean;
}>): void {
  if (input.acknowledged) return;
  const session = activeLiveRoleAgentSession(input.sessions);
  if (session === null) return;
  throw usageError([
    input.endsSession === true
      ? `Role ${input.roleName} has a live native Session that cannot continue after this `
        + "change; its next Turn will need a new Session."
      : `Role ${input.roleName} has a live native Session, so this change applies to its `
        + "next Host process instead of the running one.",
    `  Agent: ${session.agentId} (${session.adapterId})`,
    `  Native Session: ${session.nativeSessionId}`,
    `  Session launched from desired revision r${session.effective.sourceDesiredRevision}; `
      + `current desired revision r${input.desiredRevision}`,
    `Re-run with ${LIVE_SESSION_ACKNOWLEDGEMENT_OPTION} to record the change and keep the Session.`,
    `Run \`${input.stopCommand}\` first to apply it to a fresh Session instead.`
  ].join("\n"));
}
