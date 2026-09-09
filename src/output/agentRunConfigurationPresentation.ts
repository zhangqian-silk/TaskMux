/**
 * Rendering what a live Agent reports about its own run configuration.
 *
 * The whole point of this display is to keep two things visibly apart that a
 * reader would otherwise merge: what the launch asked for, and what the Agent
 * says it is doing. So the confirmation strength is printed for every requested
 * value rather than summarized into a checkmark, and a value Yui could not
 * verify is labelled as such in the same column where a verified one would
 * appear. There is no state in which this renders a requested value as though
 * the Agent had agreed to it.
 */

import { renderTable, defaultTableWidth } from "./table.js";
import type { AgentHandshakeObservation } from "../executor/agentConfigurationCatalog.js";
import type {
  AgentRunConfigurationCurrentValue,
  AgentRunConfigurationObservation,
  AgentRunConfigurationRequest
} from "../runtime/agentRunConfiguration.js";

/**
 * The one handshake line, shared by every surface that has one to show.
 *
 * Both the capability catalog and a Session inspect display this same fact, and
 * a reader comparing them is entitled to assume the wording means the same thing
 * in both. One function is what guarantees that, in the same way one projection
 * function guarantees the two produce the same observation to begin with.
 *
 * `undefined` is the catalog's third state — no connection was attempted — and
 * is distinct from a plan that negotiates nothing.
 */
export function agentHandshakeLine(
  handshake: AgentHandshakeObservation | undefined
): string {
  if (handshake === undefined) {
    return "Agent handshake: not attempted (these values did not come from a live connection)";
  }
  if (handshake.status === "unsupported") {
    return `Agent handshake: unsupported (${handshake.reason})`;
  }
  return [
    `Agent handshake: protocol v${handshake.protocolVersion};`,
    ` reported as ${handshake.agentName} ${handshake.agentVersion};`,
    ` capabilities ${handshake.capabilities.join(", ") || "none"};`,
    // Method ids only. Which methods an Agent offers is a capability; any
    // credential or token that satisfies one is not Yui's to display.
    ` auth methods ${handshake.authMethods.join(", ") || "none"}`
  ].join("");
}

/**
 * The one-line form, for a status display that has a line to spare.
 *
 * Deliberately says which of the three "no value" answers applies instead of
 * printing a blank: a reader who sees nothing cannot tell whether Yui failed to
 * ask, the Agent has nothing to report, or the Agent reported a problem.
 */
export function agentRunConfigurationLabel(
  observation: AgentRunConfigurationObservation | undefined
): string {
  if (observation === undefined) return "not queried";
  if (observation.status === "unknown") return `unknown (${observation.reason})`;
  if (observation.status === "unsupported") return `unsupported (${observation.reason})`;
  const summary = observation.requested.length === 0
    ? "no configuration requested; the Agent's own defaults stand"
    : observation.requested
      .map((request) => `${request.field}=${requestValueLabel(request)}`)
      .join(", ");
  return `${summary}; read at ${observation.observedAt}`;
}

/**
 * The full form: one table for what was asked and one for what the Agent offers.
 *
 * Returns an empty string when there is nothing an Agent reported, so a caller
 * can append it unconditionally without producing an empty heading.
 */
export function renderAgentRunConfiguration(
  observation: AgentRunConfigurationObservation | undefined
): string {
  if (observation === undefined || observation.status !== "observed") return "";
  const sections: string[] = [];
  if (observation.requested.length > 0) {
    sections.push(renderTable(
      "Requested run configuration (launch-time confirmation)",
      [
        { header: "Field", minWidth: 10, maxWidth: 12 },
        { header: "Requested", minWidth: 12, maxWidth: 30 },
        { header: "Evidence", minWidth: 12, maxWidth: 14 },
        { header: "Agent reports now", minWidth: 16, maxWidth: 46 }
      ],
      observation.requested.map((request) => [
        request.field,
        request.value,
        confirmationLabel(request.confirmation),
        currentValueLabel(request.current, request.value)
      ]),
      defaultTableWidth()
    ));
  }
  if (observation.axes.length > 0) {
    sections.push(renderTable(
      "Agent-reported configuration options (Yui-supported axes)",
      [
        { header: "Option", minWidth: 10, maxWidth: 22 },
        { header: "Axis", minWidth: 8, maxWidth: 14 },
        { header: "Current", minWidth: 12, maxWidth: 40 },
        { header: "Offered", minWidth: 18, maxWidth: 44 }
      ],
      observation.axes.map((axis) => [
        axis.key,
        axis.category ?? "unnamed",
        axis.current.status === "observed"
          ? axis.current.value
          : `unobserved: ${axis.current.reason}`,
        axis.offered.join(", ") || "none reported"
      ]),
      defaultTableWidth()
    ));
  }
  sections.push(agentHandshakeLine(observation.handshake));
  sections.push(
    `Read from the live Session at ${observation.observedAt}. `
    + "Requests describe this connection's launch, not subsequent Role edits; "
    + "current values are the latest peer reports, not independent execution verification."
  );
  return sections.join("\n\n");
}

/** Spell out what each confirmation actually proves, in the table cell. */
function confirmationLabel(confirmation: AgentRunConfigurationRequest["confirmation"]): string {
  if (confirmation === "already") return "already set";
  if (confirmation === "observed") return "observed";
  return "ack only";
}

function requestValueLabel(request: AgentRunConfigurationRequest): string {
  if (request.current.status === "unobserved") return `${request.value} (unverified)`;
  return request.current.value === request.value
    ? request.value
    // Drift is the case this whole path exists to make visible, so it is stated
    // rather than resolved in favour of either value.
    : `${request.current.value} (requested ${request.value})`;
}

function currentValueLabel(
  current: AgentRunConfigurationCurrentValue,
  requested: string
): string {
  if (current.status === "unobserved") return `unobserved: ${current.reason}`;
  return current.value === requested
    ? current.value
    : `${current.value} — differs from the requested ${requested}`;
}
