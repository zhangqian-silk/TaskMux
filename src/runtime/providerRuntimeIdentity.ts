export type ProviderConversationRecoverability = "unknown" | "recoverable" | "unrecoverable";
export type ProviderConversationStatus = "current" | "superseded";
export type ProviderAuthorityOwner = "controller" | "human" | "none" | "unknown";
export type ProviderTurnStatus =
  | "submitting"
  | "accepted"
  | "completed"
  | "failed"
  | "cancelled"
  | "rejected"
  | "delivery-unknown";

export type ProviderGoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "usage-limited"
  | "budget-limited"
  | "complete";

/** Provider-native Session intent. It is independent from Turn and Task completion. */
export type ProviderGoal = Readonly<{
  status: ProviderGoalStatus;
  objective: string;
  updatedAt: string;
  nativeTurnId?: string;
  tokenBudget?: number;
}>;

export type ProviderConversation = Readonly<{
  conversationId: string;
  epoch: number;
  status: ProviderConversationStatus;
  recoverability: ProviderConversationRecoverability;
  createdAt: string;
  supersededAt?: string;
}>;

/**
 * One monotonically fenced writer authority for the current Conversation.
 * It is deliberately independent from the Provider process: a human may take
 * over the same Conversation without replacing its identity.
 */
export type ProviderAuthority = Readonly<{
  epoch: number;
  owner: ProviderAuthorityOwner;
  holderId?: string;
  changedAt: string;
}>;

export type ProviderTurn = Readonly<{
  /** Optional correlation for the durable Yui Turn record. */
  turnId?: string;
  attemptId: string;
  authorityEpoch: number;
  status: ProviderTurnStatus;
  submittedAt: string;
  updatedAt: string;
  nativeTurnId?: string;
  terminalReason?: string;
}>;

export type ProviderRuntimeBinding = Readonly<{
  schemaVersion: 5;
  providerNamespace: string;
  accountScope: string;
  currentConversationEpoch: number;
  conversations: readonly ProviderConversation[];
  authority: ProviderAuthority;
  turn: ProviderTurn | null;
  goal: ProviderGoal | null;
}>;

export function createProviderRuntimeBinding(input: Readonly<{
  providerNamespace: string;
  accountScope: string;
  conversationId: string;
  startedAt: string;
}>): ProviderRuntimeBinding {
  const startedAt = timestamp(input.startedAt, "Provider Conversation startedAt");
  return validateProviderRuntimeBinding({
    schemaVersion: 5,
    providerNamespace: identity(input.providerNamespace, "Provider namespace"),
    accountScope: identity(input.accountScope, "Provider account scope"),
    currentConversationEpoch: 1,
    conversations: [{
      conversationId: identity(input.conversationId, "Provider Conversation id"),
      epoch: 1,
      status: "current",
      recoverability: "unknown",
      createdAt: startedAt
    }],
    authority: {
      epoch: 1,
      owner: "controller",
      holderId: "controller",
      changedAt: startedAt
    },
    turn: null,
    goal: null
  });
}

export function updateProviderGoal(
  raw: ProviderRuntimeBinding,
  goal: ProviderGoal
): ProviderRuntimeBinding {
  const binding = validateProviderRuntimeBinding(raw);
  const normalized = validateProviderGoal(goal);
  return validateProviderRuntimeBinding({ ...binding, goal: normalized });
}

export function clearProviderGoal(
  raw: ProviderRuntimeBinding
): ProviderRuntimeBinding {
  const binding = validateProviderRuntimeBinding(raw);
  return binding.goal === null
    ? binding
    : validateProviderRuntimeBinding({ ...binding, goal: null });
}

/** Only active means the Provider is expected to continue autonomously. */
export function providerGoalContinues(goal: ProviderGoal | null | undefined): boolean {
  return goal?.status === "active";
}

export function currentProviderAuthority(binding: ProviderRuntimeBinding): ProviderAuthority {
  return validateProviderRuntimeBinding(binding).authority;
}

export function currentProviderConversation(
  binding: ProviderRuntimeBinding
): ProviderConversation {
  validateProviderRuntimeBinding(binding);
  return binding.conversations.find((entry) => (
    entry.epoch === binding.currentConversationEpoch && entry.status === "current"
  ))!;
}

/**
 * Compare-and-swap the only Provider writer. A stale Controller or detached
 * terminal cannot regain authority with an older epoch.
 */
