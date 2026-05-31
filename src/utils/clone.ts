export function cloneValue<TValue>(value: TValue): TValue {
  if (value === null || value === undefined) {
    return value;
  }

  return structuredClone(value);
}
