import { cloneValue } from "../utils/clone.js";
import type { IdempotencyStore } from "./idempotency-store.js";
import type {
  ClaimInput,
  ClaimResult,
  CompleteInput,
  IdempotencyRecord,
} from "../types.js";

export class MemoryStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  async claim<TValue>(
    key: string,
    input: ClaimInput,
  ): Promise<ClaimResult<TValue>> {
    const current = this.records.get(key);
    if (!current || current.expiresAt <= input.now) {
      const processingRecord = {
        status: "processing" as const,
        ownerToken: input.ownerToken,
        startedAt: input.now,
        expiresAt: input.now + input.processingTtlMs,
      };
      this.records.set(key, processingRecord);
      return { kind: "claimed" };
    }

    if (current.status === "completed") {
      return {
        kind: "completed",
        record: {
          ...current,
          value: cloneValue(current.value) as TValue,
        },
      };
    }

    return {
      kind: "processing",
      record: current,
    };
  }

  async complete<TValue>(key: string, input: CompleteInput<TValue>): Promise<boolean> {
    const current = this.records.get(key);
    if (
      !current ||
      current.status !== "processing" ||
      current.ownerToken !== input.ownerToken
    ) {
      return false;
    }

    this.records.set(key, {
      status: "completed",
      completedAt: input.completedAt,
      expiresAt: input.completedAt + input.ttlMs,
      value: cloneValue(input.value),
    });

    return true;
  }

  async get<TValue>(key: string): Promise<IdempotencyRecord<TValue> | undefined> {
    const current = this.records.get(key);
    if (!current) {
      return undefined;
    }

    if (current.status === "completed") {
      return {
        ...current,
        value: cloneValue(current.value) as TValue,
      };
    }

    return current as IdempotencyRecord<TValue>;
  }

  async release(key: string, ownerToken: string): Promise<void> {
    const current = this.records.get(key);
    if (
      current &&
      current.status === "processing" &&
      current.ownerToken === ownerToken
    ) {
      this.records.delete(key);
    }
  }

  async clear(key: string): Promise<void> {
    this.records.delete(key);
  }
}