export function transferProviderAuthority(
  raw: ProviderRuntimeBinding,
  input: Readonly<{
    expectedEpoch: number;
    expectedOwner: ProviderAuthorityOwner;
    owner: "controller" | "human" | "none";
    holderId?: string;
    changedAt: string;
  }>
): ProviderRuntimeBinding {
  const binding = validateProviderRuntimeBinding(raw);
  if (binding.authority.epoch !== input.expectedEpoch
    || binding.authority.owner !== input.expectedOwner) {
    throw new Error("Provider authority fence is stale.");
  }
  if (providerTurnIsActive(binding.turn)) {
    throw new Error("Provider authority cannot transfer while a Turn is unsettled.");
  }
  const changedAt = timestamp(input.changedAt, "Provider authority changedAt");
  if (Date.parse(changedAt) < Date.parse(binding.authority.changedAt)) {
    throw new Error("Provider authority changedAt moved backwards.");
  }
  let holderId: string | undefined;
  if (input.owner === "none") {
    if (input.holderId !== undefined) {
      throw new Error("Unowned Provider authority cannot name a holder.");
    }
  } else {
    holderId = identity(input.holderId!, "Provider authority holder id");
    if (input.owner === "controller" && holderId !== "controller") {
      throw new Error("Controller authority must name the Controller.");
    }
  }
  return validateProviderRuntimeBinding({
    ...binding,
    authority: {
      epoch: binding.authority.epoch + 1,
      owner: input.owner,
      ...(holderId === undefined ? {} : { holderId }),
      changedAt
    }
  });
}

export function beginProviderTurn(
  raw: ProviderRuntimeBinding,
  input: Readonly<{
    turnId?: string;
    attemptId: string;
    authorityEpoch: number;
    submittedAt: string;
  }>
): ProviderRuntimeBinding {
  const binding = validateProviderRuntimeBinding(raw);
  const attemptId = identity(input.attemptId, "Provider input attempt id");
  const turnId = input.turnId === undefined ? undefined : identity(input.turnId, "Turn id");
  const currentTurn = binding.turn;
  if (currentTurn !== null
    && currentTurn.turnId === turnId
    && currentTurn.attemptId === attemptId
    && currentTurn.authorityEpoch === input.authorityEpoch
    && currentTurn.status === "submitting") {
    return binding;
  }
  if (binding.authority.epoch !== input.authorityEpoch
    || binding.authority.owner === "none"
    || binding.authority.owner === "unknown") {
    throw new Error("Provider Turn authority fence is stale.");
  }
  if (providerTurnIsActive(binding.turn)) {
    throw new Error("Provider Conversation already has an unsettled Turn.");
  }
  const submittedAt = timestamp(input.submittedAt, "Provider Turn submittedAt");
  return validateProviderRuntimeBinding({
    ...binding,
    turn: {
      ...(turnId === undefined ? {} : { turnId }),
      attemptId,
      authorityEpoch: input.authorityEpoch,
      status: "submitting",
      submittedAt,
      updatedAt: submittedAt
    }
  });
}

export function acceptProviderTurn(
  raw: ProviderRuntimeBinding,
  input: Readonly<{ attemptId: string; nativeTurnId?: string; acceptedAt: string }>
): ProviderRuntimeBinding {
  const binding = validateProviderRuntimeBinding(raw);
  const attemptId = identity(input.attemptId, "Provider input attempt id");
  const turn = binding.turn;
  if (turn === null || turn.attemptId !== attemptId
    || (turn.status !== "submitting" && turn.status !== "delivery-unknown")) {
    throw new Error("Provider Turn does not match an acceptable delivery state.");
  }
  const acceptedAt = orderedTurnTimestamp(turn, input.acceptedAt, "Provider Turn acceptedAt");
  return validateProviderRuntimeBinding({
    ...binding,
    turn: {
      ...turn,
      status: "accepted",
      ...(input.nativeTurnId === undefined
        ? {}
        : { nativeTurnId: identity(input.nativeTurnId, "Provider native Turn id") }),
      updatedAt: acceptedAt
    }
  });
}

