import {
  createFetchIdempotency,
  type FetchIdempotencyOptions,
} from "./fetch.js";
import type { IdempotencyManagerLike } from "../types.js";

export interface HonoLikeRequest {
  raw: Request;
  header(name: string): string | undefined;
}

export interface HonoLikeContext {
  req: HonoLikeRequest;
}

export interface HonoIdempotencyOptions<TContext extends HonoLikeContext = HonoLikeContext>
  extends Omit<FetchIdempotencyOptions<TContext>, "key"> {
  key?: (
    context: TContext,
  ) => string | undefined | Promise<string | undefined>;
}

export function createHonoIdempotency<TContext extends HonoLikeContext = HonoLikeContext>(
  manager: IdempotencyManagerLike,
  handler: (context: TContext) => Promise<Response>,
  options: HonoIdempotencyOptions<TContext> = {},
): (context: TContext) => Promise<Response> {
  const wrapped = createFetchIdempotency(
    manager,
    (request: Request, context: TContext) => handler(context),
    {
      ...options,
      key: async (_request, context) => options.key?.(context),
    },
  );

  return async (context) => wrapped(context.req.raw, context);
}
