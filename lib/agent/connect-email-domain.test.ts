import { describe, expect, it, vi } from "vitest";

import { EMAIL_DOMAIN_QUESTION_ID, QUESTION_DISMISSED, type UserQuestion } from "@/lib/agent/ask-user-question";
import type { AgentDeps, AgentSession } from "@/lib/agent/tools";
import type { EmailStateForLen } from "@/lib/project-email/state";

import { toolConnectEmailDomain } from "./connect-email-domain";

const OWNER: AgentSession = { projectId: "p1", userId: "u1" } as AgentSession;
const MEMBER: AgentSession = { projectId: "p1", userId: "u1", personId: "u2" } as AgentSession;
const NONE: EmailStateForLen = { domain: null, status: "none", from: null, sent_this_month: 0, included_per_month: 1000, plan: "pro" };
const VERIFYING: EmailStateForLen = { ...NONE, domain: "taller.mx", status: "verifying" };

function deps(o: { states?: (EmailStateForLen | null)[]; answer?: "yes" | "dismissed" | "none"; ask?: boolean } = {}) {
  const states = [...(o.states ?? [NONE, VERIFYING])];
  const askUser = vi.fn(async (_q: UserQuestion[]) => (o.answer === "dismissed" ? QUESTION_DISMISSED : o.answer === "none" ? null : [{ id: EMAIL_DOMAIN_QUESTION_ID, selected: ["notify.taller.mx"] }]));
  const d = { emailState: vi.fn(async () => (states.length > 1 ? states.shift()! : states[0]!)), ...(o.ask === false ? {} : { askUser }) } as unknown as AgentDeps;
  return { d, askUser };
}

describe("connect_email_domain", () => {
  it("a member calling connect_email_domain is refused", async () => {
    const { d, askUser } = deps();
    const r = await toolConnectEmailDomain(MEMBER, d);
    expect(r.response).toMatchObject({ ok: false, error: expect.stringMatching(/owner/i) });
    expect(askUser).not.toHaveBeenCalled();
  });

  it("the owner gets the card, and Len reads the domain's state once it's answered", async () => {
    const { d, askUser } = deps();
    const r = await toolConnectEmailDomain(OWNER, d);
    expect(askUser.mock.calls[0]![0][0]).toMatchObject({ id: EMAIL_DOMAIN_QUESTION_ID, intent: { kind: "email-domain" } });
    expect(r.response).toMatchObject({ ok: true, email: VERIFYING });
    expect(String(r.response.result)).toMatch(/Correos|DNS/);
  });

  it("with nobody to answer in the turn the card closes it, like request_secrets", async () => {
    const { d } = deps({ ask: false });
    const r = await toolConnectEmailDomain(OWNER, d);
    expect(r.response).toMatchObject({ ok: true, preguntado: true });
    expect(r.preguntas?.[0]?.intent).toEqual({ kind: "email-domain" });
  });

  it("the free plan, the email off, or a domain already there don't show a card", async () => {
    const free = deps({ states: [{ ...NONE, plan: "free", included_per_month: 0 }] });
    expect((await toolConnectEmailDomain(OWNER, free.d)).response).toMatchObject({ ok: false, error: expect.stringMatching(/paid plan/i) });
    const off = deps({ states: [null] });
    expect((await toolConnectEmailDomain(OWNER, off.d)).response).toMatchObject({ ok: false });
    const already = deps({ states: [VERIFYING] });
    expect((await toolConnectEmailDomain(OWNER, already.d)).response).toMatchObject({ ok: true, email: VERIFYING });
    for (const x of [free, off, already]) expect(x.askUser).not.toHaveBeenCalled();
  });

  it("dismissed is the owner taking the word", async () => {
    const { d } = deps({ answer: "dismissed" });
    expect(await toolConnectEmailDomain(OWNER, d)).toMatchObject({ dismissed: true, response: { ok: false } });
  });
});
