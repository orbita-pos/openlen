// At most `limit` at a time: the cache's puts (an upload to R2 each) and
// esm.sh's refetches are network round trips; one after another they add up
// to seconds on a package with dozens of modules.
export const NETWORK_CONCURRENCY = 8;

/** `fn` over `items`, at most `limit` running at once; the results in the order of `items`. */
export async function mapLimited<T, R>(items: readonly T[], fn: (item: T) => Promise<R>, limit = NETWORK_CONCURRENCY): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