export function markProviderTurnDeliveryUnknown(
  raw: ProviderRuntimeBinding,
  input: Readonly<{ attemptId: string; observedAt: string; reason: string }>
): ProviderRuntimeBinding {
  const binding = validateProviderRuntimeBinding(raw);
  const turn = requireProviderTurn(binding, input.attemptId, "submitting");
  const observedAt = orderedTurnTimestamp(turn, input.observedAt, "Provider Turn unknownAt");
  return validateProviderRuntimeBinding({
    ...binding,
    turn: {
      ...turn,
      status: "delivery-unknown",
      terminalReason: identity(input.reason, "Provider Turn unknown reason"),
      updatedAt: observedAt
    }
  });
}

/** Exact negative acknowledgement before a Provider Turn identity existed. */
export function rejectProviderTurn(
  raw: ProviderRuntimeBinding,
  input: Readonly<{ attemptId: string; rejectedAt: string; reason: string }>
): ProviderRuntimeBinding {
  const binding = validateProviderRuntimeBinding(raw);
  const turn = binding.turn;
  if (turn === null || turn.attemptId !== identity(input.attemptId, "Provider input attempt id")
    || (turn.status !== "submitting" && turn.status !== "delivery-unknown")) {
    throw new Error("Provider Turn does not match a rejectable delivery state.");
  }
  const rejectedAt = orderedTurnTimestamp(turn, input.rejectedAt, "Provider Turn rejectedAt");
  return validateProviderRuntimeBinding({
    ...binding,
    turn: {
      ...turn,
      status: "rejected",
      terminalReason: identity(input.reason, "Provider Turn rejection reason"),
      updatedAt: rejectedAt
    }
  });
}

/** Resolves an Agent Host submission; an unknown delivery may later gain exact negative evidence. */
export function settleProviderTurnSubmission(
  raw: ProviderRuntimeBinding,
  input: Readonly<{
    attemptId: string;
    status: "rejected" | "delivery-unknown";
    reason: string;
    resolvedAt: string;
  }>
): ProviderRuntimeBinding {
  const binding = validateProviderRuntimeBinding(raw);
  const attemptId = identity(input.attemptId, "Provider input attempt id");
  if (binding.turn?.attemptId !== attemptId) {
    throw new Error("Provider Turn does not match a resolvable delivery state.");
  }
  if (binding.turn.status === input.status) return binding;
  if (
    binding.turn.status !== "submitting"
    && !(binding.turn.status === "delivery-unknown" && input.status === "rejected")
  ) {
    throw new Error("Provider Turn does not match a resolvable delivery state.");
  }
  return input.status === "delivery-unknown"
    ? markProviderTurnDeliveryUnknown(binding, {
        attemptId,
        observedAt: input.resolvedAt,
        reason: input.reason
      })
    : rejectProviderTurn(binding, {
        attemptId,
        rejectedAt: input.resolvedAt,
        reason: input.reason
      });
}

export function settleProviderTurn(
  raw: ProviderRuntimeBinding,
  input: Readonly<{
    nativeTurnId?: string;
    attemptId?: string;
    status: "completed" | "failed" | "cancelled";
    settledAt: string;
    reason?: string;
  }>
): ProviderRuntimeBinding {
  const binding = validateProviderRuntimeBinding(raw);
  const turn = binding.turn;
  const nativeTurnId = input.nativeTurnId === undefined
    ? undefined : identity(input.nativeTurnId, "Provider native Turn id");
  if (turn === null
    || (input.attemptId === undefined
      ? nativeTurnId === undefined || turn.nativeTurnId !== nativeTurnId
      : turn.attemptId !== input.attemptId)
    || (turn.nativeTurnId !== undefined && nativeTurnId !== undefined
      && turn.nativeTurnId !== nativeTurnId)
    || turn.status !== "accepted") {
    throw new Error("Provider Turn settlement does not match the current Turn.");
  }
  const settledAt = orderedTurnTimestamp(turn, input.settledAt, "Provider Turn settledAt");
  return validateProviderRuntimeBinding({
    ...binding,
    turn: {
      ...turn,
      ...(nativeTurnId === undefined ? {} : { nativeTurnId }),
      status: input.status,
      updatedAt: settledAt,
      ...(input.reason === undefined
        ? {}
        : { terminalReason: identity(input.reason, "Provider Turn terminal reason") })
    }
  });
}

export function updateProviderConversationRecoverability(
  raw: ProviderRuntimeBinding,
  recoverability: ProviderConversationRecoverability
): ProviderRuntimeBinding {
  const binding = validateProviderRuntimeBinding(raw);
  const current = currentProviderConversation(binding);
  return validateProviderRuntimeBinding({
    ...binding,
    conversations: binding.conversations.map((entry) => entry.epoch === current.epoch
      ? { ...entry, recoverability }
      : entry)
  });
}

