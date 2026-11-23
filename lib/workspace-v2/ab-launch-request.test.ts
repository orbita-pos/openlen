// @vitest-environment node
// «Lanzar 50/50» and the security review (seen in production on 23/11): the launch answered 428 `security_review_pending`
// while variant B's review was still running, and the dialog printed the server's English sentence as if the review had
// found something. Like publishing (`throughSecurity` in publish-request.ts), the launch now waits for the review and
// sends again by itself; what it can't do comes back as a code the dialog words in the person's language.
import { describe, expect, it, vi } from "vitest";

import { postAbLaunchAfterSecurity } from "./ab-launch-request";

const FP = "f".repeat(64);
const experiment = { id: "ab_1", projectId: "p1", status: "running" };
const PENDING = { status: 428, body: { error: "security_review_pending", message: "Security review requires attention before launching Variant B.", fingerprint: FP } };

function sender(...rs: { status: number; body: unknown }[]) {
  const calls: { url: string; body: unknown }[] = [];
  const send = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const r = rs.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
  return { send, calls };
}

describe("postAbLaunchAfterSecurity", () => {
  it("a review still running is waited for, and the launch is sent again by itself", async () => {
    const { send, calls } = sender(PENDING, { status: 200, body: { experiment } });
    const wait = vi.fn(async () => ({ fingerprint: FP, status: "done", blocking: [], medium: [], accepted: [] }) as never);
    const waiting = vi.fn();
    const out = await postAbLaunchAfterSecurity("p1", "ab_1", { locale: "es" }, { send, wait, onWaiting: waiting });
    expect(out).toEqual({ kind: "launched", experiment });
    expect(wait).toHaveBeenCalledWith("p1", FP);
    expect(waiting).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.url)).toEqual(["/api/projects/p1/ab/ab_1/launch", "/api/projects/p1/ab/ab_1/launch"]);
    expect(calls[1]!.body).toEqual({ locale: "es" });
  });

  it("gives up after three waits and says the review is still running", async () => {
    const { send, calls } = sender(PENDING, PENDING, PENDING, PENDING);
    const wait = vi.fn(async () => null);
    expect(await postAbLaunchAfterSecurity("p1", "ab_1", {}, { send, wait })).toEqual({ kind: "security_review_pending" });
    expect(wait).toHaveBeenCalledTimes(3);
    expect(calls).toHaveLength(4);
  });

  it("findings are their own answer, never waited on", async () => {
    const { send } = sender({ status: 428, body: { error: "security_findings", message: "Security review requires attention before launching Variant B.", fingerprint: FP, blocking: [{ key: "k" }] } });
    const wait = vi.fn();
    expect(await postAbLaunchAfterSecurity("p1", "ab_1", {}, { send, wait })).toEqual({ kind: "security_findings" });
    expect(wait).not.toHaveBeenCalled();
  });

  it("any other refusal is its code — the server's English sentence never reaches the dialog", async () => {
    const { send } = sender({ status: 409, body: { error: "base_moved", message: "The published page changed since Variant B was made." } });
    const out = await postAbLaunchAfterSecurity("p1", "ab_1", {}, { send, wait: vi.fn() });
    expect(out).toEqual({ kind: "error", error: "base_moved" });
    expect(JSON.stringify(out)).not.toContain("published page changed");
  });

  it("a network failure is an error, not a throw", async () => {
    const send = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await postAbLaunchAfterSecurity("p1", "ab_1", {}, { send, wait: vi.fn() })).toEqual({ kind: "error", error: "network" });
  });
});
