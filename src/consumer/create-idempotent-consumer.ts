import { MissingIdempotencyKeyError } from "../errors.js";
import type { IdempotencyManagerLike } from "../types.js";

export interface CreateIdempotentConsumerOptions<TEvent> {
  allowMissingKey?: boolean;
  key: (event: TEvent) => string | undefined | Promise<string | undefined>;
}

export function createIdempotentConsumer<TEvent, TResult>(
  manager: IdempotencyManagerLike,
  handler: (event: TEvent) => Promise<TResult>,
  options: CreateIdempotentConsumerOptions<TEvent>,
): (event: TEvent) => Promise<TResult> {
  return async (event) => {
    const key = await options.key(event);
    if (!key) {
      if (options.allowMissingKey === true) {
        return handler(event);
      }

      throw new MissingIdempotencyKeyError(
        "Missing idempotency key for consumer event.",
      );
    }

    const result = await manager.execute(key, () => handler(event));
    return result.value;
  };
}
