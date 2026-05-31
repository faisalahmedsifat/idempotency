# `@xyph3r/idempotency`

Framework-agnostic idempotency for Node.js HTTP handlers and event consumers.

The package is built around a few deliberate design choices:

- `State`: a key is either `processing` or `completed`
- `Builder`: readable setup for store, TTLs, and wait policy
- `Decorator`: adapters wrap handlers without leaking HTTP concerns into the core
- `Pipeline`: claim, execute, store, and replay happen in a fixed order

## Install

```bash
npm install @xyph3r/idempotency
```

## Quick start

```ts
import express from "express";
import {
  IdempotencyBuilder,
  createExpressIdempotency,
} from "@xyph3r/idempotency";

const app = express();

const idempotency = new IdempotencyBuilder()
  .withMemoryStore()
  .withTTL(24 * 60 * 60 * 1_000)
  .build();

app.post(
  "/payments",
  createExpressIdempotency(
    idempotency,
    async (_request, response) => {
      response.status(201);
      response.json?.({ ok: true });
    },
    {
      key: (request) => request.headers["idempotency-key"] as string | undefined,
    },
  ),
);
```

The first request executes normally. A retry with the same key replays the original response body, status code, and headers without running the handler again.

## Core usage

```ts
import { IdempotencyBuilder } from "@xyph3r/idempotency";

const idempotency = new IdempotencyBuilder()
  .withMemoryStore()
  .withTTL(60_000)
  .build();

const first = await idempotency.execute("payment:123", async () => {
  return { charged: true };
});

const second = await idempotency.execute("payment:123", async () => {
  return { charged: false };
});

console.log(first.status); // "executed"
console.log(second.status); // "replayed"
console.log(second.value); // { charged: true }
```

## Redis-backed usage

The package does not force a Redis client. It ships executors for the common `node-redis` and `ioredis` interfaces.

### `node-redis`

```ts
import { createClient } from "redis";
import {
  IdempotencyBuilder,
  RedisStore,
  createNodeRedisExecutor,
} from "@xyph3r/idempotency";

const client = createClient();
await client.connect();

const store = new RedisStore(createNodeRedisExecutor(client));

const idempotency = new IdempotencyBuilder()
  .useStore(store)
  .withTTL(24 * 60 * 60 * 1_000)
  .build();
```

### `ioredis`

```ts
import Redis from "ioredis";
import {
  IdempotencyBuilder,
  RedisStore,
  createIORedisExecutor,
} from "@xyph3r/idempotency";

const client = new Redis(process.env.REDIS_URL!);
const store = new RedisStore(createIORedisExecutor(client));
```

## Fetch and Next.js

```ts
import { createFetchIdempotency, IdempotencyBuilder } from "@xyph3r/idempotency";

const idempotency = new IdempotencyBuilder()
  .withMemoryStore()
  .build();

const handler = createFetchIdempotency(
  idempotency,
  async () => Response.json({ ok: true }, { status: 201 }),
  {
    key: async (request) => request.headers.get("idempotency-key") ?? undefined,
  },
);
```

## Event consumers

```ts
import {
  IdempotencyBuilder,
  createIdempotentConsumer,
} from "@xyph3r/idempotency";

const idempotency = new IdempotencyBuilder()
  .withMemoryStore()
  .withTTL(7 * 24 * 60 * 60 * 1_000)
  .build();

const onInvoicePaid = createIdempotentConsumer(
  idempotency,
  async (event: { id: string; invoiceId: string }) => {
    await markInvoicePaid(event.invoiceId);
  },
  {
    key: (event) => event.id,
  },
);
```

This is the EDA use case: at-least-once delivery means duplicates happen, and the handler should only apply its side effects once.

## Public API

- `IdempotencyBuilder`
- `IdempotencyManager`
- `createIdempotency()`
- `createIdempotentHandler()`
- `createIdempotentConsumer()`
- `createExpressIdempotency()`
- `createFastifyIdempotency()`
- `createFetchIdempotency()`
- `createHonoIdempotency()`
- `createNextIdempotency()`
- `MemoryStore`
- `RedisStore`
