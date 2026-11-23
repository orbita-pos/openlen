// lib/len-bench/casos/clientes/fetched.test.ts
// @vitest-environment node
//
// A CUSTOMER CASE, FROM THE ROWS FETCHED READ-ONLY (plan local 2026-11-15-len-3-1-bateria-de-paginas-gratis,
// task 8). Built here, kept OUTSIDE the repo (`OPENLEN_BENCH_CASES_DIR` or ~/.openlen/bench-cases): no customer
// text enters a public repository.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { casesDir, fetchedCaseFrom, readFetchedCase, writeFetchedCase, type RawCaseRows } from "./fetched";

const askCall = (questions: { id: string; question: string }[]) => ({ role: "assistant", content: "", functionCalls: [{ name: "ask_user_question", args: { questions } }] });
const askAnswer = (answers: { id: string; selected: string[]; custom?: string }[]) => ({ role: "user", content: "", functionResponses: [{ name: "ask_user_question", response: { ok: true, answers } }] });

// A SYNTHETIC id (review I5): a real customer's id never sits next to any content in this public repository.
const ID = "00000000-0000-4000-8000-0000000000aa";
const publishCall = { role: "assistant", content: "", functionCalls: [{ name: "publish", args: { subdomain: "tacos-don-pepe" } }] };

const raw = (o: Partial<RawCaseRows> = {}): RawCaseRows => ({
  projectId: ID,
  project: { data: { html: "<h1>Final</h1>", pages: { menu: { html: "<h1>Menú</h1>" } } }, subdomain: "tacos-don-pepe" },
  versionsBefore: [],
  rows: [
    { userText: "hazme una página para mi taquería", attachedImage: null, attachedFiles: null, page: null, createdAt: "2026-10-31T10:00:00Z", transcript: { mensajes: [askCall([{ id: "q1", question: "¿Qué dirección quieres?" }]), askAnswer([{ id: "q1", selected: [], custom: "tacos-don-pepe" }]), publishCall] } },
    { userText: "ponle el menú", attachedImage: null, attachedFiles: null, page: null, createdAt: "2026-10-31T10:05:00Z", transcript: null },
  ],
  ...o,
});

describe("fetchedCaseFrom — what the review found (15/11)", () => {
  it("I1: published counts only when LEN published (called publish); a customer who used the publish button never asked Len", () => {
    const sinPublish = fetchedCaseFrom(raw({ rows: raw().rows.map((r) => ({ ...r, transcript: null })) }), "t");
    if ("left" in sinPublish) throw new Error(sinPublish.left);
    expect(sinPublish.published).toBeNull();
    const conPublish = fetchedCaseFrom(raw(), "t");
    if ("left" in conPublish) throw new Error(conPublish.left);
    expect(conPublish.published).toEqual({ subdomain: "tacos-don-pepe" });
  });
  it("I3: of the final state, only what a page is (html; each page's html, title, membersOnly) — never a preview token or a passcode", () => {
    const c = fetchedCaseFrom(raw({
      project: {
        data: { html: "<h1>F</h1>", pages: { menu: { html: "<p>m</p>", title: "Menú", membersOnly: true, secreto: "x" } }, preview: { token: "t0k3n" }, passcodeHash: "h4sh" } as never,
        subdomain: null,
      },
    }), "t");
    if ("left" in c) throw new Error(c.left);
    expect(c.final).toEqual({ html: "<h1>F</h1>", pages: { menu: { html: "<p>m</p>", title: "Menú", membersOnly: true } } });
    expect(JSON.stringify(c)).not.toMatch(/t0k3n|h4sh|secreto/);
  });
  it("I4: a message typed while looking at a sub-page is left out (the bench replays every message against Home)", () => {
    expect(fetchedCaseFrom(raw({ rows: [{ ...raw().rows[0]!, page: "menu" }] }), "t")).toEqual({ left: "un mensaje se escribió viendo una subpágina: el banco lo repetiría contra la portada" });
  });
});

