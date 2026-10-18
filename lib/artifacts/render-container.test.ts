// @vitest-environment node
import { expect, it } from "vitest";
import { rendererContainerArgs } from "./render-container";
import { readFile } from "node:fs/promises";

it("builds a bounded offline container with no host secrets/socket and no shell interpolation", () => {
  const args = rendererContainerArgs("openlen/artifact-renderer:1", "openlen-artifact-11111111-1111-1111-1111-111111111111", "/tmp/output", 1001, 1001);
  expect(args).toContain("none"); expect(args).toContain("--read-only"); expect(args).toContain("no-new-privileges"); expect(args).toContain("2g"); expect(args).toContain("--pids-limit");
  expect(args.join(" ")).not.toMatch(/docker\.sock|DATABASE_URL|--privileged|SYS_ADMIN|--env|--network host/);
  expect(() => rendererContainerArgs("image;sh", "bad", "/tmp/output", 1, 1)).toThrow();
});

it("keeps the renderer install independent of the host application checkout",async()=>{
  const manifest=JSON.parse(await readFile(new URL("../../tools/artifact-renderer/package.json",import.meta.url),"utf8"));
  const lock=JSON.parse(await readFile(new URL("../../tools/artifact-renderer/package-lock.json",import.meta.url),"utf8"));
  expect(Object.values(manifest.dependencies).some(v=>String(v).startsWith("file:"))).toBe(false);
  expect(Object.values(lock.packages as Record<string,{link?:boolean}>).some(v=>v.link)).toBe(false);
  expect(Object.keys(lock.packages).every(key=>key===""||key.startsWith("node_modules/"))).toBe(true);
});
