import { MissingIdempotencyKeyError } from "../errors.js";
import { getDefaultKeyFromRequest, type HeaderCarrier } from "../utils/http.js";
import {
  buildSnapshotFromValue,
  type HttpResponseSnapshot,
} from "../utils/response.js";
import type { IdempotencyManagerLike } from "../types.js";

export interface ExpressLikeRequest extends HeaderCarrier {
  method?: string;
}

export interface ExpressLikeResponse {
  end(body?: string): unknown;
  json?(body: unknown): unknown;
  send?(body?: unknown): unknown;
  setHeader(name: string, value: string): void;
  status(code: number): this;
  statusCode?: number;
}

export type ExpressLikeNext = (error?: unknown) => void;

export interface ExpressIdempotencyOptions<
  TRequest extends ExpressLikeRequest = ExpressLikeRequest,
  TResponse extends ExpressLikeResponse = ExpressLikeResponse,
> {
  allowMissingKey?: boolean;
  headerName?: string;
  key?: (request: TRequest) => string | undefined | Promise<string | undefined>;
  methods?: readonly string[];
}

export function createExpressIdempotency<
  TRequest extends ExpressLikeRequest = ExpressLikeRequest,
  TResponse extends ExpressLikeResponse = ExpressLikeResponse,
>(
  manager: IdempotencyManagerLike,
  handler: (
    request: TRequest,
    response: TResponse,
    next: ExpressLikeNext,
  ) => unknown | Promise<unknown>,
  options: ExpressIdempotencyOptions<TRequest, TResponse> = {},
): (
  request: TRequest,
  response: TResponse,
  next: ExpressLikeNext,
) => Promise<void> {
  return async (request, response, next) => {
    try {
      if (!shouldHandleExpressMethod(request.method, options.methods)) {
        await Promise.resolve(handler(request, response, next));
        return;
      }

      const key =
        (await options.key?.(request)) ??
        getHeader(request, options.headerName ?? manager.defaultHeaderName) ??
        getDefaultKeyFromRequest(request);

      if (!key) {
        if (options.allowMissingKey === true) {
          await Promise.resolve(handler(request, response, next));
          return;
        }

        throw new MissingIdempotencyKeyError(
          `Missing ${options.headerName ?? manager.defaultHeaderName} header.`,
        );
      }

      const result = await manager.execute<HttpResponseSnapshot>(key, () =>
        captureExpressResponse(request, response, next, handler, key),
      );

      if (result.status === "replayed") {
        replayExpressSnapshot(response, result.value, result.key);
      }
    } catch (error) {
      next(error);
    }
  };
}

async function captureExpressResponse<
  TRequest extends ExpressLikeRequest,
  TResponse extends ExpressLikeResponse,
>(
  request: TRequest,
  response: TResponse,
  next: ExpressLikeNext,
  handler: (
    request: TRequest,
    response: TResponse,
    next: ExpressLikeNext,
  ) => unknown | Promise<unknown>,
  key: string,
): Promise<HttpResponseSnapshot> {
  return new Promise<HttpResponseSnapshot>((resolve, reject) => {
    const mutableResponse = response as ExpressLikeResponse;
    const originalStatus = mutableResponse.status.bind(mutableResponse);
    const originalSetHeader = mutableResponse.setHeader.bind(mutableResponse);
    const originalEnd = mutableResponse.end.bind(mutableResponse);
    const originalJson = mutableResponse.json?.bind(mutableResponse);
    const originalSend = mutableResponse.send?.bind(mutableResponse);
    const headers: Record<string, string> = {};
    let statusCode = response.statusCode ?? 200;
    let settled = false;

    const restore = (): void => {
      mutableResponse.status = originalStatus;
      mutableResponse.setHeader = originalSetHeader;
      mutableResponse.end = originalEnd;
      if (originalJson) {
        mutableResponse.json = originalJson;
      }
      if (originalSend) {
        mutableResponse.send = originalSend;
      }
    };

    const finalize = (snapshot: HttpResponseSnapshot): void => {
      if (settled) {
        return;
      }

      settled = true;
      restore();
      resolve(snapshot);
    };

    const fail = (error: unknown): void => {
      if (settled) {
        return;
      }

      settled = true;
      restore();
      reject(error);
    };

    mutableResponse.status = ((code: number) => {
      statusCode = code;
      originalStatus(code);
      return mutableResponse;
    }) as ExpressLikeResponse["status"];
    mutableResponse.setHeader = ((name: string, value: string) => {
      headers[name.toLowerCase()] = value;
      originalSetHeader(name, value);
    }) as ExpressLikeResponse["setHeader"];

    mutableResponse.setHeader("idempotency-key", key);
    mutableResponse.setHeader("idempotency-status", "created");

    mutableResponse.end = ((body?: string) => {
      const snapshot = buildSnapshotFromValue(body, statusCode, headers);
      const result = originalEnd(body);
      finalize(snapshot);
      return result;
    }) as ExpressLikeResponse["end"];

    if (originalJson) {
      mutableResponse.json = ((body: unknown) => {
        const nextHeaders = {
          ...headers,
          "content-type": headers["content-type"] ?? "application/json; charset=utf-8",
        };
        const snapshot = buildSnapshotFromValue(body, statusCode, nextHeaders);
        const result = originalJson(body);
        finalize(snapshot);
        return result;
      }) as NonNullable<ExpressLikeResponse["json"]>;
    }

    if (originalSend) {
      mutableResponse.send = ((body?: unknown) => {
        const snapshot = buildSnapshotFromValue(body, statusCode, headers);
        const result = originalSend(body);
        finalize(snapshot);
        return result;
      }) as NonNullable<ExpressLikeResponse["send"]>;
    }

    try {
      Promise.resolve(
        handler(request, response, (error?: unknown) => {
          if (error) {
            fail(error);
            return;
          }

          next();
        }),
      )
        .then(() => {
          if (!settled) {
            fail(new Error("Express idempotent handler completed without sending a response."));
          }
        })
        .catch(fail);
    } catch (error) {
      fail(error);
    }
  });
}

function replayExpressSnapshot<TResponse extends ExpressLikeResponse>(
  response: TResponse,
  snapshot: HttpResponseSnapshot,
  key: string,
): void {
  response.status(snapshot.statusCode);
  for (const [name, value] of Object.entries(snapshot.headers)) {
    response.setHeader(name, value);
  }
  response.setHeader("idempotency-key", key);
  response.setHeader("idempotency-status", "cached");

  if (snapshot.bodyKind === "json" && typeof response.json === "function") {
    response.json(JSON.parse(snapshot.body));
    return;
  }

  if (typeof response.send === "function") {
    response.send(snapshot.body);
    return;
  }

  response.end(snapshot.body);
}

function getHeader(
  request: ExpressLikeRequest,
  name: string,
): string | undefined {
  const candidate = request.headers?.[name.toLowerCase()];
  if (typeof candidate === "string") {
    return candidate;
  }

  return candidate?.[0];
}

function shouldHandleExpressMethod(
  method: string | undefined,
  methods: readonly string[] | undefined,
): boolean {
  if (!method) {
    return true;
  }

  const normalized = method.toUpperCase();
  const activeMethods = methods ?? ["POST", "PATCH", "PUT"];
  return activeMethods.includes(normalized);
}
