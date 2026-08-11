import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalFsAssetStorage } from "@/lib/projects/assets";

const originalUploadDir = process.env.OPENLEN_UPLOAD_DIR;
const originalBaseUrl = process.env.OPENLEN_APP_BASE_URL;
const temporaryRoots: string[] = [];

afterEach(async () => {
  if (originalUploadDir === undefined) delete process.env.OPENLEN_UPLOAD_DIR;
  else process.env.OPENLEN_UPLOAD_DIR = originalUploadDir;
  if (originalBaseUrl === undefined) delete process.env.OPENLEN_APP_BASE_URL;
  else process.env.OPENLEN_APP_BASE_URL = originalBaseUrl;
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("project asset storage contract", () => {
  it("writes new assets under their complete SHA-256 filename", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openlen-asset-storage-"));
    temporaryRoots.push(root);
    process.env.OPENLEN_UPLOAD_DIR = root;
    delete process.env.OPENLEN_APP_BASE_URL;
    const contents = Buffer.from("new project asset");
    const hash = createHash("sha256").update(contents).digest("hex");

    const metadata = await new LocalFsAssetStorage().put("project-1", contents, "webp", "image/webp");

    expect(metadata.filename).toBe(`${hash}.webp`);
    expect(metadata.url).toBe(`/api/projects/project-1/assets/${hash}.webp`);
    await expect(readFile(path.join(root, "project-1", `${hash}.webp`))).resolves.toEqual(contents);
  });

  it("keeps legacy sixteen-character filenames readable and listable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openlen-asset-storage-"));
    temporaryRoots.push(root);
    process.env.OPENLEN_UPLOAD_DIR = root;
    delete process.env.OPENLEN_APP_BASE_URL;
    const projectDir = path.join(root, "legacy-project");
    const filename = "0123456789abcdef.webp";
    const contents = Buffer.from("legacy project asset");
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, filename), contents);
    const assetStorage = new LocalFsAssetStorage();

    await expect(assetStorage.get("legacy-project", filename)).resolves.toEqual({ contents, contentType: "image/webp" });
    await expect(assetStorage.list("legacy-project")).resolves.toEqual([
      expect.objectContaining({
        filename,
        contentType: "image/webp",
        size: contents.length,
        url: `/api/projects/legacy-project/assets/${filename}`,
      }),
    ]);
  });
});
