// @vitest-environment node
// What the image modal lists as «your uploads» from the folder (LOCAL database only, schema pushed).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";

import { makePointer } from "./blob-pointer";
import { listFolderMedia } from "@/lib/backend/files";

const OWNER = "test-media-owner";
const PROJECT = "test-media-project";

async function clean() {
  await db.execute(sql`delete from "projectFiles" where "projectId" = ${PROJECT}`);
  await db.execute(sql`delete from "projects" where "id" = ${PROJECT}`);
}

beforeAll(async () => {
  await exigirBaseLocal();
  await db.execute(sql`insert into "users" ("id", "email", "name") values (${OWNER}, ${`${OWNER}@example.invalid`}, ${"Owner"}) on conflict do nothing`);
  await clean();
  await db.execute(sql`insert into "projects" ("id", "userId", "title", "brief", "data") values (${PROJECT}, ${OWNER}, ${"m"}, ${""}, ${JSON.stringify({ html: "x" })}::jsonb)`);
  const png = makePointer({ sha256: "a".repeat(64), size: 1234, gitOid: "b".repeat(40) });
  await db.execute(sql`insert into "projectFiles" ("projectId", "path", "content", "updatedAt") values
    (${PROJECT}, ${"/img/foto.webp"}, ${png}, ${new Date("2026-10-28T10:00:00Z")}),
    (${PROJECT}, ${"/img/logo.svg"}, ${"<svg/>"}, ${new Date("2026-10-28T11:00:00Z")}),
    (${PROJECT}, ${"/video/intro.mp4"}, ${png}, ${new Date("2026-10-28T09:00:00Z")}),
    (${PROJECT}, ${"/js/app.js"}, ${"x"}, ${new Date("2026-10-28T12:00:00Z")})`);
});

afterAll(async () => {
  await clean();
  await db.execute(sql`delete from "users" where "id" = ${OWNER}`);
});

describe("listFolderMedia", () => {
  it("the images and videos of the folder, newest first, with their size and a path the page can use", async () => {
    const media = await listFolderMedia(PROJECT);
    // The column is a timestamp without zone: the hour depends on the machine's; the order doesn't.
    expect(media.map(({ uploadedAt: _u, ...m }) => m)).toEqual([
      { filename: "logo.svg", contentType: "image/svg+xml", size: 6, url: "/img/logo.svg" },
      { filename: "foto.webp", contentType: "image/webp", size: 1234, url: "/img/foto.webp" },
      { filename: "intro.mp4", contentType: "video/mp4", size: 1234, url: "/video/intro.mp4" },
    ]);
    expect(media[0]!.uploadedAt).toBeGreaterThan(media[1]!.uploadedAt);
    expect(media[1]!.uploadedAt).toBeGreaterThan(media[2]!.uploadedAt);
  });
});
