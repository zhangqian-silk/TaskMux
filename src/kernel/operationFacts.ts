import type { ImplementationRef } from "./instanceHost.js";

/** Embedded in the existing semantic owner's record, never a second ledger.
 * Receipts/results stay at their original locators. No credential values here.
 */
export type OperationFacts = Readonly<{
  requestId: string;
  inputDigest: string;
  actorId: string;
  /** Non-secret binding fingerprint, not a bearer credential or grant. */
  authorityRef: string;
  targetId: string;
  capability: string;
  implementation: ImplementationRef;
  effect: "none" | "possible" | "confirmed";
  receiptRefs: readonly string[];
  partialResultRefs: readonly string[];
}>;

export function validateOperationFacts(facts: OperationFacts): void {
  for (const value of [
    facts?.requestId, facts?.actorId, facts?.authorityRef, facts?.targetId, facts?.capability,
    facts?.implementation?.id, facts?.implementation?.generation
  ]) {
    if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
      throw new Error("Operation identity is invalid.");
    }
  }
  if (!/^[a-f0-9]{64}$/u.test(facts.inputDigest)) throw new Error("Operation input digest is invalid.");
  if (!["none", "possible", "confirmed"].includes(facts.effect)) throw new Error("Operation effect is invalid.");
  for (const refs of [facts.receiptRefs, facts.partialResultRefs]) {
    if (!Array.isArray(refs) || refs.some((ref) => typeof ref !== "string" || !ref.trim())) {
      throw new Error("Operation evidence references are invalid.");
    }
  }
}

/** Effects only accumulate. Later output failure or cancellation cannot erase evidence. */
export function recordOperationEvidence(
  facts: OperationFacts,
  evidence: Readonly<{
    effect?: OperationFacts["effect"];
    receiptRefs?: readonly string[];
    partialResultRefs?: readonly string[];
  }>
): OperationFacts {
  const rank = { none: 0, possible: 1, confirmed: 2 };
  const next = {
    ...facts,
    effect: evidence.effect !== undefined && rank[evidence.effect] > rank[facts.effect]
      ? evidence.effect : facts.effect,
    receiptRefs: [...new Set([...facts.receiptRefs, ...(evidence.receiptRefs ?? [])])],
    partialResultRefs: [...new Set([...facts.partialResultRefs, ...(evidence.partialResultRefs ?? [])])]
  };
  validateOperationFacts(next);
  return next;
}
