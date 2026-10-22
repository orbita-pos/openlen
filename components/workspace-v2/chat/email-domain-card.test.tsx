// @vitest-environment jsdom
//
// THE EMAIL DOMAIN'S CARD (spec local 2026-10-22-email-integration, 6.8): what
// Len shows with connect_email_domain. The card connects through the Correos
// tab's own route, and up to the turn goes only the address it will send from.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { QuestionAnswer, UserQuestion } from "@/lib/agent/ask-user-question";
import { QuestionCardView } from "./question-card";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const t = (key: string, values?: Record<string, string>) => (values ? `${key}(${Object.values(values).join(",")})` : key);
const QUESTION: UserQuestion[] = [{ id: "email-domain", question: "Connect the project's email domain.", intent: { kind: "email-domain" } }];
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function mount(o: { answer?: string | null; onAnswer?: (a: QuestionAnswer[]) => void } = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<QuestionCardView question="" questions={QUESTION} answer={o.answer ?? null} projectId="p1" t={t} onAnswer={o.onAnswer ?? (() => {})} />));
  return host;
}

function server(post: { status: number; body: unknown }) {
  const calls: { method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const r = init?.method === "POST" ? post : { status: 200, body: { available: true, plan: "pro", domain: null, suggestedDomain: "taller.mx" } };
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const button = (host: HTMLElement, label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;

describe("the email domain's card", () => {
  it("proposes the project's domain, connects it, and answers with the sending address", async () => {
    const calls = server({ status: 200, body: { available: true, plan: "pro", domain: { sendingHost: "notify.taller.mx" } } });
    const answers: QuestionAnswer[][] = [];
    const host = mount({ onAnswer: (a) => answers.push(a) });
    await settle();
    const input = host.querySelector<HTMLInputElement>("input[type=text]")!;
    expect(input.value).toBe("taller.mx");
    await act(async () => button(host, "emailDomain.connect").click());
    await settle();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ action: "connect", domain: "taller.mx", showAsRoot: false });
    expect(answers).toEqual([[{ id: "email-domain", selected: ["notify.taller.mx"] }]]);
  });

  it("a refusal says why and doesn't answer", async () => {
    server({ status: 409, body: { error: "host_taken" } });
    const answers: QuestionAnswer[][] = [];
    const host = mount({ onAnswer: (a) => answers.push(a) });
    await settle();
    await type(host.querySelector<HTMLInputElement>("input[type=text]")!, "otro.mx");
    await act(async () => button(host, "emailDomain.connect").click());
    await settle();
    expect(host.textContent).toContain("emailDomain.errors.host_taken");
    expect(answers).toEqual([]);
  });

  it("answered, it shrinks to the address", () => {
    const host = mount({ answer: "notify.taller.mx" });
    expect(host.textContent).toContain("emailDomain.connected(notify.taller.mx)");
  });
});
