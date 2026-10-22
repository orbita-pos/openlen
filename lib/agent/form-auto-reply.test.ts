import { describe, expect, it } from "vitest";

import type { AgentDeps, AgentSession } from "@/lib/agent/tools";
import type { EmailStateForLen } from "@/lib/project-email/state";
import type { ProjectData } from "@/lib/projects/types";

import { toolSetFormAutoReply } from "./form-auto-reply";

const SESSION = { projectId: "p1", userId: "u1" } as AgentSession;
const READY: EmailStateForLen = { domain: "taller.mx", status: "ready", from: "noreply@notify.taller.mx", sent_this_month: 0, included_per_month: 1000, plan: "pro" };

function deps(o: { data?: ProjectData; email?: EmailStateForLen | null } = {}) {
  const store = { data: o.data ?? ({ html: "<form></form>" } as ProjectData), saves: 0 };
  const d = {
    loadProject: async () => ({ data: store.data, title: "Taller", subdomain: "taller", publishedAt: null }),
    saveProjectData: async (_p: string, _u: string, apply: (actual: ProjectData) => ProjectData) => {
      store.data = apply(store.data);
      store.saves += 1;
    },
    emailState: async () => (o.email === undefined ? READY : o.email),
  } as unknown as AgentDeps;
  return { d, store };
}

describe("set_form_auto_reply", () => {
  it("set_form_auto_reply writes autoReply through settings-patch", async () => {
    const { d, store } = deps();
    const r = await toolSetFormAutoReply(SESSION, d, { form_index: 0, subject: "Gracias, {{nombre}}", body: "Te escribimos pronto." });
    expect(r.response).toMatchObject({ ok: true });
    expect(store.data.settings?.forms?.["0"]?.autoReply).toEqual({ subject: "Gracias, {{nombre}}", body: "Te escribimos pronto." });
  });

  it("the form's own id and its page decide the key, as the inspector's", async () => {
    const byId = deps();
    await toolSetFormAutoReply(SESSION, byId.d, { form_id: "f1a2b3", subject: "a", body: "b" });
    expect(byId.store.data.settings?.forms?.["f1a2b3"]?.autoReply).toEqual({ subject: "a", body: "b" });
    const onPage = deps();
    await toolSetFormAutoReply(SESSION, onPage.d, { page: "menu", form_index: 1, subject: "a", body: "b" });
    expect(onPage.store.data.settings?.forms?.["menu:1"]?.autoReply).toEqual({ subject: "a", body: "b" });
  });

  it("on: false turns it off", async () => {
    const { d, store } = deps({ data: { html: "<form></form>", settings: { forms: { "0": { autoReply: { subject: "a", body: "b" } } } } } as ProjectData });
    await toolSetFormAutoReply(SESSION, d, { form_index: 0, on: false });
    expect(store.data.settings?.forms?.["0"]?.autoReply).toBeUndefined();
  });

  it("a link to another site, or no subject or text, is refused before saving", async () => {
    const { d, store } = deps();
    expect((await toolSetFormAutoReply(SESSION, d, { form_index: 0, subject: "Hola", body: "Mira https://otro-sitio.com" })).response).toMatchObject({ ok: false, error: expect.stringMatching(/otro-sitio\.com/) });
    expect((await toolSetFormAutoReply(SESSION, d, { form_index: 0, subject: "", body: "x" })).response).toMatchObject({ ok: false });
    expect((await toolSetFormAutoReply(SESSION, d, { subject: "a", body: "b" })).response).toMatchObject({ ok: false, error: expect.stringMatching(/form_id|form_index/) });
    expect(store.saves).toBe(0);
  });

  it("without a ready domain it saves and says the reply waits for it", async () => {
    const { d } = deps({ email: { ...READY, status: "none", domain: null, from: null } });
    const r = await toolSetFormAutoReply(SESSION, d, { form_index: 0, subject: "a", body: "b" });
    expect(r.response).toMatchObject({ ok: true, note: expect.stringMatching(/domain/i) });
  });
});
