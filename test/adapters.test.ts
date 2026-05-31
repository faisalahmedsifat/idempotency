import test from "node:test";
import assert from "node:assert/strict";

import { createExpressIdempotency } from "../src/adapters/express.js";
import { createFastifyIdempotency } from "../src/adapters/fastify.js";
import { createFetchIdempotency } from "../src/adapters/fetch.js";
import { createNextIdempotency } from "../src/adapters/next.js";
import { createIdempotentConsumer } from "../src/consumer/create-idempotent-consumer.js";
import { IdempotencyBuilder } from "../src/core/idempotency-builder.js";
import {
  createMockExpressResponse,
  createMockFastifyReply,
} from "./helpers/mock-http.js";

test("fetch adapter replays the original response on retry", async () => {
  const manager = new IdempotencyBuilder()
    .withMemoryStore()
    .withTTL(1_000)
    .withProcessingTTL(100)
    .withPollInterval(1)
    .build();

  let runs = 0;
  const handler = createFetchIdempotency(
    manager,
    async () => {
      runs += 1;
      return Response.json({ ok: true }, { status: 201 });
    },
    {
      key: async () => "payment-1",
    },
  );

  const first = await handler(new Request("https://example.com", { method: "POST" }), undefined);
  const second = await handler(new Request("https://example.com", { method: "POST" }), undefined);

  assert.equal(runs, 1);
  assert.equal(first.status, 201);
  assert.equal(first.headers.get("idempotency-status"), "created");
  assert.deepEqual(await first.json(), { ok: true });
  assert.equal(second.status, 201);
  assert.equal(second.headers.get("idempotency-status"), "cached");
  assert.deepEqual(await second.json(), { ok: true });
});

test("express adapter sends once and replays cached json bodies", async () => {
  const manager = new IdempotencyBuilder()
    .withMemoryStore()
    .withTTL(1_000)
    .withProcessingTTL(100)
    .withPollInterval(1)
    .build();

  let runs = 0;
  const handler = createExpressIdempotency(
    manager,
    async (_request, response) => {
      runs += 1;
      response.status(201);
      response.json?.({ ok: true });
    },
    {
      key: async () => "payment-2",
    },
  );

  const firstResponse = createMockExpressResponse();
  await handler({ headers: {}, method: "POST" }, firstResponse, () => {});
  const secondResponse = createMockExpressResponse();
  await handler({ headers: {}, method: "POST" }, secondResponse, () => {});

  assert.equal(runs, 1);
  assert.equal(firstResponse.statusCode, 201);
  assert.equal(firstResponse.headers["idempotency-status"], "created");
  assert.deepEqual(firstResponse.jsonBody, { ok: true });
  assert.equal(secondResponse.statusCode, 201);
  assert.equal(secondResponse.headers["idempotency-status"], "cached");
  assert.deepEqual(secondResponse.jsonBody, { ok: true });
});

test("fastify adapter preserves return-value handlers and replays through reply", async () => {
  const manager = new IdempotencyBuilder()
    .withMemoryStore()
    .withTTL(1_000)
    .withProcessingTTL(100)
    .withPollInterval(1)
    .build();

  let runs = 0;
  const handler = createFastifyIdempotency(
    manager,
    async () => {
      runs += 1;
      return { ok: true };
    },
    {
      key: async () => "payment-3",
    },
  );

  const firstReply = createMockFastifyReply();
  const firstValue = await handler({ headers: {}, method: "POST" }, firstReply);
  const secondReply = createMockFastifyReply();
  const secondValue = await handler({ headers: {}, method: "POST" }, secondReply);

  assert.equal(runs, 1);
  assert.deepEqual(firstValue, { ok: true });
  assert.equal(firstReply.payload, undefined);
  assert.equal(secondValue, undefined);
  assert.equal(secondReply.headers["idempotency-status"], "cached");
  assert.deepEqual(secondReply.payload, { ok: true });
});

test("next adapter reuses fetch semantics", async () => {
  const manager = new IdempotencyBuilder()
    .withMemoryStore()
    .withTTL(1_000)
    .build();

  let runs = 0;
  const handler = createNextIdempotency(
    manager,
    async (_request, context: { params: { id: string } }) => {
      runs += 1;
      return Response.json({ id: context.params.id });
    },
    {
      key: async (_request, context) => context.params.id,
    },
  );

  const first = await handler(new Request("https://example.com", { method: "POST" }), {
    params: { id: "route-1" },
  });
  const second = await handler(new Request("https://example.com", { method: "POST" }), {
    params: { id: "route-1" },
  });

  assert.equal(runs, 1);
  assert.deepEqual(await first.json(), { id: "route-1" });
  assert.deepEqual(await second.json(), { id: "route-1" });
});

test("consumer wrapper deduplicates duplicate events", async () => {
  const manager = new IdempotencyBuilder()
    .withMemoryStore()
    .withTTL(1_000)
    .build();

  let runs = 0;
  const consumer = createIdempotentConsumer(
    manager,
    async (event: { id: string; type: string }) => {
      runs += 1;
      return { handled: event.type };
    },
    {
      key: async (event) => event.id,
    },
  );

  const first = await consumer({ id: "evt_1", type: "invoice.paid" });
  const second = await consumer({ id: "evt_1", type: "invoice.paid" });

  assert.equal(runs, 1);
  assert.deepEqual(first, { handled: "invoice.paid" });
  assert.deepEqual(second, { handled: "invoice.paid" });
});
