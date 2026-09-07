import type { ChildProcessWithoutNullStreams } from "node:child_process";

import {
  ACP_METHOD_NOT_FOUND_CODE,
  acpCancelNotification,
  acpDeclinePermission,
  acpInitializeRequest,
  acpNewSessionRequest,
  acpPermissionResult,
  acpPermissionSummary,
  acpPromptRequest,
  acpStopReasonDetail,
  acpTerminalStatus,
  asObject,
  optionalText,
  readAcpInitializeResult,
  readAcpPermissionRequest,
  readAcpSessionUpdate,
  readAcpStopReason,
  type AcpInitializeResult
} from "./acpProtocol.js";
import {
  JsonLineChannel,
  terminateProcessGroup,
  type JsonObject
} from "./jsonLineChannel.js";
import {
  ProviderDeliveryUnknownError,
  ProviderTurnRejectedError,
  type StructuredProviderProcessExit,
  type StructuredProviderSession,
  type StructuredProviderTurnInput,
  type StructuredProviderTurnReceipt,
  type StructuredProviderTurnTerminal
} from "./structuredProviderHost.js";

export type AcpSessionOpenInput = Readonly<{
  child: ChildProcessWithoutNullStreams;
  exit: Promise<StructuredProviderProcessExit>;
  processInstanceId: string;
  clientVersion: string;
  cwd: string;
  /** Present for resume; the Agent's own Session id from a previous launch. */
  nativeSessionId?: string;
  onTerminal?: (terminal: StructuredProviderTurnTerminal) => void;
  mirror: (stream: "stdout" | "stderr", text: string) => void;
}>;

/**
 * One Agent Client Protocol Session over an Agent's stdio.
 *
 * This class implements the protocol and nothing else. It never names a
 * product: which executable sits on the other end is a launch descriptor fact,
 * so a second ACP product reuses this code unchanged.
 *
 * Three identities are deliberately kept apart:
 *  - the JSON-RPC request id, which correlates one message pair on this pipe;
 *  - the Yui attemptId, which is the durable local request;
 *  - the ACP `sessionId`, which is the Agent's own native Session identity.
 *
 * ACP v1 defines no native *Turn* identity: a Turn is the `session/prompt`
 * request itself, and its response is that Turn's terminal. Yui therefore
 * reports no `nativeTurnId` for an ACP Turn rather than promoting a JSON-RPC
 * request id or minting a value no Agent would recognize.
 */
