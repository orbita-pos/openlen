import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryBlobStore } from "@/lib/backend/storage/blob-store";

import { deliveryStoreFrom } from "./deliveries";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

// Where what `present` delivers is kept (spec local 2026-10-26-len-skills, §4.9): private. On the box
// the artifacts folder is written ONLY by its worker (infra/app/openlen-artifacts-worker.service), so
// Next keeps them in the private R2 bucket it already writes, the one of the pages' Storage.
describe("deliveryStoreFrom", () => {
  it("with the private bucket: keeps the bytes there, private and never cached", async () => {
    const blob = new MemoryBlobStore();
    const put = vi.spyOn(blob, "put");
    const store = deliveryStoreFrom(blob, { NODE_ENV: "production" })!;
    await store.put("deliveries/p1/t1/ab12cd34-a.xlsx", new Uint8Array([1, 2, 3]), "application/vnd.ms-excel");
    expect(put.mock.calls[0]![2]).toMatchObject({ contentType: "application/vnd.ms-excel", cacheControl: "private, no-store" });
    expect([...(await store.get("deliveries/p1/t1/ab12cd34-a.xlsx"))!]).toEqual([1, 2, 3]);
    expect(await store.get("deliveries/p1/t1/ab12cd34-b.xlsx")).toBeNull();
  });

  it("without it, outside production: the development private folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "len-deliveries-"));
    roots.push(root);
    const store = deliveryStoreFrom(null, { NODE_ENV: "development", OPENLEN_ARTIFACTS_DIR: root })!;
    await store.put("deliveries/p1/t1/ab12cd34-a.docx", new Uint8Array([9]), "application/octet-stream");
    expect([...(await store.get("deliveries/p1/t1/ab12cd34-a.docx"))!]).toEqual([9]);
    expect(await store.get("deliveries/p1/t1/ab12cd34-nada.docx")).toBeNull();
  });

  it("in production without the bucket there is none: never the worker's folder", () => {
    expect(deliveryStoreFrom(null, { NODE_ENV: "production", OPENLEN_ARTIFACTS_DIR: "/var/openlen/artifacts" })).toBeNull();
  });
});
