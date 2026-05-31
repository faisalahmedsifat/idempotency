import test from "node:test";
import assert from "node:assert/strict";

import { createIdempotentHandler } from "../src/core/create-idempotent-handler.js";
import { IdempotencyBuilder } from "../src/core/idempotency-builder.js";
import {
  IdempotencyConfigurationError,
  IdempotencyInProgressError,
  MissingIdempotencyKeyError,
} from "../src/errors.js";

test("builder validates numeric configuration", () => {
  assert.throws(
    () => new IdempotencyBuilder().withTTL(0).build(),
    IdempotencyConfigurationError,
  );
  assert.throws(
    () => new IdempotencyBuilder().withProcessingTTL(0).build(),
    IdempotencyConfigurationError,
  );
  assert.throws(
    () => new IdempotencyBuilder().withPollInterval(0).build(),
    IdempotencyConfigurationError,
  );
});

test("manager replays a completed value without re-executing", async () => {
  const manager = new IdempotencyBuilder()
    .withMemoryStore()
    .withTTL(1_000)
    .withProcessingTTL(100)
    .withPollInterval(1)
    .build();

  let runs = 0;
  const first = await manager.execute("payment-1", async () => {
    runs += 1;
    return { ok: true };
  });

  first.value.ok = false;

  const second = await manager.execute("payment-1", async () => {
    runs += 1;
    return { ok: true };
  });

  assert.equal(runs, 1);
  assert.equal(first.status, "executed");
  assert.equal(second.status, "replayed");
  assert.deepEqual(second.value, { ok: true });
});

test("concurrent callers share a single execution", async () => {
  const manager = new IdempotencyBuilder()
    .withMemoryStore()
    .withTTL(1_000)
    .withProcessingTTL(100)
    .withPollInterval(1)
    .build();

  let runs = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const firstPromise = manager.execute("payment-2", async () => {
    runs += 1;
    await gate;
    return { ok: true };
  });

  const secondPromise = manager.execute("payment-2", async () => {
    runs += 1;
    return { ok: false };
  });

  release?.();

  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(runs, 1);
  assert.equal(first.status, "executed");
  assert.equal(second.status, "replayed");
  assert.deepEqual(second.value, { ok: true });
});

test("reject strategy surfaces in-flight conflicts", async () => {
  const manager = new IdempotencyBuilder()
    .withMemoryStore()
    .withInFlightStrategy("reject")
    .withTTL(1_000)
    .withProcessingTTL(100)
    .build();

  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const firstPromise = manager.execute("payment-3", async () => {
    await gate;
    return "ok";
  });

  await assert.rejects(
    () => manager.execute("payment-3", async () => "duplicate"),
    IdempotencyInProgressError,
  );

  release?.();
  await firstPromise;
});

test("clear removes stored results for a specific key", async () => {
  const manager = new IdempotencyBuilder()
    .withMemoryStore()
    .withTTL(1_000)
    .build();

  await manager.execute("a", async () => "first");
  await manager.execute("b", async () => "second");
  await manager.clear("a");

  const nextA = await manager.execute("a", async () => "third");
  const nextB = await manager.execute("b", async () => "ignored");

  assert.equal(nextA.status, "executed");
  assert.equal(nextA.value, "third");
  assert.equal(nextB.status, "replayed");
  assert.equal(nextB.value, "second");
});

test("generic handler wrapper enforces missing key behavior", async () => {
  const manager = new IdempotencyBuilder().withMemoryStore().build();

  const strictHandler = createIdempotentHandler(
    manager,
    async (value: { body: string }) => value.body.toUpperCase(),
    {
      key: async () => undefined,
    },
  );

  await assert.rejects(() => strictHandler({ body: "hello" }), MissingIdempotencyKeyError);

  let runs = 0;
  const permissiveHandler = createIdempotentHandler(
    manager,
    async (value: { body: string }) => {
      runs += 1;
      return value.body.toUpperCase();
    },
    {
      allowMissingKey: true,
      key: async () => undefined,
    },
  );

  assert.equal(await permissiveHandler({ body: "hello" }), "HELLO");
  assert.equal(await permissiveHandler({ body: "world" }), "WORLD");
  assert.equal(runs, 2);
});
