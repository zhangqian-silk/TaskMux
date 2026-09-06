/** In-process capability context, issued only after ingress authentication.
 * Keep the authority object in the trusted composition root, not in plugin
 * inputs. Plugin/protocol adapters provide credentials to authenticate, never
 * actor/role JSON to a capability. No credential is exposed on the context.
 */
export type TrustedCallContext = Readonly<{ actorId: string; targetId: string }>;

export class CallAuthority<Credential> {
  readonly #credentials = new WeakMap<TrustedCallContext, Credential>();

  constructor(
    private readonly authenticateCurrent: (credential: Credential, targetId: string) => string
  ) {}

  authenticate(credential: Credential, targetId: string): TrustedCallContext {
    const actorId = this.authenticateCurrent(credential, targetId);
    const context = Object.freeze({ actorId, targetId });
    this.#credentials.set(context, credential);
    return context;
  }

  /** Reauthenticate at each new action; a context or implementation handle is
   * not a permanent grant. Domain-specific authorization remains in its owner.
   */
  authorize(context: TrustedCallContext, targetId: string): void {
    if (!this.#credentials.has(context) || context.targetId !== targetId) {
      throw new Error("Untrusted or out-of-scope call context.");
    }
    const actorId = this.authenticateCurrent(this.#credentials.get(context)!, targetId);
    if (actorId !== context.actorId) throw new Error("Call authority changed.");
  }
}
