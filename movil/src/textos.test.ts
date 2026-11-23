// @vitest-environment node
// Los 10 idiomas de la app tienen las MISMAS claves que el español: una que
// falte sale en la pantalla como su nombre («movil.chat.leido»).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IDIOMAS } from "./config";
import { textosEntrega } from "./textos-entrega";
import { textosGestion } from "./textos-gestion";
import { textosAvisos } from "./textos-avisos";
import { textosPersonalizacion } from "./textos-personalizacion";
import { textosEquipo } from "./textos-equipo";
import { textosInterfaz } from "./textos-interfaz";
import { textosAdjuntos } from "./textos-adjuntos";
import { textosLenWatch } from "./textos-len-watch";
import { deliveredTexts } from "./delivered-texts";
import { overviewTexts } from "./overview-texts";
import { textosHerramientas } from "./textos-herramientas";
import { textosAsistente } from "./textos-asistente";
import { textosAgentTools } from "./textos-agent-tools";

const claves = (o: unknown, p = ""): string[] =>
  typeof o === "object" && o !== null ? Object.entries(o).flatMap(([k, v]) => claves(v, p ? `${p}.${k}` : k)) : [p];
const leer = (i: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", i, "movil.json"), "utf8")) as unknown;

describe("los textos de la app", () => {
  const es = claves(leer("es")).sort();
  for (const i of IDIOMAS) {
    it(`${i} tiene las mismas claves que es`, () => {
      expect(claves(leer(i)).sort()).toEqual(es);
    });
  }
  // The Publish screen reads the web's own A/B texts (modalsDeploy.abRunning / abBringPending) through textos.tsx.
  it("🔴 the phone's publish screen has the web's A/B texts in all 10 languages, and textos.tsx loads them", () => {
    const fuente = fs.readFileSync(path.join(process.cwd(), "movil/src/textos.tsx"), "utf8");
    expect(fuente).toContain("modalsDeploy");
    expect(fuente).toContain('abRunning: sub(modalsDeploy.default, "abRunning")');
    expect(fuente).toContain('abBringPending: sub(modalsDeploy.default, "abBringPending")');
    expect(fuente).toContain('abDecisionInProgress: sub(modalsDeploy.default, "abDecisionInProgress")');
    for (const i of IDIOMAS) {
      const m = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", i, "modalsDeploy.json"), "utf8")) as Record<string, Record<string, string>>;
      for (const k of ["title", "body", "name", "stopAndPublish", "cancel"]) expect(m.abRunning?.[k], `${i}.abRunning.${k}`).toBeTruthy();
      for (const k of ["title", "body", "cancel"]) expect(m.abBringPending?.[k], `${i}.abBringPending.${k}`).toBeTruthy();
      for (const k of ["title", "body", "ok"]) expect(m.abDecisionInProgress?.[k], `${i}.abDecisionInProgress.${k}`).toBeTruthy();
    }
  });
  it("🔴 the phone exposes panelsChat's five visual keys as movil.visual in all 10 languages", () => {
    const fuente = fs.readFileSync(path.join(process.cwd(), "movil/src/textos.tsx"), "utf8");
    for (const k of ["visualLabel", "visualLoading", "visualLinkTitle", "visualLinkOpen", "visualLinkCancel"]) {
      expect(fuente).toContain(k);
    }
    for (const i of IDIOMAS) {
      const m = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", i, "panelsChat.json"), "utf8")) as Record<string, string>;
      for (const k of ["visualLabel", "visualLoading", "visualLinkTitle", "visualLinkOpen", "visualLinkCancel"]) {
        expect(typeof m[k] === "string" && m[k].trim().length > 0, `${i}.panelsChat.${k}`).toBe(true);
      }
    }
  });
  it("el chat tiene sus textos", () => {
    expect(es).toContain("chat.pedirCambio");
    expect(es).toContain("chat.avance.trabajando");
  });
  it("cada paso en curso tiene su texto en pasado, para cuando ha terminado", () => {
    const avance = es.filter((k) => k.startsWith("chat.avance.")).map((k) => k.slice("chat.avance.".length));
    const hecho = es.filter((k) => k.startsWith("chat.hecho.")).map((k) => k.slice("chat.hecho.".length));
    expect(hecho).toEqual(avance);
  });
});

for (const [nombre, mapa] of Object.entries({ entrega: textosEntrega, gestion: textosGestion, avisos: textosAvisos, personalizacion: textosPersonalizacion, equipo: textosEquipo, adjuntos: textosAdjuntos, interfaz: textosInterfaz, lenWatch: textosLenWatch, entregado: deliveredTexts, resumen: overviewTexts, herramientas: textosHerramientas, asistente: textosAsistente, agentTools: textosAgentTools })) {
  for (const idioma of IDIOMAS) it(`${nombre}: ${idioma} completo`, () => {
    expect(claves(mapa[idioma]).sort()).toEqual(claves(mapa.es).sort());
    const validar = (o: unknown): void => {
      if (o && typeof o === "object") Object.values(o).forEach(validar);
      else expect(typeof o === "string" && o.trim().length > 0).toBe(true);
    };
    validar(mapa[idioma]);
  });
}
