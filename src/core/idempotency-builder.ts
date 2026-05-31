import { IdempotencyConfigurationError } from "../errors.js";
import { MemoryStore } from "../stores/memory-store.js";
import type { IdempotencyStore } from "../stores/idempotency-store.js";
import type { InFlightStrategy } from "../types.js";
import { IdempotencyManager } from "./idempotency-manager.js";

/**
 * Pattern: Builder
 * Problem: Construction spans storage, TTLs, waiting policy, and request key defaults.
 * Solution: The builder makes each choice explicit and validates the combination at build time.
 * Trade-off: More ceremony than a constructor; justified because the config surface is non-trivial.
 */
export class IdempotencyBuilder {
  private defaultHeaderName = "idempotency-key";
  private inFlightStrategy: InFlightStrategy = "wait";
  private keyPrefix: string | undefined;
  private now: (() => number) | undefined;
  private pollIntervalMs = 50;
  private processingTtlMs = 30_000;
  private store: IdempotencyStore | undefined;
  private ttlMs = 24 * 60 * 60 * 1_000;

  useStore(store: IdempotencyStore): this {
    this.store = store;
    return this;
  }

  withMemoryStore(): this {
    this.store = new MemoryStore();
    return this;
  }

  withDefaultHeader(name: string): this {
    this.defaultHeaderName = name.toLowerCase();
    return this;
  }

  withInFlightStrategy(strategy: InFlightStrategy): this {
    this.inFlightStrategy = strategy;
    return this;
  }

  withKeyPrefix(prefix: string): this {
    this.keyPrefix = prefix;
    return this;
  }

  withClock(now: () => number): this {
    this.now = now;
    return this;
  }

  withPollInterval(intervalMs: number): this {
    this.pollIntervalMs = intervalMs;
    return this;
  }

  withProcessingTTL(ttlMs: number): this {
    this.processingTtlMs = ttlMs;
    return this;
  }

  withTTL(ttlMs: number): this {
    this.ttlMs = ttlMs;
    return this;
  }

  build(): IdempotencyManager {
    if (this.defaultHeaderName.trim().length === 0) {
      throw new IdempotencyConfigurationError(
        "withDefaultHeader() requires a non-empty header name.",
      );
    }

    validatePositiveNumber(this.ttlMs, "withTTL()");
    validatePositiveNumber(this.processingTtlMs, "withProcessingTTL()");
    validatePositiveNumber(this.pollIntervalMs, "withPollInterval()");

    const store = this.store ?? new MemoryStore();

    const options = {
      defaultHeaderName: this.defaultHeaderName,
      inFlightStrategy: this.inFlightStrategy,
      now: this.now ?? (() => Date.now()),
      pollIntervalMs: this.pollIntervalMs,
      processingTtlMs: this.processingTtlMs,
      ttlMs: this.ttlMs,
    };

    return new IdempotencyManager(
      store,
      this.keyPrefix === undefined
        ? options
        : {
            ...options,
            keyPrefix: this.keyPrefix,
          },
    );
  }
}

function validatePositiveNumber(value: number, methodName: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new IdempotencyConfigurationError(
      `${methodName} requires a positive number.`,
    );
  }
}
