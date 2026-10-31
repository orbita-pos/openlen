import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Comparacion, EntregaVisual, esEntrega, Progreso } from "./entrega";
// The key with its namespace, so a test can tell «movil.chat.avance» from «movil.chat.hecho».
vi.mock("use-intl", () => ({ useTranslations: (ns?: string) => (s: string) => (ns ? `${ns}.${s}` : s) }));
vi.mock("../atras", () => ({ useAtras: () => {} }));
vi.mock("../cara", () => ({ Cara: () => null }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; vi.useRealTimers(); });
// Incidente real del 31/10, en el teléfono: un turno terminado decía «working… / changing your page… / checking how it
// turned out…» —los textos de un paso en curso, con sólo un ✓ pequeño— y parecía que Len seguía trabajando.
it("un paso terminado se dice en pasado; uno en curso, con su «…»", () => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root!.render(<Progreso pasos={[{ clave: "cambiando", estado: "done" }, { clave: "comprobando", estado: "running" }]} trabajando={false} />));
  const filas = [...host.querySelectorAll("li")].map((li) => li.textContent);
  expect(filas[0]).toContain("movil.chat.hecho.cambiando");
  expect(filas[1]).toContain("movil.chat.avance.comprobando");
});

it("sólo entrega cambios terminados sin fallos ni preguntas pendientes", () => {
  const t = { id: "t", status: "applied" as const, userText: "cambia", assistantReasoning: "listo" };
  expect(esEntrega(t)).toBe(true);
  expect(esEntrega({ ...t, tipo: "persona" })).toBe(false);
  expect(esEntrega({ ...t, enCurso: true })).toBe(false);
  expect(esEntrega({ ...t, noDocChange: true })).toBe(false);
  expect(esEntrega({ ...t, status: "error" })).toBe(false);
  expect(esEntrega({ ...t, actions: [{ tool: "Edit", status: "error", summary: "" }] })).toBe(false);
  expect(esEntrega({ ...t, actions: [{ tool: "ask_user_question", status: "done", summary: "" }] })).toBe(false);
});
it("la entrega omite el historial inicial y desaparece aunque se relea el mismo turno", async () => {
  vi.useFakeTimers();
  const host = document.createElement("div"); root = createRoot(host);
  const turno = { id: "viejo", status: "applied" as const, userText: "Cambia", assistantReasoning: "Listo" };
  await act(async () => root!.render(<EntregaVisual projectId="a" turno={turno} onVer={() => {}} />));
  expect(host.querySelector("button")).toBeNull();
  await act(async () => root!.render(<EntregaVisual projectId="a" turno={{ ...turno, id: "nuevo" }} onVer={() => {}} />));
  expect(host.querySelector("button")).not.toBeNull();
  await act(async () => root!.render(<EntregaVisual projectId="a" turno={{ ...turno, id: "nuevo" }} onVer={() => {}} />));
  act(() => vi.advanceTimersByTime(1500));
  expect(host.querySelector("button")).toBeNull();
});
it("entrega el primer cambio de un proyecto vacío y permite saltarlo", async () => {
  const host = document.createElement("div"); root = createRoot(host);
  const ver = vi.fn();
  await act(async () => root!.render(<EntregaVisual projectId="a" onVer={ver} />));
  await act(async () => root!.render(<EntregaVisual projectId="a" turno={{ id: "primero", status: "applied", userText: "Haz", assistantReasoning: "Listo" }} onVer={ver} />));
  act(() => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(ver).toHaveBeenCalledOnce();
  expect(host.querySelector("button")).toBeNull();
});
it("muestra documentos distintos en iframes aislados y nunca inventa un antes", async () => {
  const host = document.createElement("div"); root = createRoot(host);
  const pedir = vi.fn().mockResolvedValue(Response.json({ comparacion: { antes: { html: "<p>Antes</p>", fecha: "2026-10-25" }, ahora: { html: "<p>Ahora</p>", fecha: "2026-10-26" } } }));
  await act(async () => root!.render(<Comparacion cliente={{ pedir, avisarAlCerrar: vi.fn() }} projectId="a" page="menu" onCerrar={() => {}} />));
  expect(pedir).toHaveBeenCalledWith("/api/movil/entrega?project=a&page=menu");
  const frames = host.querySelectorAll("iframe");
  expect(frames).toHaveLength(2);
  expect(frames[0].srcdoc).not.toEqual(frames[1].srcdoc);
  expect(frames[0].getAttribute("sandbox")).toBe("");
  pedir.mockResolvedValue(Response.json({ comparacion: null }));
  await act(async () => root!.render(<Comparacion cliente={{ pedir, avisarAlCerrar: vi.fn() }} projectId="b" onCerrar={() => {}} />));
  expect(host.querySelector("iframe")).toBeNull();
  expect(host.textContent).toContain("sinAntes");
});
