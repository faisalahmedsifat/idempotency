import { MissingIdempotencyKeyError } from "../errors.js";
import { getDefaultKeyFromRequest, type HeaderCarrier } from "../utils/http.js";
import {
  buildSnapshotFromValue,
  type HttpResponseSnapshot,
} from "../utils/response.js";
import type { IdempotencyManagerLike } from "../types.js";

export interface FastifyLikeRequest extends HeaderCarrier {
  method?: string;
}

export interface FastifyLikeReply {
  code(statusCode: number): this;
  header(name: string, value: string): this;
  send(payload: unknown): unknown;
  statusCode?: number;
}

export interface FastifyIdempotencyOptions<
  TRequest extends FastifyLikeRequest = FastifyLikeRequest,
> {
  allowMissingKey?: boolean;
  headerName?: string;
  key?: (request: TRequest) => string | undefined | Promise<string | undefined>;
  methods?: readonly string[];
}

export function createFastifyIdempotency<
  TRequest extends FastifyLikeRequest = FastifyLikeRequest,
  TReply extends FastifyLikeReply = FastifyLikeReply,
>(
  manager: IdempotencyManagerLike,
  handler: (request: TRequest, reply: TReply) => unknown | Promise<unknown>,
  options: FastifyIdempotencyOptions<TRequest> = {},
): (request: TRequest, reply: TReply) => Promise<unknown> {
  return async (request, reply) => {
    if (!shouldHandleFastifyMethod(request.method, options.methods)) {
      return handler(request, reply);
    }

    const key =
      (await options.key?.(request)) ??
      getFastifyHeader(request, options.headerName ?? manager.defaultHeaderName) ??
      getDefaultKeyFromRequest(request);

    if (!key) {
      if (options.allowMissingKey === true) {
        return handler(request, reply);
      }

      throw new MissingIdempotencyKeyError(
        `Missing ${options.headerName ?? manager.defaultHeaderName} header.`,
      );
    }

    const result = await manager.execute<FastifyExecutionSnapshot>(key, async () => {
      const capture = createFastifyCapture(reply, key);
      const payload = await handler(request, reply);
      return capture.completeFromReturnValue(payload);
    });

    if (result.status === "replayed") {
      replayFastifySnapshot(reply, result.value.snapshot, result.key);
      return undefined;
    }

    return result.value.payload;
  };
}

interface FastifyExecutionSnapshot {
  payload: unknown;
  snapshot: HttpResponseSnapshot;
}

function createFastifyCapture<TReply extends FastifyLikeReply>(
  reply: TReply,
  key: string,
) {
  const mutableReply = reply as FastifyLikeReply;
  const originalCode = mutableReply.code.bind(mutableReply);
  const originalHeader = mutableReply.header.bind(mutableReply);
  const originalSend = mutableReply.send.bind(mutableReply);
  const headers: Record<string, string> = {};
  let statusCode = reply.statusCode ?? 200;
  let snapshot: HttpResponseSnapshot | undefined;
  let sentViaReply = false;

  mutableReply.code = ((nextStatusCode: number) => {
    statusCode = nextStatusCode;
    originalCode(nextStatusCode);
    return mutableReply;
  }) as FastifyLikeReply["code"];

  mutableReply.header = ((name: string, value: string) => {
    headers[name.toLowerCase()] = value;
    originalHeader(name, value);
    return mutableReply;
  }) as FastifyLikeReply["header"];

  mutableReply.header("idempotency-key", key);
  mutableReply.header("idempotency-status", "created");

  mutableReply.send = ((payload: unknown) => {
    sentViaReply = true;
    snapshot = buildSnapshotFromValue(payload, statusCode, headers);
    return originalSend(payload);
  }) as FastifyLikeReply["send"];

  return {
    completeFromReturnValue(payload: unknown): FastifyExecutionSnapshot {
      if (snapshot) {
        return {
          payload: sentViaReply ? undefined : payload,
          snapshot,
        };
      }

      snapshot = buildSnapshotFromValue(payload, statusCode, headers);
      return {
        payload,
        snapshot,
      };
    },
  };
}

function replayFastifySnapshot<TReply extends FastifyLikeReply>(
  reply: TReply,
  snapshot: HttpResponseSnapshot,
  key: string,
): void {
  reply.code(snapshot.statusCode);
  for (const [name, value] of Object.entries(snapshot.headers)) {
    reply.header(name, value);
  }
  reply.header("idempotency-key", key);
  reply.header("idempotency-status", "cached");

  if (snapshot.bodyKind === "json") {
    reply.send(JSON.parse(snapshot.body));
    return;
  }

  reply.send(snapshot.body);
}

function getFastifyHeader(
  request: FastifyLikeRequest,
  name: string,
): string | undefined {
  const candidate = request.headers?.[name.toLowerCase()];
  if (typeof candidate === "string") {
    return candidate;
  }

  return candidate?.[0];
}

function shouldHandleFastifyMethod(
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