export class AcpStructuredProviderSession implements StructuredProviderSession {
  readonly adapterId = "acp" as const;
  readonly #pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  #sessionId = "";
  #negotiated: AcpInitializeResult | undefined;
  #nextRequestId = 1;
  #activeAttemptId: string | undefined;
  #promptRequestId: number | undefined;
  #cancelRequested = false;
  #closed: Error | undefined;

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly exit: Promise<StructuredProviderProcessExit>,
    readonly processInstanceId: string,
    private readonly channel: JsonLineChannel,
    private readonly onTerminal:
      ((terminal: StructuredProviderTurnTerminal) => void) | undefined,
    private readonly mirror: (stream: "stdout" | "stderr", text: string) => void
  ) {}

  static async open(input: AcpSessionOpenInput): Promise<AcpStructuredProviderSession> {
    const channel = new JsonLineChannel(input.child, input.mirror);
    const session = new AcpStructuredProviderSession(
      input.child,
      input.exit,
      input.processInstanceId,
      channel,
      input.onTerminal,
      input.mirror
    );
    channel.onMessage((message) => session.#receive(message));
    channel.onClose((error) => session.#fail(error));

    const negotiated = readAcpInitializeResult(
      await session.#request("initialize", acpInitializeRequest(input.clientVersion))
    );
    session.#negotiated = negotiated;
    session.#sessionId = input.nativeSessionId === undefined
      ? await session.#create(input.cwd)
      : await session.#restore(input.nativeSessionId, input.cwd, negotiated);
    return session;
  }

  /** Capabilities the Agent actually advertised during `initialize`. */
  get negotiated(): AcpInitializeResult {
    if (this.#negotiated === undefined) throw new Error("ACP Session is not initialized.");
    return this.#negotiated;
  }

  get conversationId(): string {
    return this.#sessionId;
  }

  get nativeSessionId(): string {
    return this.#sessionId;
  }

  get activeTurnId(): string | undefined {
    // ACP has no native Turn id. Returning the local attempt or a JSON-RPC
    // request id here would present a Yui-owned value as a Provider identity.
    return undefined;
  }

  async submitTurn(turn: StructuredProviderTurnInput): Promise<StructuredProviderTurnReceipt> {
    if (this.#activeAttemptId !== undefined) {
      throw new ProviderTurnRejectedError(
        "ACP Session already has an unsettled Turn.",
        turn.attemptId
      );
    }
    const requestId = this.#nextRequestId;
    this.#nextRequestId += 1;
    // Reserve before the pipe write: a fast Agent can answer before the write
    // callback runs, and an ambiguous write must retain the same occupancy so
    // that no successor input is bound to this slot.
    this.#activeAttemptId = turn.attemptId;
    this.#promptRequestId = requestId;
    this.#cancelRequested = false;
    try {
      await this.channel.send({
        jsonrpc: "2.0",
        id: requestId,
        method: "session/prompt",
        params: acpPromptRequest(this.#sessionId, turn.boundedText)
      });
    } catch (error) {
      throw new ProviderDeliveryUnknownError(
        `ACP prompt write did not complete: ${
          error instanceof Error ? error.message : String(error)
        }`,
        turn.attemptId,
        { cause: error }
      );
    }
    // ACP acknowledges a prompt only by eventually answering it: the response
    // *is* the terminal, which can be many minutes away. A completed write on
    // this dedicated Yui-owned pipe is therefore the exact acceptance boundary
    // available, and it is reported as transport acceptance rather than
    // claimed as a Provider acknowledgement.
    return Object.freeze({
      attemptId: turn.attemptId,
      conversationId: this.#sessionId,
      nativeSessionId: this.#sessionId,
      acceptedAt: new Date().toISOString(),
      acceptance: "transport"
    });
  }

  async steerTurn(turn: StructuredProviderTurnInput): Promise<StructuredProviderTurnReceipt> {
    throw new ProviderTurnRejectedError(
      "ACP v1 defines no mid-Turn steering: a Turn is one `session/prompt` request "
      + "and accepts no further input until it answers.",
      turn.attemptId
    );
  }

  async cancelTurn(attemptId: string): Promise<"requested" | "not-active" | "unknown"> {
    if (this.#activeAttemptId !== attemptId) return "not-active";
    try {
      await this.channel.send({
        jsonrpc: "2.0",
        method: "session/cancel",
        params: acpCancelNotification(this.#sessionId)
      });
    } catch {
      // A notification carries no acknowledgement, so a failed write leaves it
      // genuinely unknown whether the Agent ever saw the request.
      return "unknown";
    }
    this.#cancelRequested = true;
    // `session/cancel` requests a stop; it does not prove one. ACP requires
    // only that the Agent *answer* the prompt with `cancelled`, while halting
    // the underlying work is a SHOULD. The Turn settles on that answer.
    return "requested";
  }

  waitForExit(): Promise<StructuredProviderProcessExit> {
    return this.exit;
  }

  terminate(signal: NodeJS.Signals): void {
    terminateProcessGroup(this.child, signal);
  }

  async #create(cwd: string): Promise<string> {
    const result = asObject(await this.#request("session/new", acpNewSessionRequest(cwd)));
    const sessionId = result === null ? undefined : optionalText(result.sessionId);
    if (sessionId === undefined) throw new Error("ACP `session/new` returned no sessionId.");
    return sessionId;
  }

  /**
   * Reattach to an existing Agent Session. `session/load` is the only method
   * ACP defines for this, and it is gated by `agentCapabilities.loadSession`;
   * an Agent without it cannot restore the Conversation, and saying so is more
   * useful than silently starting a different Session under the old id.
   */
  async #restore(
    sessionId: string,
    cwd: string,
    negotiated: AcpInitializeResult
  ): Promise<string> {
    if (!negotiated.capabilities.loadSession) {
      throw new Error(
        "ACP Agent does not support `session/load` (agentCapabilities.loadSession is "
        + "false), so this native Session cannot be reattached. Start a new Session "
        + "explicitly instead."
      );
    }
    // `session/load` replays the whole Conversation as `session/update`
    // notifications before it answers. Those replays are history: the receive
    // path only settles a Turn from a `session/prompt` response, so replayed
    // content can never be mistaken for a new terminal.
    await this.#request("session/load", { sessionId, cwd, mcpServers: [] });
    return sessionId;
  }

  #request(method: string, params: JsonObject): Promise<unknown> {
    return new Promise<unknown>((resolvePromise, reject) => {
      if (this.#closed !== undefined) {
        reject(this.#closed);
        return;
      }
      const id = this.#nextRequestId;
      this.#nextRequestId += 1;
      this.#pending.set(id, { resolve: resolvePromise, reject });
      void this.channel.send({ jsonrpc: "2.0", id, method, params }).catch((error: unknown) => {
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  #receive(message: JsonObject): void {
    const method = optionalText(message.method);
    if (method === undefined) {
      this.#response(message);
      return;
    }
    if (message.id === undefined) this.#notification(method, message.params);
    else void this.#serve(method, message);
  }

  #response(message: JsonObject): void {
    const id = typeof message.id === "number" ? message.id : undefined;
    if (id === undefined) return;
    if (id === this.#promptRequestId) {
      this.#settlePrompt(message);
      return;
    }
    const waiter = this.#pending.get(id);
    if (waiter === undefined) return;
    this.#pending.delete(id);
    const error = asObject(message.error);
    if (error === null) {
      waiter.resolve(message.result);
      return;
    }
    waiter.reject(new Error(
      `ACP ${optionalText(error.message) ?? "request failed"}`
      + `${typeof error.code === "number" ? ` (code ${error.code})` : ""}`
    ));
  }

  /** A `session/prompt` response is the Turn's terminal; nothing else is. */
  #settlePrompt(message: JsonObject): void {
    const attemptId = this.#activeAttemptId;
    if (attemptId === undefined) return;
    this.#activeAttemptId = undefined;
    this.#promptRequestId = undefined;
    const cancelled = this.#cancelRequested;
    this.#cancelRequested = false;
    const base = {
      conversationId: this.#sessionId,
      nativeSessionId: this.#sessionId,
      // The exact local request this response answers. ACP publishes no native
      // Turn id, so `nativeTurnId` is absent rather than invented.
      attemptId,
      // The JSON-RPC id binds this response to this client's exact request.
      clientOwned: true,
      observedAt: new Date().toISOString()
    } as const;
    const error = asObject(message.error);
    if (error !== null) {
      this.onTerminal?.({
        ...base,
        status: cancelled ? "cancelled" : "failed",
        error: optionalText(error.message) ?? "ACP prompt failed.",
        rawError: JSON.stringify(error)
      });
      return;
    }
    const reason = readAcpStopReason(message.result);
    if (reason === undefined) {
      this.onTerminal?.({
        ...base,
        status: "failed",
        error: "ACP prompt response carried no recognized stopReason."
      });
      return;
    }
    const status = acpTerminalStatus(reason);
    this.onTerminal?.({
      ...base,
      status,
      ...(status === "completed" ? {} : { error: acpStopReasonDetail(reason) })
    });
  }

  #notification(method: string, params: unknown): void {
    if (method !== "session/update") return;
    const update = readAcpSessionUpdate(params, this.#sessionId);
    // Streamed content is Provider-visible progress, mirrored for the Turn
    // record. It never settles a Turn: only the prompt response does.
    if (update?.kind === "agent-message") this.mirror("stdout", update.text);
  }

  async #serve(method: string, message: JsonObject): Promise<void> {
    if (method === "session/request_permission") {
      const request = readAcpPermissionRequest(message.params);
      if (request === undefined) {
        await this.#reply(message.id, undefined, {
          code: ACP_METHOD_NOT_FOUND_CODE,
          message: "ACP permission request was malformed."
        });
        return;
      }
      // Yui carries no interactive consent on this transport. Declining is the
      // only answer that does not grant authority the user never gave.
      const decision = acpDeclinePermission(request);
      this.mirror("stderr", `${acpPermissionSummary(request, decision)}\n`);
      await this.#reply(message.id, acpPermissionResult(decision), undefined);
      return;
    }
    // Yui advertised no filesystem and no terminal capability, so such a call
    // is outside what this client agreed to serve. A method-not-found error is
    // the protocol's own way to say that plainly.
    await this.#reply(message.id, undefined, {
      code: ACP_METHOD_NOT_FOUND_CODE,
      message: `Yui does not implement ACP method ${method}.`
    });
  }

  async #reply(id: unknown, result: unknown, error: JsonObject | undefined): Promise<void> {
    if (typeof id !== "number" && typeof id !== "string") return;
    try {
      await this.channel.send({
        jsonrpc: "2.0",
        id,
        ...(error === undefined ? { result: result ?? {} } : { error })
      });
    } catch {
      // The pipe is gone; the closure path already reports that fact.
    }
  }

  #fail(error: Error): void {
    this.#closed = error;
    for (const [id, waiter] of [...this.#pending]) {
      this.#pending.delete(id);
      waiter.reject(error);
    }
    // A prompt in flight when the transport died has no known outcome: the
    // Agent may have completed the work or never started it. Emitting a
    // terminal here would record a result nobody observed, so the Turn is
    // deliberately left unsettled for recovery to resolve.
  }
}
