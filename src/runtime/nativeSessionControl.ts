import { openCodexInteractiveConnection } from "./structuredProviderHost.js";
import { CodexAppServerRuntime, codexAppServerErrorIsMissing, codexClientInitialization } from "./codexAppServerRuntime.js";
import type { AgentHostLaunchPayload } from "./launchBroker.js";
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";

export type NativeControlConnection = Pick<AgentHostLaunchPayload, "command" | "args" | "environment" | "cwd">
  & Readonly<{ expectedAccountHome?: string }>;
type NativeControlChannel = Pick<Awaited<ReturnType<typeof openCodexInteractiveConnection>>,
  "request" | "notify" | "close">;

/** A disposable metadata/control client, not an Agent Session or a new Run.
 * Never calls thread/start, thread/resume or turn/start. A lost Host cannot be
 * the only way to stop an existing native execution. */
export async function stopCodexNativeSession(
  launch: NativeControlConnection,
  input: Readonly<{ conversationId: string; nativeTurnId?: string; clearGoal: boolean }>,
  connect: (launch: NativeControlConnection) => Promise<NativeControlChannel> = openCodexInteractiveConnection
): Promise<void> {
  const channel = await connect(launch);
  try {
    const initialized = await channel.request("initialize", codexClientInitialization());
    await channel.notify("initialized");
    if (launch.expectedAccountHome !== undefined && !isAbsolute(launch.expectedAccountHome)) {
      throw new Error("Recorded native account Home is invalid.");
    }
    const actualHome = typeof initialized.codexHome === "string" && isAbsolute(initialized.codexHome)
      ? initialized.codexHome : undefined;
    const sameAccount = launch.expectedAccountHome !== undefined && actualHome !== undefined
      && accountPath(launch.expectedAccountHome) === accountPath(actualHome);
    if (launch.expectedAccountHome !== undefined && actualHome !== undefined && !sameAccount) {
      throw new Error("Native recovery connected to a different account Home; restore the recorded connection.");
    }
    const runtime = new CodexAppServerRuntime(channel);
    const latestTurn = async () => {
      const page = await channel.request("thread/turns/list", {
        threadId: input.conversationId, limit: 1, sortDirection: "desc", itemsView: "notLoaded"
      });
      return Array.isArray(page.data) ? page.data[0] : undefined;
    };
    const read = async () => {
      try { return await runtime.readConversation(input.conversationId, { includeTurns: false }); }
      catch (error) {
        if (codexAppServerErrorIsMissing(error) && sameAccount) return null;
        throw error;
      }
    };
    let snapshot = await read();
    if (snapshot === null) return;
    if (input.clearGoal && await runtime.readGoal(input.conversationId) !== null) {
      await channel.request("thread/goal/clear", { threadId: input.conversationId });
    }
    let active = snapshot.activeTurnId ?? input.nativeTurnId;
    if (snapshot.status === "active" && active === undefined) {
      // Receipt loss does not justify loading an unbounded transcript or
      // guessing which Turn ran. Ask for one metadata-only native record.
      const latest = await latestTurn();
      if (latest?.status === "inProgress" && typeof latest.id === "string") active = latest.id;
    }
    if (snapshot.status === "active" && active !== undefined) {
      if (input.nativeTurnId !== undefined && snapshot.activeTurnId !== undefined && active !== input.nativeTurnId) {
        throw new Error("The native conversation has a different active Turn; inspect its owner before stopping it.");
      }
      const interrupted = await runtime.interruptTurn({ conversationId: input.conversationId, turnId: active });
      if (interrupted !== "interrupted") {
        snapshot = await read();
        if (snapshot?.status === "active") throw new Error("The exact native Turn could not be stopped; another execution may be active.");
      }
    }
    const deadline = Date.now() + 8000;
    for (;;) {
      snapshot = await read();
      if (snapshot === null || snapshot.status === "notLoaded") return;
      // A native error can leave the Thread in systemError after its Turn
      // failed. Prove the exact latest Turn is terminal, then drain any
      // background tools; the diagnostic label must not prevent replacement.
      const errorTurn = snapshot.status === "systemError" ? await latestTurn() : undefined;
      const erroredAndTerminal = errorTurn !== undefined && typeof errorTurn.id === "string"
        && ["completed", "failed", "interrupted"].includes(errorTurn.status);
      if (snapshot.status === "systemError" && !erroredAndTerminal) {
        throw new Error("Native systemError has no proven terminal latest Turn; inspect native execution before replacing it.");
      }
      if (snapshot.status === "idle" || erroredAndTerminal) {
        await channel.request("thread/backgroundTerminals/clean", { threadId: input.conversationId });
        const terminals = await channel.request("thread/backgroundTerminals/list", { threadId: input.conversationId, limit: 1 });
        if (Array.isArray(terminals.data) && terminals.data.length === 0 && terminals.nextCursor == null) return;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Native conversation ${input.conversationId} is not confirmed quiescent (${snapshot.status}).`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } finally { channel.close(); }
}

function accountPath(path: string): string {
  try { return realpathSync(path); } catch { return path; }
}
