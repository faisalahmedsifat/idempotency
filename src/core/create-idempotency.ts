import { MemoryStore } from "../stores/memory-store.js";
import type { IdempotencyStore } from "../stores/idempotency-store.js";
import type { CreateIdempotencyOptions } from "../types.js";
import { IdempotencyBuilder } from "./idempotency-builder.js";

export interface CreateIdempotencyFactoryOptions extends CreateIdempotencyOptions {
  store?: IdempotencyStore;
}

export function createIdempotency(options: CreateIdempotencyFactoryOptions = {}) {
  const builder = new IdempotencyBuilder()
    .useStore(options.store ?? new MemoryStore())
    .withTTL(options.ttlMs ?? 24 * 60 * 60 * 1_000)
    .withProcessingTTL(options.processingTtlMs ?? 30_000)
    .withPollInterval(options.pollIntervalMs ?? 50)
    .withInFlightStrategy(options.inFlightStrategy ?? "wait");

  if (options.defaultHeaderName) {
    builder.withDefaultHeader(options.defaultHeaderName);
  }

  if (options.keyPrefix) {
    builder.withKeyPrefix(options.keyPrefix);
  }

  if (options.now) {
    builder.withClock(options.now);
  }

  return builder.build();
}
