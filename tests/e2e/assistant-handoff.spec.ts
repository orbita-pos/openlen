// AI→human handoff — e2e on the real baked widgets. Bakes BOTH the site
// assistant and the private chat (in handoff-target mode) into a fixture page,
// hosts it in an iframe, stubs fetch, and drives the escalation: assistant
// "Hablar con una persona" → /api/chat/<sub>/handoff → window.__openlenChat
// opens the human chat panel. No Next app / DB / Gemini needed.

import { test, expect, type Frame, type Page } from "@playwright/test";
import { bakeAssistantWidget } from "../../lib/publish/assistant-widget";
import { bakeChatWidget } from "../../lib/publish/chat-widget";

const SUB = "acme";

function bakedPage(): string {
  const base = `<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body style="margin:0"><h1>Page</h1></body></html>`;
  // Prod bake order: assistant first, then chat (chat script lands later, boots
  // after — its window.__openlenChat is ready by the time the user escalates).
  const withAssistant = bakeAssistantWidget(base, {
    sub: SUB,
    apiBase: "",
    businessName: "Acme",
    chatHandoff: true,
  });
  return bakeChatWidget(withAssistant, {
    sub: SUB,
    mount: "fab",
    selfServeJoin: true,
    chatAsHandoffTarget: true,
  });
}

async function setup(page: Page): Promise<Frame> {
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><iframe id="f" style="width:1000px;height:740px;border:0;display:block"></iframe></body></html>`,
  );
  await page.evaluate(
    (html) =>
      new Promise<void>((resolve) => {
        const f = document.getElementById("f") as HTMLIFrameElement;
        f.addEventListener("load", () => resolve(), { once: true });
        f.srcdoc = html;
      }),
    bakedPage(),
  );
  return page.mainFrame().childFrames()[0];
}

// Install fetch stub + shadow-root locators the tests reuse.
async function instrument(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    type W = Window & { __calls?: string[]; __olTest?: Record<string, unknown> };
    const w = window as W;
    w.__calls = [];
    window.fetch = ((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
      w.__calls!.push(url);
      let body: unknown = {};
      if (url.indexOf("/handoff") >= 0) body = { conversation: { id: "conv-1" } };
      else if (url.indexOf("/me") >= 0) body = { user: { id: "u1", displayName: "Guest" } };
      else if (url.indexOf("/messages") >= 0) body = { messages: [], nextCursor: null };
      else if (url.indexOf("/conversations") >= 0) body = { conversations: [] };
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
      );
    }) as typeof fetch;
    // Locators (shadow roots aren't queryable from Playwright selectors).
    w.__olTest = {
      assistantSR() {
        const divs = document.querySelectorAll("div");
        for (const d of Array.from(divs)) {
          const sr = (d as HTMLElement & { shadowRoot?: ShadowRoot }).shadowRoot;
          if (sr && sr.querySelector(".btn") && sr.querySelector(".hd")) return sr;
        }
        return null;
      },
      chatSR() {
        const hosts = document.querySelectorAll("[data-ol-chat-host]");
        for (const h of Array.from(hosts)) {
          const sr = (h as HTMLElement & { shadowRoot?: ShadowRoot }).shadowRoot;
          if (sr) return sr;
        }
        return null;
      },
    };
  });
}

test.describe("AI → human handoff", () => {
  test("chat bakes as a FAB-less handoff target and exposes window.__openlenChat", async ({ page }) => {
    const frame = await setup(page);
    // Global is exposed by the chat widget's handoff-target boot path.
    await expect
      .poll(() => frame.evaluate(() => typeof (window as unknown as { __openlenChat?: unknown }).__openlenChat === "object"))
      .toBe(true);
    // The chat widget renders NO floating FAB BUTTON of its own (assistant is
    // the launcher). Note: the panel div carries a ".fab" layout class, so we
    // must match the button specifically, not any ".fab".
    const chatHasFab = await frame.evaluate(() => {
      const hosts = document.querySelectorAll("[data-ol-chat-host]");
      for (const h of Array.from(hosts)) {
        if ((h as HTMLElement & { shadowRoot?: ShadowRoot }).shadowRoot?.querySelector("button.fab")) return true;
      }
      return false;
    });
    expect(chatHasFab).toBe(false);
  });

  test("assistant shows the 'Hablar con una persona' CTA when chat is enabled", async ({ page }) => {
    const frame = await setup(page);
    const hasTalk = await frame.evaluate(() => {
      const divs = document.querySelectorAll("div");
      for (const d of Array.from(divs)) {
        const sr = (d as HTMLElement & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (sr && sr.querySelector(".btn") && sr.querySelector(".talk")) return true;
      }
      return false;
    });
    expect(hasTalk).toBe(true);
  });

  test("escalation posts to /handoff and opens the human chat panel", async ({ page }) => {
    const frame = await setup(page);
    await instrument(frame);

    // Open the assistant, click the CTA, fill the name, submit the handoff form.
    await frame.evaluate(() => {
      const w = window as unknown as { __olTest: { assistantSR: () => ShadowRoot | null } };
      const sr = w.__olTest.assistantSR();
      if (!sr) throw new Error("assistant shadow root not found");
      (sr.querySelector(".btn") as HTMLElement).click();
      (sr.querySelector(".talk") as HTMLElement).click();
      const form = sr.querySelector("form.lead") as HTMLFormElement;
      (form.querySelector('input[name=nombre]') as HTMLInputElement).value = "María";
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    // The handoff endpoint was called…
    await expect
      .poll(() =>
        frame.evaluate(() =>
          (window as unknown as { __calls: string[] }).__calls.some((u) => u.indexOf(`/api/chat/${"acme"}/handoff`) >= 0),
        ),
      )
      .toBe(true);

    // …and the human chat panel opened onto the escalated conversation.
    await expect
      .poll(() =>
        frame.evaluate(() => {
          const hosts = document.querySelectorAll("[data-ol-chat-host]");
          for (const h of Array.from(hosts)) {
            const p = (h as HTMLElement & { shadowRoot?: ShadowRoot }).shadowRoot?.querySelector(".panel");
            if (p && p.classList.contains("open")) return true;
          }
          return false;
        }),
      )
      .toBe(true);
  });
});
