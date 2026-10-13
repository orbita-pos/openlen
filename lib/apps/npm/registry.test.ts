import { beforeEach, describe, expect, it } from "vitest";
import { clearPackumentCache, getPackument, MAX_CACHED_PACKUMENTS, type FetchLike } from "./registry";

/** A registry that answers every package with an ETag, and 304 when asked with it. */
function registry() {
  const seen: { name: string; ifNoneMatch: string | null }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const name = decodeURIComponent(url.split("/").pop()!);
    const ifNoneMatch = new Headers(init?.headers).get("if-none-match");
    seen.push({ name, ifNoneMatch });
    if (ifNoneMatch === `"${name}"`) return new Response(null, { status: 304 });
    return Response.json({ name, "dist-tags": {}, versions: {}, time: {} }, { headers: { etag: `"${name}"` } });
  };
  return { seen, fetchImpl };
}

beforeEach(() => clearPackumentCache());

describe("the packument cache", () => {
  it("revalidates with the ETag while the document is cached", async () => {
    const r = registry();
    await getPackument("a", r.fetchImpl);
    expect((await getPackument("a", r.fetchImpl))?.name).toBe("a");
    expect(r.seen.map((s) => s.ifNoneMatch)).toEqual([null, '"a"']);
  });

  it("🔴 keeps at most MAX_CACHED_PACKUMENTS documents (some weigh megabytes): the least recently used goes", async () => {
    const r = registry();
    await getPackument("first", r.fetchImpl);
    await getPackument("kept", r.fetchImpl);
    for (let i = 0; i < MAX_CACHED_PACKUMENTS - 2; i++) await getPackument(`p${i}`, r.fetchImpl);
    // Used again: it becomes the most recent.
    await getPackument("kept", r.fetchImpl);
    await getPackument("one-more", r.fetchImpl);
    r.seen.length = 0;
    await getPackument("first", r.fetchImpl);
    await getPackument("kept", r.fetchImpl);
    expect(r.seen).toEqual([
      { name: "first", ifNoneMatch: null },
      { name: "kept", ifNoneMatch: '"kept"' },
    ]);
  });
});
