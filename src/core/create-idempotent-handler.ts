import { MissingIdempotencyKeyError } from "../errors.js";
import type { IdempotencyManagerLike } from "../types.js";

export interface CreateIdempotentHandlerOptions<TContext> {
  allowMissingKey?: boolean;
  key: (context: TContext) => string | undefined | Promise<string | undefined>;
}

export function createIdempotentHandler<TContext, TResult>(
  manager: IdempotencyManagerLike,
  handler: (context: TContext) => Promise<TResult>,
  options: CreateIdempotentHandlerOptions<TContext>,
): (context: TContext) => Promise<TResult> {
  return async (context) => {
    const key = await options.key(context);
    if (!key) {
      if (options.allowMissingKey === true) {
        return handler(context);
      }

      throw new MissingIdempotencyKeyError(
        `Missing idempotency key. Expected resolver to return a value.`,
      );
    }

    const result = await manager.execute(key, () => handler(context));
    return result.value;
  };
}