/** Shared pre-start and commit guard for explicit native Conversation replacement. */
export function assertProviderConversationReplaceable(raw: ProviderRuntimeBinding): void {
  const binding = validateProviderRuntimeBinding(raw);
  if (providerTurnIsActive(binding.turn)) {
    throw new Error(
      `Provider Conversation replacement cannot discard unsettled input attempt ${
        binding.turn!.attemptId
      } (${binding.turn!.status}). Resolve its actual outcome before selecting a new Conversation.`
    );
  }
}

export function supersedeProviderConversation(
  raw: ProviderRuntimeBinding,
  input: Readonly<{
    conversationId: string;
    switchedAt: string;
    basis: "terminal-session";
  }>
): ProviderRuntimeBinding {
  const binding = validateProviderRuntimeBinding(raw);
  const current = currentProviderConversation(binding);
  if (input.basis !== "terminal-session") {
    throw new Error("Provider Conversation replacement basis is invalid.");
  }
  assertProviderConversationReplaceable(binding);
  const switchedAt = timestamp(input.switchedAt, "Provider Conversation replacement timestamp");
  const epoch = current.epoch + 1;
  return validateProviderRuntimeBinding({
    ...binding,
    currentConversationEpoch: epoch,
    conversations: [
      ...binding.conversations.map((entry) => entry.epoch === current.epoch
        ? { ...entry, status: "superseded" as const, supersededAt: switchedAt }
        : entry),
      {
        conversationId: identity(input.conversationId, "Provider Conversation id"),
        epoch,
        status: "current",
        recoverability: "unknown",
        createdAt: switchedAt
      }
    ],
    authority: {
      epoch: binding.authority.epoch + 1,
      owner: "controller",
      holderId: "controller",
      changedAt: switchedAt
    },
    goal: null
  });
}

export function validateProviderRuntimeBinding(value: ProviderRuntimeBinding): ProviderRuntimeBinding {
  if (value.schemaVersion !== 5) throw new Error("Provider Runtime Binding schemaVersion must be 5.");
  identity(value.providerNamespace, "Provider namespace");
  identity(value.accountScope, "Provider account scope");
  integer(value.currentConversationEpoch, 1, "Current Provider Conversation epoch");
  if (!Array.isArray(value.conversations) || value.conversations.length === 0) {
    throw new Error("Provider Runtime Binding requires a Conversation.");
  }
  const conversationIds = new Set<string>();
  const epochs = new Set<number>();
  let currentCount = 0;
  for (const conversation of value.conversations) {
    identity(conversation.conversationId, "Provider Conversation id");
    integer(conversation.epoch, 1, "Provider Conversation epoch");
    if (conversationIds.has(conversation.conversationId) || epochs.has(conversation.epoch)) {
      throw new Error("Provider Runtime Binding contains duplicate Conversation identity.");
    }
    conversationIds.add(conversation.conversationId);
    epochs.add(conversation.epoch);
    if (conversation.status !== "current" && conversation.status !== "superseded") {
      throw new Error("Provider Conversation status is invalid.");
    }
    if (!["unknown", "recoverable", "unrecoverable"].includes(conversation.recoverability)) {
      throw new Error("Provider Conversation recoverability is invalid.");
    }
    timestamp(conversation.createdAt, "Provider Conversation createdAt");
    if (conversation.status === "current") {
      currentCount += 1;
      if (conversation.epoch !== value.currentConversationEpoch) {
        throw new Error("Current Provider Conversation epoch is inconsistent.");
      }
      if (conversation.supersededAt !== undefined) {
        throw new Error("Current Provider Conversation cannot be superseded.");
      }
    } else if (conversation.supersededAt === undefined) {
      throw new Error("Superseded Provider Conversation requires supersededAt.");
    } else {
      timestamp(conversation.supersededAt, "Provider Conversation supersededAt");
    }
  }
  if (currentCount !== 1) throw new Error("Provider Runtime Binding requires one current Conversation.");
  integer(value.authority.epoch, 1, "Provider authority epoch");
  timestamp(value.authority.changedAt, "Provider authority changedAt");
  if (!["controller", "human", "none", "unknown"].includes(value.authority.owner)) {
    throw new Error("Provider authority owner is invalid.");
  }
  if (value.authority.owner === "controller" || value.authority.owner === "human") {
    const holderId = identity(value.authority.holderId!, "Provider authority holder id");
    if (value.authority.owner === "controller" && holderId !== "controller") {
      throw new Error("Controller authority must name the Controller.");
    }
  } else if (value.authority.holderId !== undefined) {
    throw new Error("Unowned or unknown Provider authority cannot name a holder.");
  }
  if (!Object.hasOwn(value, "turn")) throw new Error("Provider Runtime Binding requires Turn state.");
  if (value.turn !== null) {
    validateProviderTurn(value.turn, value.authority.epoch);
  }
  if (!Object.hasOwn(value, "goal")) throw new Error("Provider Runtime Binding requires Goal state.");
  if (value.goal !== null) validateProviderGoal(value.goal);
  return value;
}

