// @vitest-environment jsdom
//
// LEN WATCH in the workspace, with the REAL Spanish texts and fetch faked: the notice over the chat
// (its button, a gate sending to Publish) and the switches in Publish (publishing alone waits for
// fixing alone). Manual react-dom + act() harness, like mensaje-del-equipo.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import modalsDeploy from "@/messages/es/modalsDeploy.json";
import modalsDomain from "@/messages/es/modalsDomain.json";
import panelsChat from "@/messages/es/panelsChat.json";
import type { LenWatchStatus } from "@/lib/len-watch/types";
import { notifyFolderChanged, onFolderChanged } from "@/lib/lienzo/carpeta-cambiada";

import { LenWatchBanner } from "./len-watch-banner";
import { LenWatchSettings } from "./len-watch-settings";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SETTINGS = { autoFix: false, autoPublish: false, muted: false, locale: null };
const status = (incident: LenWatchStatus["incident"], isOwner = true): LenWatchStatus => ({ enabled: true, isOwner, settings: SETTINGS, incident });
const READY = { id: "i1", status: "fix_ready" as const, reason: null, summary: "Arreglado.", shipsUnpublished: true, createdAt: "2026-10-30T12:00:00.000Z" };

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function fakeFetch(get: LenWatchStatus, post?: { status: number; body: unknown }) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      if ((init?.method ?? "GET") === "GET") return new Response(JSON.stringify(get), { status: 200 });
      if (init?.method === "PUT") return new Response(JSON.stringify({ settings: { ...SETTINGS, ...JSON.parse(String(init.body)), locale: "es" } }), { status: 200 });
      return new Response(JSON.stringify(post?.body ?? {}), { status: post?.status ?? 200 });
    }),
  );
  return calls;
}

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="es" messages={{ panelsChat, modalsDeploy, modalsDomain }}>
        {node}
      </NextIntlClientProvider>,
    );
  });
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  return host;
}

