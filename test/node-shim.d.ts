declare module "node:test" {
  export interface TestContext {}

  export default function test(
    name: string,
    fn: (context: TestContext) => void | Promise<void>,
  ): void;
}

declare module "node:assert/strict" {
  export interface Assert {
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    equal(actual: unknown, expected: unknown, message?: string): void;
    rejects(
      block: () => Promise<unknown>,
      error?: new (...args: never[]) => Error | { message?: string; name?: string },
      message?: string,
    ): Promise<void>;
    throws(
      block: () => unknown,
      error?: new (...args: never[]) => Error | { message?: string; name?: string },
      message?: string,
    ): void;
  }

  const assert: Assert;
  export default assert;
}
