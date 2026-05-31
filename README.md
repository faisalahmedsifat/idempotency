# `@xyph3r/idempotency`

Framework-agnostic idempotency for Node.js HTTP handlers and event consumers.

This package is for operations that must be safe to retry:

- charging a card
- creating an order
- processing a webhook
- handling a queue message that may be redelivered

If the same idempotency key is seen twice, the operation runs once and later duplicates get the stored result back.

## When to use it

Use it when:

- a client may retry a `POST`, `PATCH`, or `PUT`
- a webhook provider may deliver the same event more than once
- a queue or broker uses at-least-once delivery
- the handler has side effects you must not apply twice

Do not use it when:

- the route is just a `GET` or another pure read
- the operation is already naturally idempotent and duplicate execution is harmless
- you do not have a stable key from the caller or event source

## Install

```bash
npm install @xyph3r/idempotency
```

or

```bash
bun add @xyph3r/idempotency
```

## How it works

For a given key, the package stores one of two states:

- `processing`: one request is currently executing
- `completed`: the original result is already stored and can be replayed

The normal flow is:

1. claim the key
2. run the operation once
3. store the result
4. replay the stored result for duplicates

## Production setup

Use Redis in production. `MemoryStore` is for local development and tests.

### `node-redis`

```ts
import { createClient } from "redis";
import {
  IdempotencyBuilder,
  RedisStore,
  createNodeRedisExecutor,
} from "@xyph3r/idempotency";

const client = createClient({ url: process.env.REDIS_URL });
await client.connect();

export const idempotency = new IdempotencyBuilder()
  .useStore(new RedisStore(createNodeRedisExecutor(client)))
  .withTTL(24 * 60 * 60 * 1_000)
  .withProcessingTTL(30_000)
  .withPollInterval(50)
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

export const idempotency = new IdempotencyBuilder()
  .useStore(new RedisStore(createIORedisExecutor(client)))
  .withTTL(24 * 60 * 60 * 1_000)
  .build();
```

## HTTP usage

For HTTP, the best pattern is:

- protect only side-effecting routes
- require the caller to send a stable idempotency key
- wrap the actual route handler, not a global middleware chain

The adapters default to `POST`, `PATCH`, and `PUT`.

### Express

`createExpressIdempotency()` wraps the route handler directly.

```ts
import express from "express";
import {
  IdempotencyBuilder,
  createExpressIdempotency,
} from "@xyph3r/idempotency";

const app = express();
app.use(express.json());

const idempotency = new IdempotencyBuilder()
  .withMemoryStore()
  .withTTL(24 * 60 * 60 * 1_000)
  .build();

app.post(
  "/payments",
  createExpressIdempotency(
    idempotency,
    async (request, response) => {
      const payment = await chargeCard(request.body);
      response.status(201);
      response.json?.(payment);
    },
    {
      key: (request) =>
        request.headers["idempotency-key"] as string | undefined,
    },
  ),
);
```

Use this for routes like:

- `POST /payments`
- `POST /orders`
- `POST /subscriptions/:id/cancel`

### Fastify

Wrap the route handler you register with Fastify.

```ts
import Fastify from "fastify";
import {
  IdempotencyBuilder,
  createFastifyIdempotency,
} from "@xyph3r/idempotency";

const app = Fastify();

const idempotency = new IdempotencyBuilder()
  .withMemoryStore()
  .withTTL(24 * 60 * 60 * 1_000)
  .build();

app.post(
  "/orders",
  createFastifyIdempotency(
    idempotency,
    async (request, reply) => {
      const order = await createOrder(request.body);
      reply.code(201);
      reply.send(order);
    },
    {
      key: (request) =>
        request.headers["idempotency-key"] as string | undefined,
    },
  ),
);
```

### Fetch / Bun / standard `Request` handlers

Use `createFetchIdempotency()` when your handler already looks like `(request) => Response`.

```ts
import {
  IdempotencyBuilder,
  createFetchIdempotency,
} from "@xyph3r/idempotency";

const idempotency = new IdempotencyBuilder()
  .withMemoryStore()
  .build();

const handler = createFetchIdempotency(
  idempotency,
  async (request) => {
    const body = await request.json();
    const payment = await chargeCard(body);
    return Response.json(payment, { status: 201 });
  },
  {
    key: (request) => request.headers.get("idempotency-key") ?? undefined,
  },
);
```

#### Bun example

```ts
import { createFetchIdempotency, IdempotencyBuilder } from "@xyph3r/idempotency";

const idempotency = new IdempotencyBuilder()
  .withMemoryStore()
  .build();

Bun.serve({
  fetch: createFetchIdempotency(
    idempotency,
    async (request) => {
      const body = await request.json();
      const result = await createCheckout(body);
      return Response.json(result, { status: 201 });
    },
    {
      key: (request) => request.headers.get("idempotency-key") ?? undefined,
    },
  ),
});
```

