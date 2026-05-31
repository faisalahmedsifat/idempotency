import { MissingIdempotencyKeyError } from "../errors.js";
import {
  getDefaultKeyFromFetchRequest,
  shouldHandleMethod,
} from "../utils/http.js";
import {
  responseFromSnapshot,
  responseToSnapshot,
  type HttpResponseSnapshot,
} from "../utils/response.js";
import type { IdempotencyManagerLike } from "../types.js";

export type FetchLikeHandler<TContext = unknown> = (
  request: Request,
  context: TContext,
) => Promise<Response>;

export interface FetchIdempotencyOptions<TContext = unknown> {
  allowMissingKey?: boolean;
  headerName?: string;
  key?: (
    request: Request,
    context: TContext,
  ) => string | undefined | Promise<string | undefined>;
  methods?: readonly string[];
}

/**
 * Pattern: Decorator
 * Problem: Request parsing and response replay should not leak into the idempotency core.
 * Solution: The adapter decorates a fetch-style handler with key extraction and response snapshot replay.
 * Trade-off: A wrapper per framework; justified because the core stays framework-agnostic.
 */
export function createFetchIdempotency<TContext = unknown>(
  manager: IdempotencyManagerLike,
  handler: FetchLikeHandler<TContext>,
  options: FetchIdempotencyOptions<TContext> = {},
): FetchLikeHandler<TContext> {
  return async (request, context) => {
    if (!shouldHandleMethod(request.method, options.methods)) {
      return handler(request, context);
    }

    const key =
      (await options.key?.(request, context)) ??
      request.headers.get(options.headerName ?? manager.defaultHeaderName) ??
      getDefaultKeyFromFetchRequest(request);

    if (!key) {
      if (options.allowMissingKey === true) {
        return handler(request, context);
      }

      throw new MissingIdempotencyKeyError(
        `Missing ${options.headerName ?? manager.defaultHeaderName} header.`,
      );
    }

    const result = await manager.execute<HttpResponseSnapshot>(key, async () => {
      const response = await handler(request, context);
      return responseToSnapshot(response);
    });

    return responseFromSnapshot(
      result.value,
      result.key,
      result.status === "replayed" ? "cached" : "created",
    );
  };
}
