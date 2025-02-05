type Nullable<T> = T | null;

export function removeNullValues<T>(
  obj: Record<string, Nullable<T>>
): Record<string, T> {
  const result: Record<string, T> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      result[key] = value as T;
    }
  }

  return result;
}