describe("fetchedCaseFrom", () => {
  it("keeps the owner's messages in order, the final state and where it was published", () => {
    const c = fetchedCaseFrom(raw(), "2026-11-15T00:00:00Z");
    if ("left" in c) throw new Error(c.left);
    expect(c.ownerMessages).toEqual(["hazme una página para mi taquería", "ponle el menú"]);
    expect(c.final).toEqual({ html: "<h1>Final</h1>", pages: { menu: { html: "<h1>Menú</h1>" } } });
    expect(c.published).toEqual({ subdomain: "tacos-don-pepe" });
    expect(c.fetchedAt).toBe("2026-11-15T00:00:00Z");
  });

  it("pairs each card answer with its question, chosen options and written text together", () => {
    const c = fetchedCaseFrom(raw({
      rows: [{ userText: "x", attachedImage: null, attachedFiles: null, createdAt: "2026-10-31T10:00:00Z", transcript: { mensajes: [askCall([{ id: "a", question: "¿Color?" }, { id: "b", question: "¿Dirección?" }]), askAnswer([{ id: "a", selected: ["Azul (Recommended)"] }, { id: "b", selected: [], custom: "mi-sitio" }])] } }],
    }), "t");
    if ("left" in c) throw new Error(c.left);
    expect(c.cardAnswers).toEqual([
      { question: "¿Color?", answer: "Azul" },
      { question: "¿Dirección?", answer: "mi-sitio" },
    ]);
  });

  it("starts from a blank page when nothing existed before the first message", () => {
    const c = fetchedCaseFrom(raw(), "t");
    if ("left" in c) throw new Error(c.left);
    expect(c.start).toEqual({ html: "" });
  });

  it("starts from the last version of each page saved before the first message (a pasted page, a template)", () => {
    const c = fetchedCaseFrom(raw({
      versionsBefore: [
        { page: null, html: "<p>vieja</p>", createdAt: "2026-10-30T09:00:00Z" },
        { page: null, html: "<p>pegada</p>", createdAt: "2026-10-30T10:00:00Z" },
        { page: "contacto", html: "<p>contacto</p>", createdAt: "2026-10-30T10:00:00Z" },
      ],
    }), "t");
    if ("left" in c) throw new Error(c.left);
    expect(c.start).toEqual({ html: "<p>pegada</p>", pages: { contacto: { html: "<p>contacto</p>" } } });
  });

  it("a case whose owner attached a photo or a file is left out, and says why (review focus 4)", () => {
    const foto = fetchedCaseFrom(raw({ rows: [{ ...raw().rows[0]!, attachedImage: [{ url: "/img/x.webp" }] }] }), "t");
    expect(foto).toEqual({ left: "el dueño adjuntó una foto o un fichero: el banco no repite adjuntos" });
    const fichero = fetchedCaseFrom(raw({ rows: [{ ...raw().rows[0]!, attachedFiles: [{ name: "menu.pdf" }] }] }), "t");
    expect("left" in fichero).toBe(true);
    // An empty list is not an attachment.
    expect("left" in fetchedCaseFrom(raw({ rows: [{ ...raw().rows[0]!, attachedImage: [], attachedFiles: [] }] }), "t")).toBe(false);
  });

  it("a project where Len made an ARTIFACT (a dashboard, a deck) is another flow, not a page: left out", () => {
    const legacy = { role: "assistant", content: "", functionCalls: [{ name: "create_artifact", args: {} }] };
    const c = fetchedCaseFrom(raw({ rows: [{ ...raw().rows[0]!, transcript: { mensajes: [legacy] } }] }), "t");
    expect(c).toEqual({ left: "Len hizo un entregable (create_deliverable), no la página: es otro flujo" });
    const current = { role: "assistant", content: "", functionCalls: [{ name: "create_deliverable", args: {} }] };
    const c2 = fetchedCaseFrom(raw({ rows: [{ ...raw().rows[0]!, transcript: { mensajes: [current] } }] }), "t");
    expect(c2).toEqual({ left: "Len hizo un entregable (create_deliverable), no la página: es otro flujo" });
  });

  it("a project with no owner message is not a case", () => {
    expect(fetchedCaseFrom(raw({ rows: [] }), "t")).toEqual({ left: "sin mensajes del dueño" });
  });
});

describe("the fetched file, outside the repo", () => {
  const prev = process.env.OPENLEN_BENCH_CASES_DIR;
  afterEach(() => {
    if (prev === undefined) delete process.env.OPENLEN_BENCH_CASES_DIR;
    else process.env.OPENLEN_BENCH_CASES_DIR = prev;
  });

  it("defaults to ~/.openlen/bench-cases, never a folder of the repo", () => {
    delete process.env.OPENLEN_BENCH_CASES_DIR;
    expect(casesDir()).toBe(path.join(os.homedir(), ".openlen", "bench-cases"));
  });

  it("is written and read back as it was", () => {
    process.env.OPENLEN_BENCH_CASES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lb-cases-"));
    const c = fetchedCaseFrom(raw(), "2026-11-15T00:00:00Z");
    if ("left" in c) throw new Error(c.left);
    writeFetchedCase(c);
    expect(readFetchedCase(c.projectId)).toEqual(c);
  });

  it("a case never fetched says how to fetch it", () => {
    process.env.OPENLEN_BENCH_CASES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lb-cases-"));
    expect(() => readFetchedCase("00000000-0000-4000-8000-0000000000bb")).toThrow(/bench:clientes:fetch/);
  });
});