### Hono

Wrap the Hono route handler itself.

```ts
import { Hono } from "hono";
import {
  IdempotencyBuilder,
  createHonoIdempotency,
} from "@xyph3r/idempotency";

const app = new Hono();

const idempotency = new IdempotencyBuilder()
  .withMemoryStore()
  .build();

app.post(
  "/payments",
  createHonoIdempotency(
    idempotency,
    async (c) => {
      const body = await c.req.raw.json();
      const payment = await chargeCard(body);
      return c.json(payment, 201);
    },
    {
      key: (c) => c.req.header("idempotency-key"),
    },
  ),
);
```

### Next.js App Router

Wrap the exported route handler.

```ts
import {
  IdempotencyBuilder,
  createNextIdempotency,
} from "@xyph3r/idempotency";

const idempotency = new IdempotencyBuilder()
  .withMemoryStore()
  .build();

export const POST = createNextIdempotency(
  idempotency,
  async (request) => {
    const body = await request.json();
    const order = await createOrder(body);
    return Response.json(order, { status: 201 });
  },
  {
    key: (request) => request.headers.get("idempotency-key") ?? undefined,
  },
);
```

If your key depends on route params:

```ts
export const POST = createNextIdempotency(
  idempotency,
  async (request, context: { params: { orderId: string } }) => {
    return Response.json({ orderId: context.params.orderId });
  },
  {
    key: (request, context) =>
      request.headers.get("idempotency-key") ??
      `${context.params.orderId}:${request.headers.get("x-request-id") ?? ""}`,
  },
);
```

## Event-driven usage

This is where the package becomes especially useful.

At-least-once delivery means duplicate events are normal. Consumers need a stable event key and must be safe to call twice.

### Webhook consumer

Use the provider event ID as the key.

```ts
import {
  IdempotencyBuilder,
  createIdempotentConsumer,
} from "@xyph3r/idempotency";

const idempotency = new IdempotencyBuilder()
  .withMemoryStore()
  .withTTL(7 * 24 * 60 * 60 * 1_000)
  .build();

const handleStripeEvent = createIdempotentConsumer(
  idempotency,
  async (event: { id: string; type: string; data: { object: { invoiceId: string } } }) => {
    if (event.type === "invoice.paid") {
      await markInvoicePaid(event.data.object.invoiceId);
    }
  },
  {
    key: (event) => event.id,
  },
);
```

### Queue / broker consumer

Use the message or event ID from the broker payload.

```ts
import {
  IdempotencyBuilder,
  createIdempotentConsumer,
} from "@xyph3r/idempotency";

const idempotency = new IdempotencyBuilder()
  .withMemoryStore()
  .build();

const handleOrderPaid = createIdempotentConsumer(
  idempotency,
  async (message: { eventId: string; orderId: string }) => {
    await reserveInventory(message.orderId);
    await createShipment(message.orderId);
  },
  {
    key: (message) => message.eventId,
  },
);
```

Use this when:

- the broker may redeliver after a worker crash
- a webhook sender retries until it gets `2xx`
- consumers trigger emails, charges, provisioning, or other side effects

## Generic function wrapper

If you do not want a framework adapter, wrap your function directly.

```ts
import {
  IdempotencyBuilder,
  createIdempotentHandler,
} from "@xyph3r/idempotency";

const idempotency = new IdempotencyBuilder()
  .withMemoryStore()
  .build();

const createPayment = createIdempotentHandler(
  idempotency,
  async (context: {
    body: unknown;
    headers: Record<string, string | undefined>;
  }) => {
    return chargeCard(context.body);
  },
  {
    key: (context) => context.headers["idempotency-key"],
  },
);
```

## Choosing the key

A good key must be stable across retries for the same logical operation.

Good keys:

- client-provided `Idempotency-Key`
- Stripe or GitHub webhook event ID
- broker message ID or event ID
- a server-generated operation ID returned earlier to the client

Bad keys:

- a random UUID generated inside the handler
- current timestamp
- request body hash if the same operation may legitimately repeat later

## Runtime behavior

By default:

- only `POST`, `PATCH`, and `PUT` are protected by the HTTP adapters
- duplicates wait briefly for the first execution to finish
- completed results are replayed
- failed executions are not stored as completed results

Headers added to HTTP responses:

- `idempotency-key`
- `idempotency-status: created | cached`

## Builder options

```ts
const idempotency = new IdempotencyBuilder()
  .useStore(store)
  .withTTL(24 * 60 * 60 * 1_000)
  .withProcessingTTL(30_000)
  .withPollInterval(50)
  .withInFlightStrategy("wait")
  .withDefaultHeader("idempotency-key")
  .withKeyPrefix("payments")
  .build();
```

Use `withInFlightStrategy("reject")` if you want duplicates to fail immediately while the first request is still running instead of waiting.

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