describe("the Len Watch notice", () => {
  it("shows nothing without an incident", async () => {
    fakeFetch(status(null));
    const host = await mount(<LenWatchBanner projectId="p1" />);
    expect(host.querySelector("[data-len-watch-banner]")).toBeNull();
  });

  it("🔴 a fix waiting: says what would go out, and a gate sends to Publish", async () => {
    const calls = fakeFetch(status(READY), { status: 428, body: { error: "security_findings" } });
    const onOpenPublish = vi.fn();
    const host = await mount(<LenWatchBanner projectId="p1" onOpenPublish={onOpenPublish} />);
    const banner = host.querySelector('[data-len-watch-banner="ready"]');
    expect(banner?.textContent).toContain(panelsChat.lenWatch.ready);
    expect(banner?.textContent).toContain(panelsChat.lenWatch.shipsUnpublished);
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === panelsChat.lenWatch.approve)!;
    await act(async () => button.click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/projects/p1/len-watch/approve")).toBe(true);
    expect(onOpenPublish).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain(panelsChat.lenWatch.review);
  });

  it("🔴 the draft changed after Len's fix: says so, and «Publish anyway» confirms it", async () => {
    const calls = fakeFetch(status(READY), { status: 409, body: { error: "changed_since_fix" } });
    const host = await mount(<LenWatchBanner projectId="p1" />);
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === panelsChat.lenWatch.approve)!.click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(host.textContent).toContain(panelsChat.lenWatch.changed);
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === panelsChat.lenWatch.publishAnyway)!.click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.map((c) => c.body && JSON.parse(c.body))).toEqual([{}, { confirmChanged: true }]);
  });

  // Spec §5.5: Len's fix on its branch. The Publish modal publishes the DRAFT (with the crash and the owner's
  // half-done changes), so a gate on the branch is answered here, never there.
  describe("a gate on Len's fix on its branch", () => {
    const FP = "a".repeat(64);
    const FINDING = { key: "k1", source: "model", severity: "HIGH", category: "missing_authorization", file: "/src/lib/api.ts", line: 3, description: "Cualquiera puede leer las reservas", exploitScenario: "", recommendation: "" };
    /** The first approve answers `first`; the next ones, 200. */
    function approveFetch(first: { status: number; body: unknown }) {
      const posts: unknown[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          if ((init?.method ?? "GET") === "GET") return new Response(JSON.stringify(status(READY)), { status: 200 });
          posts.push(JSON.parse(String(init?.body)));
          return posts.length === 1 ? new Response(JSON.stringify(first.body), { status: first.status }) : new Response("{}", { status: 200 });
        }),
      );
      return posts;
    }
    const press = async (host: HTMLElement, text: string) => {
      await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!.click());
      await act(async () => new Promise((r) => setTimeout(r, 0)));
    };

    it("🔴 a security finding shows here, the Publish modal never opens, and «Publicar igual» approves with its fingerprint", async () => {
      const posts = approveFetch({ status: 428, body: { error: "security_findings", fingerprint: FP, status: "done", blocking: [FINDING], medium: [], accepted: [], branch: true } });
      const onOpenPublish = vi.fn();
      const host = await mount(<LenWatchBanner projectId="p1" onOpenPublish={onOpenPublish} />);
      await press(host, panelsChat.lenWatch.approve);
      expect(onOpenPublish).not.toHaveBeenCalled();
      expect(host.textContent).toContain(FINDING.description);
      await press(host, modalsDomain.security.publishAnyway);
      expect(posts).toEqual([{}, { acceptSecurityFingerprint: FP }]);
    });

    it("🔴 secrets missing in production: says which, and the Publish modal never opens", async () => {
      approveFetch({ status: 428, body: { error: "secrets_required", missing: ["STRIPE_SECRET_KEY", "RESEND_API_KEY"], branch: true } });
      const onOpenPublish = vi.fn();
      const host = await mount(<LenWatchBanner projectId="p1" onOpenPublish={onOpenPublish} />);
      await press(host, panelsChat.lenWatch.approve);
      expect(onOpenPublish).not.toHaveBeenCalled();
      expect(host.textContent).toContain(panelsChat.lenWatch.secretsMissing.replace("{names}", "STRIPE_SECRET_KEY, RESEND_API_KEY"));
    });

    it("the review still running after the wait: says to try again in a moment", async () => {
      approveFetch({ status: 428, body: { error: "security_review_pending", fingerprint: FP, branch: true } });
      const host = await mount(<LenWatchBanner projectId="p1" />);
      await press(host, panelsChat.lenWatch.approve);
      expect(host.textContent).toContain(panelsChat.lenWatch.reviewRunning);
    });

    it("any other gate on the branch: it says it couldn't, and the Publish modal never opens", async () => {
      approveFetch({ status: 428, body: { error: "something_new", branch: true } });
      const onOpenPublish = vi.fn();
      const host = await mount(<LenWatchBanner projectId="p1" onOpenPublish={onOpenPublish} />);
      await press(host, panelsChat.lenWatch.approve);
      expect(onOpenPublish).not.toHaveBeenCalled();
      expect(host.textContent).toContain(panelsChat.lenWatch.failed);
    });
  });

  it("🔴 its first look failed (the server was busy): it looks again 30 s later instead of staying blank", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      let calls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => (++calls === 1 ? new Response("", { status: 502 }) : new Response(JSON.stringify(status({ ...READY, status: "needs_owner" })), { status: 200 }))),
      );
      const host = await mount(<LenWatchBanner projectId="p1" />);
      expect(host.querySelector("[data-len-watch-banner]")).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(30_000);
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(host.querySelector('[data-len-watch-banner="down"]')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Len Watch off (404): it doesn't keep asking", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const fetchMock = vi.fn(async () => new Response("", { status: 404 }));
      vi.stubGlobal("fetch", fetchMock);
      await mount(<LenWatchBanner projectId="p1" />);
      await act(async () => {
        vi.advanceTimersByTime(90_000);
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("🔴 the fix (it changes tables) is in the draft and the site still down: «Publicar» opens Publish, not «Fix with Len»", async () => {
    fakeFetch(status({ ...READY, status: "needs_owner", reason: "needs_tables", fixBrought: true }));
    const onOpenPublish = vi.fn();
    const host = await mount(<LenWatchBanner projectId="p1" onOpenPublish={onOpenPublish} />);
    expect(host.querySelector('[data-len-watch-banner="publish"]')?.textContent).toContain(panelsChat.lenWatch.publishBrought);
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === panelsChat.lenWatch.fix)).toBe(false);
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === panelsChat.lenWatch.publishNow)!.click());
    expect(onOpenPublish).toHaveBeenCalledTimes(1);
  });

  it("a reader sees the notice but no button", async () => {
    fakeFetch(status({ ...READY, status: "needs_owner" }));
    const host = await mount(<LenWatchBanner projectId="p1" soloLectura />);
    expect(host.querySelector('[data-len-watch-banner="down"]')).toBeTruthy();
    expect(host.querySelector("button")).toBeNull();
  });
});

