// The sign-in emails of a page's backend (spec local 2026-10-22-email-integration, 6.4):
// from the project's domain when it can, from OpenLen when it can't, never nobody.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SendInput, SendOutcome } from "@/lib/project-email/send";

import type { AuthMail } from "./config";
import { sendAuthEmail, type AuthMailDeps } from "./mail";

const MAIL: AuthMail = { to: "ana@x.com", kind: "recovery", link: "https://taller.mx/auth/v1/verify?token=t", otp: "123456", redirectTo: "https://taller.mx/", lang: "es" };
const CTX = { siteHost: "taller.mx", projectId: "p1", environment: "live" as const };

function deps(o: { from?: string | null; outcome?: SendOutcome; files?: Record<string, string>; team?: string[] } = {}) {
  const sent: SendInput[] = [];
  const fallback = vi.fn(async (_m: { to: string; subject: string; html: string; text: string }) => {});
  const d: AuthMailDeps = {
    emailOn: true,
    fromOf: async () => (o.from === undefined ? "Taller <noreply@notify.taller.mx>" : o.from),
    send: async (i) => {
      sent.push(i);
      return o.outcome ?? { kind: "sent", id: "re_1", skipped: [] };
    },
    fallback,
    team: async () => o.team ?? ["dueno@taller.mx"],
    supabaseFiles: async () => o.files ?? {},
  };
  return { d, sent, fallback };
}

describe("sendAuthEmail", () => {
  it("with a ready domain the email goes through the core from the project's host, as auth", async () => {
    const { d, sent, fallback } = deps();
    await sendAuthEmail(MAIL, CTX, d);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ projectId: "p1", environment: "live", kind: "auth", email: { from: "Taller <noreply@notify.taller.mx>", to: ["ana@x.com"] } });
    expect(sent[0]!.email.html).toContain("https://taller.mx/auth/v1/verify?token=t");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("without a ready domain, plan or credits it goes from OpenLen as today", async () => {
    for (const o of [{ from: null }, { outcome: { kind: "rejected" as const, error: { statusCode: 403, name: "validation_error", message: "paid plans" } } }, { outcome: { kind: "rejected" as const, error: { statusCode: 429, name: "monthly_quota_exceeded", message: "no credits" } } }]) {
      const { d, fallback } = deps(o);
      await sendAuthEmail(MAIL, CTX, d);
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(vi.mocked(fallback).mock.calls[0]![0]).toMatchObject({ to: "ana@x.com", subject: expect.any(String) });
    }
  });

  it("over the hourly cap it isn't sent at all", async () => {
    const { d, fallback } = deps({ outcome: { kind: "rejected", error: { statusCode: 429, name: "rate_limit_exceeded", message: "cap" } } });
    await sendAuthEmail(MAIL, CTX, d);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("the draft sends only to the team, by either road", async () => {
    const stranger = deps({ from: null });
    await sendAuthEmail(MAIL, { ...CTX, environment: "draft" }, stranger.d);
    expect(stranger.fallback).not.toHaveBeenCalled();
    const team = deps({ from: null, team: ["ANA@x.com"] });
    await sendAuthEmail(MAIL, { ...CTX, environment: "draft" }, team.d);
    expect(team.fallback).toHaveBeenCalledTimes(1);
  });

  it("the project's Supabase template is used, by either road", async () => {
    const files = {
      "/supabase/config.toml": '[auth.email.template.recovery]\nsubject = "Cambia tu clave en {{ .SiteURL }}"\ncontent_path = "./supabase/templates/recovery.html"\n',
      "/supabase/templates/recovery.html": '<p>Hola {{ .Email }}</p><a href="{{ .ConfirmationURL }}">Cambiar</a>',
    };
    const viaDomain = deps({ files });
    await sendAuthEmail(MAIL, CTX, viaDomain.d);
    expect(viaDomain.sent[0]!.email).toMatchObject({ subject: "Cambia tu clave en https://taller.mx", html: '<p>Hola ana@x.com</p><a href="https://taller.mx/auth/v1/verify?token=t">Cambiar</a>' });
    const viaOpenLen = deps({ from: null, files });
    await sendAuthEmail(MAIL, CTX, viaOpenLen.d);
    expect(vi.mocked(viaOpenLen.fallback).mock.calls[0]![0]).toMatchObject({ subject: "Cambia tu clave en https://taller.mx" });
  });

  it("a broken template falls back to OpenLen's own text instead of leaving the email out", async () => {
    const files = { "/supabase/config.toml": '[auth.email.template.recovery]\ncontent_path = "./supabase/templates/recovery.html"\n', "/supabase/templates/recovery.html": "{{ if .Token }}x{{ end }}" };
    const { d, sent } = deps({ files });
    await sendAuthEmail(MAIL, CTX, d);
    expect(sent[0]!.email.html).toContain("https://taller.mx/auth/v1/verify?token=t");
  });
});
