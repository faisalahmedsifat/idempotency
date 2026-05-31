export class IdempotencyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyConfigurationError";
  }
}

export class IdempotencyInProgressError extends Error {
  constructor(
    message: string,
    public readonly key: string,
    public readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = "IdempotencyInProgressError";
  }
}

export class IdempotencyTimeoutError extends Error {
  constructor(
    message: string,
    public readonly key: string,
    public readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = "IdempotencyTimeoutError";
  }
}

export class MissingIdempotencyKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingIdempotencyKeyError";
  }
}

export class UnsupportedStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedStoreError";
  }
}
