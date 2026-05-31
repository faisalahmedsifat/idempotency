import type {
  ClaimInput,
  ClaimResult,
  CompleteInput,
  IdempotencyRecord,
} from "../types.js";

export interface IdempotencyStore {
  claim<TValue>(key: string, input: ClaimInput): Promise<ClaimResult<TValue>>;
  complete<TValue>(key: string, input: CompleteInput<TValue>): Promise<boolean>;
  get<TValue>(key: string): Promise<IdempotencyRecord<TValue> | undefined>;
  release(key: string, ownerToken: string): Promise<void>;
  clear(key: string): Promise<void>;
}
