// @vitest-environment jsdom
//
// The account menu offers to resend the email that confirms the address (2026-10-22) when the person's
// email is still to confirm, with the real Spanish texts. Whether it is pending is the server's call
// (app/api/auth/verify-email, with its own test); this checks what the menu does with it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import projects from "@/messages/es/projects.json";
import topbar from "@/messages/es/topbar.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "u1", email: "ana@openlen.test", name: "Ana" } } }),
  signOut: vi.fn(),
}));
vi.mock("@/components/locale-switcher", () => ({ LocaleSwitcher: () => null }));

import { AccountMenu } from "./account-menu";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
let pending = true;
let postOk = true;
let usage: { plan: string; credits: { balance: number; allotment: number; refillsAt: string | null } } | null = null;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  pending = true;
  postOk = true;
  usage = null;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/verify-email" && init?.method === "POST") return { ok: postOk, json: async () => ({}) };
    if (url === "/api/auth/verify-email") return { ok: true, json: async () => ({ pending }) };
    if (url === "/api/usage" && usage) return { ok: true, json: async () => usage };
    return { ok: false, json: async () => null };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

async function openMenu({ credits = false }: { credits?: boolean } = {}): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="es" messages={{ topbar, projects }}>
        <AccountMenu dark={false} onToggleDark={() => {}} credits={credits} />
      </NextIntlClientProvider>,
    ),
  );
  // The balance is fetched when the menu mounts, before it is opened.
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
  await act(async () => {
    host.querySelector<HTMLButtonElement>("button[aria-haspopup='menu']")!.click();
  });
  return host;
}
const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

describe("🔴 the account menu and the email still to confirm", () => {
  it("says the email is not confirmed and resends the link on request", async () => {
    const host = await openMenu();
    expect(host.textContent).toContain(topbar.account.emailPending);
    await act(async () => {
      button(host, topbar.account.resend)!.click();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/verify-email", { method: "POST" });
    expect(host.textContent).toContain(topbar.account.resendSent);
    expect(button(host, topbar.account.resend)).toBeUndefined();
  });

  it("with the email confirmed (or a Google account), there is nothing to resend", async () => {
    pending = false;
    const host = await openMenu();
    expect(host.textContent).not.toContain(topbar.account.emailPending);
    expect(button(host, topbar.account.resend)).toBeUndefined();
  });

  it("if sending fails, it says so and the button stays to try again", async () => {
    postOk = false;
    const host = await openMenu();
    await act(async () => {
      button(host, topbar.account.resend)!.click();
    });
    expect(host.textContent).toContain(topbar.account.resendFailed);
    expect(button(host, topbar.account.resend)).toBeDefined();
  });
});

// Jesús, 06/11: «donde se ve los créditos mételo al dropdown del icono del user». In the start frame the credits are a
// row of the account's menu; inside a project the top bar already shows the pill, so the menu doesn't repeat it.
describe("🔴 the credits in the account menu", () => {
  it("in the start frame, the balance and its renewal sit under the name, already there when it opens", async () => {
    usage = { plan: "pro", credits: { balance: 48750, allotment: 50000, refillsAt: "2026-11-30T12:00:00.000Z" } };
    const host = await openMenu({ credits: true });
    const row = host.querySelector<HTMLElement>("[data-credit-row]")!;
    expect(row).not.toBeNull();
    expect(row.dataset.creditState).toBe("normal");
    expect(row.textContent).toContain("Te quedan 487.50 de 500 créditos de IA");
    expect(row.textContent).toContain("Se renuevan el 30 de noviembre de 2026");
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/usage").length).toBeGreaterThanOrEqual(1);
  });

  it("out of credits, the row is the way to Pro, as the pill is", async () => {
    usage = { plan: "free", credits: { balance: 0, allotment: 1000, refillsAt: null } };
    const host = await openMenu({ credits: true });
    const row = host.querySelector<HTMLAnchorElement>("a[data-credit-row]")!;
    expect(row.dataset.creditState).toBe("empty");
    expect(row.getAttribute("href")).toBe("/api/billing/checkout?locale=es");
    expect(row.textContent).toContain(`${projects.creditPill.empty} · Pro`);
  });

  it("without `credits` (inside a project) there is no row", async () => {
    usage = { plan: "pro", credits: { balance: 48750, allotment: 50000, refillsAt: null } };
    const host = await openMenu();
    expect(host.querySelector("[data-credit-row]")).toBeNull();
  });
});
