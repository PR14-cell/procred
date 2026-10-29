export function encodeDatabaseJsonValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return { __providerCredentialingBinary: value.toString('base64') };
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(encodeDatabaseJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, encodeDatabaseJsonValue(child)])
    );
  }
  return value;
}

export function decodeDatabaseJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeDatabaseJsonValue);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (
      Object.keys(record).length === 1 &&
      typeof record.__providerCredentialingBinary === 'string'
    ) {
      return Buffer.from(record.__providerCredentialingBinary, 'base64');
    }
    if (record.type === 'Buffer' && Array.isArray(record.data)) {
      return Buffer.from(record.data as number[]);
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, child]) => [key, decodeDatabaseJsonValue(child)])
    );
  }
  return value;
}
