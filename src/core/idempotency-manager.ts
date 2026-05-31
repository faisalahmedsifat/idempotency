import {
  IdempotencyConfigurationError,
  IdempotencyInProgressError,
  IdempotencyTimeoutError,
} from "../errors.js";
import { normalizeKey } from "../utils/key.js";
import { sleep } from "../utils/time.js";
import type { IdempotencyStore } from "../stores/idempotency-store.js";
import type {
  IdempotencyExecutionOptions,
  IdempotencyExecutionResult,
  InFlightStrategy,
  ProcessingIdempotencyRecord,
} from "../types.js";

export interface IdempotencyManagerOptions {
  defaultHeaderName: string;
  inFlightStrategy: InFlightStrategy;
  keyPrefix?: string;
  now: () => number;
  pollIntervalMs: number;
  processingTtlMs: number;
  ttlMs: number;
}

/**
 * Pattern: State
 * Problem: A single idempotency key behaves differently while in flight versus after completion.
 * Solution: The manager delegates behavior based on explicit processing and completed record states.
 * Trade-off: More structure than a simple exists-check; justified because correctness under concurrency is the product.
 */
export class IdempotencyManager {
  readonly defaultHeaderName: string;

  constructor(
    private readonly store: IdempotencyStore,
    private readonly options: IdempotencyManagerOptions,
  ) {
    this.defaultHeaderName = options.defaultHeaderName;
  }

  async execute<TValue>(
    rawKey: string,
    operation: () => Promise<TValue>,
    overrideOptions: IdempotencyExecutionOptions = {},
  ): Promise<IdempotencyExecutionResult<TValue>> {
    const key = normalizeKey(rawKey, this.options.keyPrefix);
    const processingTtlMs =
      overrideOptions.processingTtlMs ?? this.options.processingTtlMs;
    const ttlMs = overrideOptions.ttlMs ?? this.options.ttlMs;

    if (!Number.isFinite(processingTtlMs) || processingTtlMs <= 0) {
      throw new IdempotencyConfigurationError(
        "processingTtlMs must be a positive number.",
      );
    }

    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new IdempotencyConfigurationError("ttlMs must be a positive number.");
    }

    const waitDeadline = this.options.now() + processingTtlMs;

    while (true) {
      const ownerToken = crypto.randomUUID();
      const now = this.options.now();
      const claim = await this.store.claim<TValue>(key, {
        now,
        ownerToken,
        processingTtlMs,
      });

      if (claim.kind === "completed") {
        return {
          key,
          status: "replayed",
          value: claim.record.value,
          completedAt: new Date(claim.record.completedAt),
        };
      }

      if (claim.kind === "claimed") {
        try {
          const value = await operation();
          const completedAt = this.options.now();
          const stored = await this.store.complete(key, {
            ownerToken,
            completedAt,
            ttlMs,
            value,
          });

          if (!stored) {
            throw new IdempotencyConfigurationError(
              `Idempotency key "${key}" was lost before completion could be stored.`,
            );
          }

          return {
            key,
            status: "executed",
            value,
            completedAt: new Date(completedAt),
          };
        } catch (error) {
          await this.store.release(key, ownerToken);
          throw error;
        }
      }

      await this.handleInFlightState(key, claim.record, waitDeadline);
    }
  }

  async clear(rawKey: string): Promise<void> {
    const key = normalizeKey(rawKey, this.options.keyPrefix);
    await this.store.clear(key);
  }

  private async handleInFlightState(
    key: string,
    record: ProcessingIdempotencyRecord,
    waitDeadline: number,
  ): Promise<void> {
    const retryAfterMs = Math.max(0, record.expiresAt - this.options.now());
    if (this.options.inFlightStrategy === "reject") {
      throw new IdempotencyInProgressError(
        `Idempotency key "${key}" is already being processed.`,
        key,
        retryAfterMs,
      );
    }

    if (this.options.now() >= waitDeadline) {
      throw new IdempotencyTimeoutError(
        `Timed out waiting for idempotency key "${key}" to complete.`,
        key,
        retryAfterMs,
      );
    }

    await sleep(Math.min(this.options.pollIntervalMs, Math.max(1, retryAfterMs)));
  }
}
