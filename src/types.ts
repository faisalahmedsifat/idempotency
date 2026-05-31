export type InFlightStrategy = "wait" | "reject";

export interface ProcessingIdempotencyRecord {
  status: "processing";
  ownerToken: string;
  startedAt: number;
  expiresAt: number;
}

export interface CompletedIdempotencyRecord<TValue = unknown> {
  status: "completed";
  completedAt: number;
  expiresAt: number;
  value: TValue;
}

export type IdempotencyRecord<TValue = unknown> =
  | ProcessingIdempotencyRecord
  | CompletedIdempotencyRecord<TValue>;

export interface ClaimInput {
  now: number;
  ownerToken: string;
  processingTtlMs: number;
}

export interface CompleteInput<TValue> {
  completedAt: number;
  ownerToken: string;
  ttlMs: number;
  value: TValue;
}

export interface ClaimedResult {
  kind: "claimed";
}

export interface ProcessingResult {
  kind: "processing";
  record: ProcessingIdempotencyRecord;
}

export interface CompletedResult<TValue = unknown> {
  kind: "completed";
  record: CompletedIdempotencyRecord<TValue>;
}

export type ClaimResult<TValue = unknown> =
  | ClaimedResult
  | ProcessingResult
  | CompletedResult<TValue>;

export interface IdempotencyExecutionOptions {
  processingTtlMs?: number;
  ttlMs?: number;
}

export interface IdempotencyExecutionResult<TValue> {
  key: string;
  status: "executed" | "replayed";
  value: TValue;
  completedAt: Date;
}

export interface IdempotencyManagerLike {
  readonly defaultHeaderName: string;
  clear(key: string): Promise<void>;
  execute<TValue>(
    key: string,
    operation: () => Promise<TValue>,
    options?: IdempotencyExecutionOptions,
  ): Promise<IdempotencyExecutionResult<TValue>>;
}

export interface CreateIdempotencyOptions {
  defaultHeaderName?: string;
  inFlightStrategy?: InFlightStrategy;
  keyPrefix?: string;
  now?: () => number;
  pollIntervalMs?: number;
  processingTtlMs?: number;
  ttlMs?: number;
}
