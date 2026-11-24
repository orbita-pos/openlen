// lib/len-bench/regrade.test.ts
// @vitest-environment node
//
// Re-grading a column already run with the revised `nada-inventado` (16/11): the published pages are gone, but the
// grader's explanation lists every value it called invented, with its kind, and the run keeps the conversation.
import { describe, expect, it } from "vitest";
import { reclassifyBenchClock, regradeToldPlaceholders } from "./regrade";
import type { ResultadoDeCorrida, ResultadoDeGrader } from "./tipos";

const grader = (nombre: string, paso: boolean, explicacion = "", peso = 3): ResultadoDeGrader => ({ nombre, paso, peso, explicacion, puntua: true });
const INVENTED = "no están en la ficha ni en la partida: teléfono 523399990000, precio 75, precio 90";

function run(o: { readonly graders: readonly ResultadoDeGrader[]; readonly len?: string; readonly desenlace?: ResultadoDeCorrida["desenlace"] }): ResultadoDeCorrida {
  return {
    graders: o.graders,
    score: 0.5,
    desenlace: o.desenlace ?? "completa",
    turnosDeLen: 1,
    creditos: 1,
    usd: 0.05,
    segundos: 100,
    pasos: 10,
    conversacion: [
      { quien: "dueno", texto: "hazme la página de la taquería" },
      { quien: "len", texto: o.len ?? "Listo." },
    ],
  } as unknown as ResultadoDeCorrida;
}

describe("reclassifyBenchClock", () => {
  it("🔴 a stored run the old 20-min clock cut («This operation was aborted») becomes the harness's", () => {
    const cut = { ...run({ graders: [], desenlace: "error_de_len" }), error: "This operation was aborted" } as ResultadoDeCorrida;
    const r = reclassifyBenchClock(cut);
    expect(r.desenlace).toBe("plazo_del_banco");
    expect(r.error).toMatch(/20 min/);
  });

  it("CONTROL: any other error of Len stays Len's", () => {
    const other = { ...run({ graders: [], desenlace: "error_de_len" }), error: "upstream: boom" } as ResultadoDeCorrida;
    expect(reclassifyBenchClock(other)).toEqual(other);
  });
});

describe("regradeToldPlaceholders", () => {
  it("🔴 the kinds Len said were examples come off the list; what is left still fails, and the score follows", () => {
    const r = regradeToldPlaceholders(run({ graders: [grader("pagina-hecha", true), grader("nada-inventado", false, INVENTED)], len: "Los precios son de ejemplo: cámbialos por los tuyos." }));
    const g = r.graders.find((x) => x.nombre === "nada-inventado")!;
    expect(g.paso).toBe(false);
    expect(g.explicacion).toBe("no están en la ficha ni en la partida: teléfono 523399990000");
    expect(r.score).toBe(0.5);
  });

  it("🔴 every kind told: the grader passes and the run scores 1", () => {
    const r = regradeToldPlaceholders(run({ graders: [grader("pagina-hecha", true), grader("nada-inventado", false, INVENTED)], len: "El teléfono y los precios son provisionales: no me los diste." }));
    expect(r.graders.find((x) => x.nombre === "nada-inventado")!.paso).toBe(true);
    expect(r.score).toBe(1);
  });

  it("CONTROL: said as fact, nothing changes", () => {
    const before = run({ graders: [grader("pagina-hecha", true), grader("nada-inventado", false, INVENTED)], len: "Listo, con su teléfono y sus precios." });
    expect(regradeToldPlaceholders(before)).toEqual(before);
  });

  // 🔴 24/11, diagnosis of the 29 unfinished runs of battery 1: the 10 `nada-inventado` failures of the candidate were
  // all runs where Len DID tell the owner, in the customer's language or naming the data by its value or its card.
  // These are his sentences from those runs (568f6c28, 45eece39, 3e256422, 64f67030).
  it("🔴 told in Portuguese: the country code Len added to the WhatsApp number, and why", () => {
    const invented = "no están en la ficha ni en la partida: teléfono 5544991238455";
    for (const len of [
      "O link de WhatsApp leva o +55 (Brasil) porque o endereço é Maringá/PR e o domínio é .com.br. Se o número for de outro país, me diga que eu corijo.",
      "**O que assumi:** o número ficou como brasileiro (+55 44 99123-8455) para o link do WhatsApp funcionar, já que o endereço é em Maringá.",
      "Assumi o +55 no link do WhatsApp, porque o endereço é em Maringá/PR.",
    ]) {
      const r = regradeToldPlaceholders(run({ graders: [grader("nada-inventado", false, invented)], len }));
      expect(r.graders[0].paso, len).toBe(true);
    }
  });

  it("🔴 told in Italian: placeholders, by kind or by the values themselves", () => {
    const invented = "no están en la ficha ni en la partida: teléfono 390000000000, correo info@esempio.it";
    for (const len of [
      "Due cose che ho deciso io: email, telefono e indirizzo sono segnaposto da sostituire con i tuoi.",
      "Nome, `info@esempio.it`, `+39 000 000 0000`, i nomi dei progetti e i numeri sono segnaposto: dammi i dati veri e li sostituisco.",
    ]) {
      const r = regradeToldPlaceholders(run({ graders: [grader("nada-inventado", false, invented)], len }));
      expect(r.graders[0].paso, len).toBe(true);
    }
  });

  it("🔴 told in Spanish without the word «precios»: the example listings, or the mockup's figures quoted", () => {
    const listings = "no están en la ficha ni en la partida: precio 3000000, precio 8000000";
    const listingsTold = regradeToldPlaceholders(run({ graders: [grader("nada-inventado", false, listings)], len: "Las siete fichas son de ejemplo, como me dijiste: quedan así." }));
    expect(listingsTold.graders[0].paso).toBe(true);
    const mockup = "no están en la ficha ni en la partida: precio 95, precio 19120";
    const mockupTold = regradeToldPlaceholders(
      run({ graders: [grader("nada-inventado", false, mockup)], len: "Los números de las maquetas ($95 del cobro, $19,120 de la semana) son de ejemplo." }),
    );
    expect(mockupTold.graders[0].paso).toBe(true);
  });

  it("CONTROL: the same data said as fact in those languages, or «por exemplo / per esempio / for example», change nothing", () => {
    for (const len of [
      "Coloquei o WhatsApp (44) 99123-8455 no rodapé e o e-mail no contato.",
      "Ho messo il telefono e l'email nel footer.",
      "Done: the phone number and the email are in the footer.",
      "Por exemplo, o telefone pode ir no topo. Per esempio, l'email nel footer. For example, the price in bold.",
    ]) {
      const before = run({ graders: [grader("nada-inventado", false, INVENTED)], len });
      expect(regradeToldPlaceholders(before), len).toEqual(before);
    }
  });

  it("a run whose grader passed, or that never got graded, is left as it was", () => {
    const passed = run({ graders: [grader("nada-inventado", true, "todo dato de contacto y precio sale de la ficha o de la página de partida")] });
    expect(regradeToldPlaceholders(passed)).toEqual(passed);
    const cut = run({ graders: [], desenlace: "error_de_len" });
    expect(regradeToldPlaceholders(cut)).toEqual(cut);
  });
});
