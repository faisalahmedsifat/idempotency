import {
  createFetchIdempotency,
  type FetchIdempotencyOptions,
} from "./fetch.js";
import type { IdempotencyManagerLike } from "../types.js";

export type NextRouteHandler<TContext = unknown> = (
  request: Request,
  context: TContext,
) => Promise<Response>;

export interface NextIdempotencyOptions<TContext = unknown>
  extends FetchIdempotencyOptions<TContext> {}

export function createNextIdempotency<TContext = unknown>(
  manager: IdempotencyManagerLike,
  handler: NextRouteHandler<TContext>,
  options: NextIdempotencyOptions<TContext> = {},
): NextRouteHandler<TContext> {
  return createFetchIdempotency(manager, handler, options);
}