function validateProviderGoal(goal: ProviderGoal): ProviderGoal {
  if (![
    "active",
    "paused",
    "blocked",
    "usage-limited",
    "budget-limited",
    "complete"
  ].includes(goal.status)) {
    throw new Error("Provider Goal status is invalid.");
  }
  const normalized: ProviderGoal = {
    status: goal.status,
    objective: identity(goal.objective, "Provider Goal objective"),
    updatedAt: timestamp(goal.updatedAt, "Provider Goal updatedAt"),
    ...(goal.nativeTurnId === undefined
      ? {}
      : { nativeTurnId: identity(goal.nativeTurnId, "Provider Goal native Turn id") }),
    ...(goal.tokenBudget === undefined
      ? {}
      : { tokenBudget: integer(goal.tokenBudget, 1, "Provider Goal token budget") })
  };
  return Object.freeze(normalized);
}

function validateProviderTurn(turn: ProviderTurn, currentAuthorityEpoch: number): void {
  if (turn.turnId !== undefined) identity(turn.turnId, "Turn id");
  identity(turn.attemptId, "Provider input attempt id");
  integer(turn.authorityEpoch, 1, "Provider Turn authority epoch");
  if (turn.authorityEpoch > currentAuthorityEpoch) {
    throw new Error("Provider Turn authority epoch is ahead of current authority.");
  }
  if (!["submitting", "accepted", "completed", "failed", "cancelled", "rejected", "delivery-unknown"]
    .includes(turn.status)) {
    throw new Error("Provider Turn status is invalid.");
  }
  timestamp(turn.submittedAt, "Provider Turn submittedAt");
  timestamp(turn.updatedAt, "Provider Turn updatedAt");
  if (Date.parse(turn.updatedAt) < Date.parse(turn.submittedAt)) {
    throw new Error("Provider Turn updatedAt is earlier than submittedAt.");
  }
  const hasAcceptedIdentity = turn.status === "accepted"
    || turn.status === "completed" || turn.status === "failed" || turn.status === "cancelled";
  if (hasAcceptedIdentity && turn.nativeTurnId !== undefined) {
    identity(turn.nativeTurnId, "Provider native Turn id");
  } else if (!hasAcceptedIdentity && turn.nativeTurnId !== undefined) {
    throw new Error("Unaccepted Provider Turn cannot have a native Turn id.");
  }
}

export function managedProviderTurnId(turn: ProviderTurn | null | undefined): string | null {
  return turn?.turnId ?? null;
}

function requireProviderTurn(
  binding: ProviderRuntimeBinding,
  attemptId: string,
  status: ProviderTurnStatus
): ProviderTurn {
  const id = identity(attemptId, "Provider input attempt id");
  if (binding.turn === null || binding.turn.attemptId !== id || binding.turn.status !== status) {
    throw new Error("Provider Turn does not match the expected delivery state.");
  }
  return binding.turn;
}

function orderedTurnTimestamp(turn: ProviderTurn, value: string, label: string): string {
  const normalized = timestamp(value, label);
  if (Date.parse(normalized) < Date.parse(turn.updatedAt)) {
    throw new Error(`${label} moved backwards.`);
  }
  return normalized;
}

function providerTurnIsActive(turn: ProviderTurn | null): boolean {
  return turn !== null && ["submitting", "accepted", "delivery-unknown"]
    .includes(turn.status);
}

function identity(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is invalid.`);
  return value.trim();
}

function timestamp(value: string, label: string): string {
  const normalized = identity(value, label);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${label} must be a timestamp.`);
  return normalized;
}

function integer(value: number, minimum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label} is invalid.`);
  return value;
}
