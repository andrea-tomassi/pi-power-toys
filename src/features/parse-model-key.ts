/**
 * Parse a model key "provider:model_id" into [provider, modelId].
 */
export function parseModelKey(key: string): [string, string] | null {
  const sep = key.indexOf(":");
  if (sep === -1 || sep === 0 || sep === key.length - 1) return null;
  return [key.slice(0, sep), key.slice(sep + 1)];
}
