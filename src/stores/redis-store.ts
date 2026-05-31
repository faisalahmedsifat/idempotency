import { UnsupportedStoreError } from "../errors.js";
import type { IdempotencyStore } from "./idempotency-store.js";
import type {
  ClaimInput,
  ClaimResult,
  CompleteInput,
  IdempotencyRecord,
} from "../types.js";

const CLAIM_SCRIPT = `
local current = redis.call("GET", KEYS[1])
local now = tonumber(ARGV[2])
local expiresAt = tonumber(ARGV[3])
local px = tonumber(ARGV[4])

if not current then
  local record = cjson.encode({
    status = "processing",
    ownerToken = ARGV[1],
    startedAt = now,
    expiresAt = expiresAt
  })
  redis.call("SET", KEYS[1], record, "PX", px)
  return cjson.encode({ kind = "claimed" })
end

local decoded = cjson.decode(current)
if decoded.expiresAt ~= nil and tonumber(decoded.expiresAt) <= now then
  local record = cjson.encode({
    status = "processing",
    ownerToken = ARGV[1],
    startedAt = now,
    expiresAt = expiresAt
  })
  redis.call("SET", KEYS[1], record, "PX", px)
  return cjson.encode({ kind = "claimed" })
end

if decoded.status == "completed" then
  return cjson.encode({ kind = "completed", record = decoded })
end

return cjson.encode({ kind = "processing", record = decoded })
`;

const COMPLETE_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if not current then
  return 0
end

local decoded = cjson.decode(current)
if decoded.status ~= "processing" or decoded.ownerToken ~= ARGV[1] then
  return 0
end

local record = cjson.encode({
  status = "completed",
  completedAt = tonumber(ARGV[2]),
  expiresAt = tonumber(ARGV[2]) + tonumber(ARGV[3]),
  value = cjson.decode(ARGV[4])
})
redis.call("SET", KEYS[1], record, "PX", tonumber(ARGV[3]))
return 1
`;

const RELEASE_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if not current then
  return 0
end

local decoded = cjson.decode(current)
if decoded.status == "processing" and decoded.ownerToken == ARGV[1] then
  redis.call("DEL", KEYS[1])
  return 1
end

return 0
`;

export interface RedisCommandExecutor {
  del(key: string): Promise<void>;
  eval(script: string, key: string, args: string[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

export interface NodeRedisLikeClient {
  del(key: string): Promise<unknown>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

export interface IORedisLikeClient {
  del(key: string): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

export class RedisStore implements IdempotencyStore {
  constructor(private readonly executor: RedisCommandExecutor) {}

  async claim<TValue>(
    key: string,
    input: ClaimInput,
  ): Promise<ClaimResult<TValue>> {
    const raw = await this.executor.eval(CLAIM_SCRIPT, key, [
      input.ownerToken,
      String(input.now),
      String(input.now + input.processingTtlMs),
      String(input.processingTtlMs),
    ]);

    return parseClaimResult<TValue>(raw);
  }

  async complete<TValue>(key: string, input: CompleteInput<TValue>): Promise<boolean> {
    const raw = await this.executor.eval(COMPLETE_SCRIPT, key, [
      input.ownerToken,
      String(input.completedAt),
      String(input.ttlMs),
      JSON.stringify(input.value),
    ]);

    return raw === 1 || raw === "1";
  }

  async get<TValue>(key: string): Promise<IdempotencyRecord<TValue> | undefined> {
    const raw = await this.executor.get(key);
    if (!raw) {
      return undefined;
    }

    return JSON.parse(raw) as IdempotencyRecord<TValue>;
  }

  async release(key: string, ownerToken: string): Promise<void> {
    await this.executor.eval(RELEASE_SCRIPT, key, [ownerToken]);
  }

  async clear(key: string): Promise<void> {
    await this.executor.del(key);
  }
}

function parseClaimResult<TValue>(raw: unknown): ClaimResult<TValue> {
  if (typeof raw !== "string") {
    throw new UnsupportedStoreError("Redis claim script returned an unexpected result.");
  }

  return JSON.parse(raw) as ClaimResult<TValue>;
}

export function createNodeRedisExecutor(
  client: NodeRedisLikeClient,
): RedisCommandExecutor {
  return {
    async del(key: string): Promise<void> {
      await client.del(key);
    },
    async eval(script: string, key: string, args: string[]): Promise<unknown> {
      return client.eval(script, {
        keys: [key],
        arguments: args,
      });
    },
    async get(key: string): Promise<string | null> {
      return client.get(key);
    },
  };
}

export function createIORedisExecutor(
  client: IORedisLikeClient,
): RedisCommandExecutor {
  return {
    async del(key: string): Promise<void> {
      await client.del(key);
    },
    async eval(script: string, key: string, args: string[]): Promise<unknown> {
      return client.eval(script, 1, key, ...args);
    },
    async get(key: string): Promise<string | null> {
      return client.get(key);
    },
  };
}
