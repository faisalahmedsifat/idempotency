import { IdempotencyConfigurationError } from "../errors.js";

export function normalizeKey(rawKey: string, prefix?: string): string {
  const trimmed = rawKey.trim();
  if (trimmed.length === 0) {
    throw new IdempotencyConfigurationError(
      "Idempotency keys must be non-empty strings.",
    );
  }

  return prefix ? `${prefix}:${trimmed}` : trimmed;
}
