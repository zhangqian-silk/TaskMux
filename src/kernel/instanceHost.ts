/** Process-local implementation ownership. The Controller composition root owns
 * one Host; a registry selects references, never owns a second instance table.
 * Disposers must release only resources the registering instance owns (a
 * connection to a shared daemon is owned, the daemon itself is not).
 */
export type ImplementationRef = Readonly<{
  id: string;
  generation: string;
}>;

export type ImplementationHandle<T> = Readonly<{
  implementation: ImplementationRef;
  value: T;
  release(): Promise<void>;
}>;

type Instance = {
  implementation: ImplementationRef;
  value: unknown;
  references: number;
  detached: boolean;
  disposers: readonly (() => void | Promise<void>)[];
  disposal?: Promise<void>;
  drained: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
};

export class InstanceHost {
  readonly #instances = new Map<string, Instance>();
  #closed = false;

  attach<T>(
    implementation: ImplementationRef,
    value: T,
    ownedDisposers: readonly (() => void | Promise<void>)[] = []
  ): ImplementationRef {
    if (this.#closed) throw new Error("Instance Host is closed.");
    const key = implementationKey(implementation);
    if (this.#instances.has(key)) throw new Error(`Implementation already attached: ${key}.`);
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const drained = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    // A disposer can fail before detach's caller starts awaiting the drain.
    void drained.catch(() => undefined);
    const ref = Object.freeze({ ...implementation });
    this.#instances.set(key, {
      implementation: ref, value, references: 0, detached: false,
      disposers: [...ownedDisposers], drained, resolve, reject
    });
    return ref;
  }

  /** Read-only availability for the rebuildable capability directory. This is
   * not an acquisition or a grant; acquire still checks immediately before use. */
  isAvailable(implementation: ImplementationRef): boolean {
    const instance = this.#instances.get(implementationKey(implementation));
    return !this.#closed && instance !== undefined && !instance.detached;
  }

  acquire<T>(implementation: ImplementationRef): ImplementationHandle<T> {
    const instance = this.#instances.get(implementationKey(implementation));
    if (this.#closed || instance === undefined || instance.detached) {
      throw new Error("Implementation unavailable.");
    }
    instance.references += 1;
    let released = false;
    return Object.freeze({
      implementation: instance.implementation,
      value: instance.value as T,
      release: async () => {
        if (released) return;
        released = true;
        instance.references -= 1;
        if (instance.detached && instance.references === 0) await this.#dispose(instance);
      }
    });
  }

  async use<T, R>(
    implementation: ImplementationRef,
    call: (value: T, implementation: ImplementationRef) => R | Promise<R>
  ): Promise<R> {
    const handle = this.acquire<T>(implementation);
    try {
      return await call(handle.value, handle.implementation);
    } finally {
      await handle.release();
    }
  }

  /** Stops acquisition immediately. Resolves only after all calls/Sessions release. */
  detach(implementation: ImplementationRef): Promise<void> {
    const instance = this.#instances.get(implementationKey(implementation));
    if (instance === undefined) throw new Error("Implementation is not attached.");
    instance.detached = true;
    if (instance.references === 0) void this.#dispose(instance).catch(() => undefined);
    return instance.drained;
  }

  async close(): Promise<void> {
    this.#closed = true;
    const results = await Promise.allSettled(
      [...this.#instances.values()].map((instance) => this.detach(instance.implementation))
    );
    const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (errors.length) throw new AggregateError(errors, "Instance cleanup failed.");
  }

  #dispose(instance: Instance): Promise<void> {
    instance.disposal ??= (async () => {
      const errors: unknown[] = [];
      for (const dispose of [...instance.disposers].reverse()) {
        try { await dispose(); } catch (error) { errors.push(error); }
      }
      // Keep the identity reserved for this Host's lifetime, including failures.
      // Re-attaching a generation must not resurrect an old reference.
      instance.value = undefined;
      instance.disposers = [];
      if (errors.length) throw new AggregateError(errors, "Instance cleanup failed.");
    })();
    void instance.disposal.then(instance.resolve, instance.reject);
    return instance.disposal;
  }
}

function implementationKey(ref: ImplementationRef): string {
  for (const value of [ref.id, ref.generation]) {
    if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
      throw new Error("Implementation identity is invalid.");
    }
  }
  return JSON.stringify([ref.id, ref.generation]);
}
