// @vitest-environment node
// WHAT THE LIVE RELEASE SAYS, AND WHEN IT CAN'T SAY (round 3, D): `current` that doesn't exist is «no experiment»; `current`
// that can't be READ right now (an EIO, an EACCES, a directory where a link should be) is «unknown» — never «none»: the
// reconcile pass would close a healthy experiment over a split that is still live, and a launch's throw path would give its
// slot back over one.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fsm = vi.hoisted(() => ({ readlink: vi.fn(), readFile: vi.fn() }));
vi.mock("node:fs/promises", async (orig) => ({ ...(await orig<typeof import("node:fs/promises")>()), readlink: fsm.readlink, readFile: fsm.readFile }));
vi.mock("@/lib/publish/filesystem", () => ({ getPublishRoot: () => "/publish-root" }));

const { readLiveAb } = await import("./live-manifest");

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });
const MANIFEST = JSON.stringify({ version: 1, releaseSha: "rel-1", experiments: [{ id: "ab_1234abcd", cookieName: "_ol_ab_1234", targetPath: "/", splitBps: 3000, salt: "salt", prefixB: "openlen/ab/ab_1234abcd/b", includeLocales: false, overrides: ["/css/a.css"] }] });

beforeEach(() => {
  fsm.readlink.mockReset();
  fsm.readFile.mockReset();
});

describe("the real reader", () => {
  it("a release whose manifest names the experiment: live, with its sha, overrides and split", async () => {
    fsm.readlink.mockResolvedValue("releases/rel-1");
    fsm.readFile.mockResolvedValue(MANIFEST);
    expect(await readLiveAb("pan", "ab_1234abcd")).toEqual({ kind: "live", sha: "rel-1", overrides: ["/css/a.css"], splitBps: 3000 });
  });

  it("no `current` at all (never published, or unpublished): none, with no sha", async () => {
    fsm.readlink.mockRejectedValue(errno("ENOENT"));
    fsm.readFile.mockRejectedValue(errno("ENOENT"));
    expect(await readLiveAb("pan", "ab_1234abcd")).toEqual({ kind: "none", sha: null });
  });

  it("🔴 `current` that can't be read (EIO, EACCES) is UNKNOWN, not «no experiment»", async () => {
    for (const code of ["EIO", "EACCES", "EMFILE"]) {
      fsm.readlink.mockRejectedValue(errno(code));
      fsm.readFile.mockRejectedValue(errno(code));
      expect(await readLiveAb("pan", "ab_1234abcd"), code).toEqual({ kind: "unknown" });
    }
  });

  it("🔴 a link that resolves but whose manifest can't be read (EIO) is unknown too; a missing manifest is none", async () => {
    fsm.readlink.mockResolvedValue("releases/rel-1");
    fsm.readFile.mockRejectedValue(errno("EIO"));
    expect(await readLiveAb("pan", "ab_1234abcd")).toEqual({ kind: "unknown" });
    fsm.readFile.mockRejectedValue(errno("ENOENT"));
    expect(await readLiveAb("pan", "ab_1234abcd")).toEqual({ kind: "none", sha: "rel-1" });
  });

  it("the Windows marker file (a `current` that is a file with the sha) still reads", async () => {
    fsm.readlink.mockRejectedValue(errno("EINVAL"));
    fsm.readFile.mockImplementation(async (p: string) => {
      if (String(p).endsWith("current")) return "abc123\n";
      return MANIFEST;
    });
    expect(await readLiveAb("pan", "ab_1234abcd")).toMatchObject({ kind: "live", sha: "abc123" });
  });
});
