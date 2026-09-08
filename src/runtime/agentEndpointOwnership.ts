import { InstanceHost, type ImplementationRef } from "../kernel/instanceHost.js";
import {
  builtinAgentEndpointImplementation,
  requireBuiltinAgentEndpointImplementation
} from "./agentEndpointIdentity.js";
import {
  createAgentEndpointFactory,
  type AgentEndpoint,
  type AgentEndpointFactory,
  type OpenedAgentEndpoint
} from "./agentEndpoint.js";
import type { AgentHostLaunchPayload } from "./launchBroker.js";

/**
 * Which references still hold the implementation, as observed facts. A stop
 * request is not physical quiescence: `quiescent: false` reports what is still
 * running so the owner can wait, cancel or accept it explicitly. Nothing here
 * escalates to killing a Provider the Endpoint does not own.
 */
export type AgentEndpointDrain = Readonly<{
  quiescent: boolean;
  references: number;
  sessions: readonly Readonly<{
    nativeSessionId: string;
    processInstanceId: string;
    attachment: "attached" | "detach-requested" | "exited";
    cancellation: "not-requested" | "requested";
    /** An owned client exiting does not prove shared/native descendants stopped. */
    resources: "unknown";
    pending: readonly Readonly<{ attemptId: string; inputRef: string; status: string }>[];
  }>[];
}>;

/**
 * A Session's hold on one Endpoint code generation. Held across the Session's
 * Turns, not per call: a later Turn in the same Session keeps this exact
 * implementation even after a newer one is installed. Released when the Session
 * really ends, which is what lets the old generation finally dispose.
 */
export type AgentEndpointLease = Readonly<{
  implementation: ImplementationRef;
  open(payload: AgentHostLaunchPayload): Promise<OpenedAgentEndpoint>;
  resume(payload: AgentHostLaunchPayload): Promise<OpenedAgentEndpoint>;
  release(): Promise<void>;
}>;

/** One Session's hold, tracking the client it currently has attached. */
type SessionHold = { current?: AgentEndpoint };

/**
 * Process-local ownership of the Endpoint implementation this Agent Host is
 * executing. Reuses the one Instance Host primitive; it is not a second
 * registry, a capability directory or a durable reference table. The Controller
 * owns its own Host in its own process and never holds an Endpoint client, so
 * the reference facts for a Session live where the Session actually runs.
 *
 * Only the running code can be attached here. Selecting between generations is
 * the launch decision recorded in the durable Session; this owner proves the
 * chosen generation is really held and really released.
 */
export function createAgentEndpointOwner(
  factory: AgentEndpointFactory = createAgentEndpointFactory()
) {
  const host = new InstanceHost();
  const attached = new Map<string, ImplementationRef>();
  const live = new Map<string, Set<SessionHold>>();

  const implementationFor = (adapterId: string): ImplementationRef => {
    const current = builtinAgentEndpointImplementation(adapterId);
    const existing = attached.get(current.id);
    if (existing !== undefined) return existing;
    // The disposer owns the opener, not the clients: a Session's client is
    // terminated by that Session's detach. Dropping the opener stops a leaked
    // reference from starting new work on a generation that is already gone.
    const ref = host.attach<AgentEndpointFactory>(current, factory, [
      () => { live.delete(current.id); }
    ]);
    attached.set(current.id, ref);
    live.set(current.id, new Set());
    return ref;
  };

  /**
   * Pin the implementation for one Session. A pinned reference from the durable
   * Session must name this exact code; a mismatch is an explicit inability to
   * resume, never a silent start on a different generation.
   */
  const pin = (adapterId: string, pinned?: ImplementationRef): AgentEndpointLease => {
    if (pinned !== undefined) requireBuiltinAgentEndpointImplementation(adapterId, pinned);
    const ref = implementationFor(adapterId);
    const handle = host.acquire<AgentEndpointFactory>(ref);
    const holders = live.get(ref.id)!;
    // One entry per Session hold, reporting the client it currently has. A
    // Session may reattach a replacement client for the same conversation; that
    // succession is one hold, not two, so a drain never double-counts it.
    const holder: SessionHold = {};
    holders.add(holder);
    const track = async (opened: Promise<OpenedAgentEndpoint>): Promise<OpenedAgentEndpoint> => {
      const result = await opened;
      holder.current = result.session;
      void result.session.waitForExit().then(
        () => { if (holder.current === result.session) holder.current = undefined; },
        () => {}
      );
      return result;
    };
    let released = false;
    return Object.freeze({
      implementation: handle.implementation,
      open: (payload) => track(handle.value.open(payload)),
      resume: (payload) => track(handle.value.resume(payload)),
      release: async () => {
        if (released) return;
        released = true;
        holders.delete(holder);
        await handle.release();
      }
    });
  };

  /**
   * Ordinary stop: no new independent acquisition, while an already-acquired
   * Session ends bounded. Resolves with the drain facts once every reference is
   * released, or with what is still in use when the wait runs out.
   */
  const stop = async (adapterId: string, timeoutMs = 0): Promise<AgentEndpointDrain> => {
    const ref = attached.get(builtinAgentEndpointImplementation(adapterId).id);
    if (ref === undefined) return Object.freeze({ quiescent: true, references: 0, sessions: [] });
    // A disposer failure still ends acquisition; the drain facts below, not the
    // settle reason, decide whether this is actually quiescent.
    const drained = host.detach(ref).then(() => undefined, () => undefined);
    if (timeoutMs > 0) {
      // The timer must keep the process alive for the bounded window, or a
      // caller with nothing else pending would exit before reporting what is
      // still in use. Cleared as soon as the drain settles, so a released
      // implementation never delays shutdown until the deadline.
      let expire: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          drained,
          new Promise<void>((resolve) => { expire = setTimeout(resolve, timeoutMs); })
        ]);
      } finally {
        if (expire !== undefined) clearTimeout(expire);
      }
    } else {
      await Promise.resolve();
    }
    return inspect(adapterId);
  };

  /** Actual reference and request records, never a status label. */
  const inspect = (adapterId: string): AgentEndpointDrain => {
    const current = builtinAgentEndpointImplementation(adapterId);
    const instances = host.inspect(current.id);
    const references = instances.reduce((total, instance) => total + instance.references, 0);
    const sessions = [...live.get(current.id) ?? []].flatMap((holder) => {
      const endpoint = holder.current;
      // A hold between clients has nothing attached to report. Its hold is
      // still counted in `references`, so it cannot be mistaken for quiescence.
      if (endpoint === undefined) return [];
      const state = endpoint.inspect();
      return [Object.freeze({
        nativeSessionId: endpoint.nativeSessionId,
        processInstanceId: endpoint.processInstanceId,
        attachment: state.attachment,
        cancellation: state.cancellation,
        resources: state.resources,
        pending: Object.freeze(state.submissions
          .filter((submission) => submission.disposition.status === "pending"
            || submission.disposition.status === "unknown")
          .map((submission) => Object.freeze({
            attemptId: submission.attemptId,
            inputRef: submission.inputRef,
            status: submission.disposition.status
          })))
      })];
    });
    return Object.freeze({
      // Quiescent means nothing holds the implementation and no owned client is
      // still attached. A disposed instance reports no references, so an
      // unreleased Session or a live client keeps this false.
      quiescent: references === 0
        && sessions.every((session) => session.attachment === "exited" && session.pending.length === 0),
      references,
      sessions: Object.freeze(sessions)
    });
  };

  return Object.freeze({ pin, stop, inspect, close: () => host.close() });
}