// Spec §5.5: Len published a fix from its branch; the draft doesn't have it until the owner brings it in.
describe("«Traer el arreglo» over the chat", () => {
  const FIX = modalsDeploy.lenWatch.fixPending;
  /** The state answers with the pending fix until it has been brought. */
  function bringFetch(answer: string) {
    let brought = false;
    const calls: { url: string; method: string; body?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
        if ((init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ ...status(null), pendingFix: brought ? null : { incidentId: "i1", branch: "len-watch/i1" } }), { status: 200 });
        if (answer === "brought") brought = true;
        return new Response(JSON.stringify({ status: answer }), { status: 200 });
      }),
    );
    return calls;
  }
  const bringButton = (host: HTMLElement) => [...host.querySelectorAll("button")].find((b) => b.textContent === FIX.bring)!;

  it("with a fix to bring, the banner offers «Traer el arreglo», and once brought, it goes and the canvas hears of it", async () => {
    const calls = bringFetch("brought");
    const changed = vi.fn();
    const stop = onFolderChanged("p1", changed);
    try {
      const host = await mount(<LenWatchBanner projectId="p1" />);
      expect(host.querySelector('[data-len-watch-banner="bring"]')).toBeTruthy();
      expect(host.textContent).toContain(FIX.title);
      await act(async () => {
        bringButton(host).click();
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(calls.find((c) => c.method === "POST")).toEqual({ url: "/api/projects/p1/len-watch/bring", method: "POST", body: JSON.stringify({ incidentId: "i1" }) });
      expect(host.querySelector("[data-len-watch-banner]")).toBeNull();
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it("handed to Len: the banner says Len is bringing it in", async () => {
    bringFetch("handed_to_len");
    const host = await mount(<LenWatchBanner projectId="p1" />);
    await act(async () => {
      bringButton(host).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.textContent).toContain(FIX.handedToLen);
  });

  /** The pending fix, brought somewhere else (the publish modal, the phone, Len's turn) when `gone` says so. */
  function pendingUntil(gone: () => boolean) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ...status(null), pendingFix: gone() ? null : { incidentId: "i1", branch: "len-watch/i1" } }), { status: 200 })),
    );
  }

  it("🔴 brought from the publish modal: the banner goes as soon as the folder changes", async () => {
    let brought = false;
    pendingUntil(() => brought);
    const host = await mount(<LenWatchBanner projectId="p1" />);
    expect(host.querySelector('[data-len-watch-banner="bring"]')).toBeTruthy();
    brought = true;
    await act(async () => {
      notifyFolderChanged("p1");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.querySelector("[data-len-watch-banner]")).toBeNull();
  });

  it("🔴 while a fix waits, it looks again every 30 s (Len bringing it, the phone)", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      let brought = false;
      pendingUntil(() => brought);
      const host = await mount(<LenWatchBanner projectId="p1" />);
      brought = true;
      await act(async () => {
        vi.advanceTimersByTime(30_000);
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(host.querySelector("[data-len-watch-banner]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the Len Watch switches", () => {
  it("publishing alone stays off until fixing alone is on; a change goes out with the interface language", async () => {
    const calls = fakeFetch(status(null));
    const host = await mount(<LenWatchSettings projectId="p1" />);
    const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([[true, false], [false, false], [false, true]]);
    await act(async () => boxes[1]!.click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(JSON.parse(put.body!)).toEqual({ autoFix: true, locale: "es" });
    expect(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[2]!.disabled).toBe(false);
  });

  it("someone who isn't the owner can't touch them", async () => {
    fakeFetch(status(null, false));
    const host = await mount(<LenWatchSettings projectId="p1" />);
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((b) => b.disabled)).toBe(true);
    expect(host.textContent).toContain(modalsDeploy.lenWatch.ownerOnly);
  });
});
