// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { postPublish, postPublishAfterSecurity } from "./publish-request";

const FP = "e".repeat(64);
const view = { fingerprint: FP, status: "done", blocking: [{ key: "k" }], medium: [], accepted: [] };

afterEach(() => vi.unstubAllGlobals());

function replies(...rs: { status: number; body: unknown }[]) {
  const posts: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    posts.push(JSON.parse(String(init?.body)));
    const r = rs.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }));
  return posts;
}

describe("postPublish and the security review", () => {
  it("428 security_findings → the view", async () => {
    replies({ status: 428, body: { error: "security_findings", ...view } });
    expect(await postPublish("p1", {})).toEqual({ kind: "security_findings", view });
  });

  it("428 security_review_pending → its fingerprint", async () => {
    replies({ status: 428, body: { error: "security_review_pending", fingerprint: FP } });
    expect(await postPublish("p1", {})).toEqual({ kind: "security_review_pending", fingerprint: FP });
  });

  it("postPublishAfterSecurity waits for a running review and sends again, showing what it waits for", async () => {
    const posts = replies({ status: 428, body: { error: "security_review_pending", fingerprint: FP } }, { status: 200, body: { url: "https://x.openlen.app" } });
    const seen: string[] = [];
    const out = await postPublishAfterSecurity("p1", { subdomain: "x" }, (v) => seen.push(v.status), async () => ({ ...view, status: "done", blocking: [] }) as never);
    expect(out.kind).toBe("published");
    expect(seen).toEqual(["running", "done"]);
    expect(posts).toHaveLength(2);
  });

  it("gives up after three waits and answers pending", async () => {
    replies(...Array.from({ length: 4 }, () => ({ status: 428, body: { error: "security_review_pending", fingerprint: FP } })));
    const out = await postPublishAfterSecurity("p1", {}, () => {}, async () => null);
    expect(out).toEqual({ kind: "security_review_pending", fingerprint: FP });
  });
});
