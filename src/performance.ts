export function historyLines(requested: number, cells: number, sessions: number, cols: number) {
  return Math.max(
    0,
    Math.min(requested, Math.floor(cells / Math.max(1, sessions) / Math.max(1, cols))),
  );
}
export function withoutKey<T>(value: Record<string, T>, key: string): Record<string, T> {
  if (!(key in value)) return value;
  const next = { ...value };
  delete next[key];
  return next;
}
// Insertion-order LRU for cached directories, preserving the currently visible path.
export function cacheDirectory<T>(value: Record<string, T>, key: string, item: T, limit = 64) {
  const next = { ...withoutKey(value, key), [key]: item };
  for (const old of Object.keys(next).slice(0, Math.max(0, Object.keys(next).length - limit)))
    delete next[old];
  let entries = Object.values(next).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
  for (const old of Object.keys(next)) {
    if (entries <= 4000 || old === key) break;
    if (Array.isArray(next[old])) entries -= (next[old] as unknown[]).length;
    delete next[old];
  }
  return next;
}
