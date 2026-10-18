// @vitest-environment node
import { expect, it } from "vitest";
import { rendererContainerArgs } from "./render-container";

it("builds a bounded offline container with no host secrets/socket and no shell interpolation", () => {
  const args = rendererContainerArgs("openlen/artifact-renderer:1", "openlen-artifact-11111111-1111-1111-1111-111111111111", "/tmp/output", 1001, 1001);
  expect(args).toContain("none"); expect(args).toContain("--read-only"); expect(args).toContain("no-new-privileges"); expect(args).toContain("2g"); expect(args).toContain("--pids-limit");
  expect(args.join(" ")).not.toMatch(/docker\.sock|DATABASE_URL|--privileged|SYS_ADMIN|--env|--network host/);
  expect(() => rendererContainerArgs("image;sh", "bad", "/tmp/output", 1, 1)).toThrow();
});
