import { describe, expect, it, vi } from "vitest";

import {
  necesitaOjos,
  ojosDeLaRespuesta,
  ojosPreguntaPara,
  OJOS_PROMPT,
} from "./needs-image-eyes";

type Args = { system: string; user: string; signal: AbortSignal };
const responde = (crudo: string) => vi.fn(async (_a: Args) => crudo);

describe("ojosDeLaRespuesta — sólo un SÍ limpio cuenta", () => {
  it.each(["SI", "si", " Si ", "SI.", "si."])("acepta %o", (s) => {
    expect(ojosDeLaRespuesta(s)).toBe(true);
  });

  // Todo lo demás cae al lado barato. Un modelo que se pone a conversar no está
  // contestando la pregunta, y el suelo —seguir ciego, como hoy— es bueno.
  it.each([
    "NO",
    "Sí, porque el usuario pide los colores",
    "yes",
    '{"ojos":true}',
    "SI NO",
    "",
    "SÍ",
  ])("rechaza %o", (s) => {
    expect(ojosDeLaRespuesta(s)).toBe(false);
  });
});

describe("necesitaOjos", () => {
  it("manda el mensaje del usuario y el alt al clasificador", async () => {
    const c = responde("NO");
    await necesitaOjos("pon esto en el hero", "un pastel", c);
    const args = c.mock.calls[0]![0];
    expect(args.system).toBe(OJOS_PROMPT);
    expect(args.user).toContain("pon esto en el hero");
    expect(args.user).toContain("un pastel");
  });

  it("dice que sí cuando el clasificador dice que sí", async () => {
    expect(await necesitaOjos("usa los colores de esta foto", null, responde("SI"))).toBe(true);
  });

  it("y que no cuando dice que no", async () => {
    expect(await necesitaOjos("pon esta imagen arriba", null, responde("NO"))).toBe(false);
  });

  // LO IMPORTANTE: este módulo sólo puede mejorar el turno o dejarlo igual.
  // Nunca puede romperlo ni encarecerlo por accidente, así que todo camino raro
  // termina en `false` — que es exactamente el comportamiento de hoy.
  it("un clasificador que revienta no rompe el turno: falla a ciego", async () => {
    const c = vi.fn(async (_a: Args): Promise<string> => {
      throw new Error("fireworks se cayó");
    });
    expect(await necesitaOjos("usa los colores de esta foto", null, c)).toBe(false);
  });

  it("y uno que se cuelga tampoco: el plazo lo corta", async () => {
    const c = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<string>((_res, rej) => {
          signal.addEventListener("abort", () => rej(new Error("abortado")), { once: true });
        }),
    );
    expect(await necesitaOjos("usa los colores de esta foto", null, c, 10)).toBe(false);
  });

  // Sin mensaje no hay nada que clasificar, y preguntar costaría una llamada
  // por cada adjunto suelto.
  it("un mensaje vacío ni pregunta", async () => {
    const c = responde("SI");
    expect(await necesitaOjos("   ", null, c)).toBe(false);
    expect(c).not.toHaveBeenCalled();
  });
});

describe("ojosPreguntaPara — lo que se paga por token", () => {
  // Un mensaje del Chat puede traer una página pegada dentro. La intención, si
  // existe, está en las primeras palabras; el resto es factura.
  it("recorta un mensaje enorme", () => {
    const q = ojosPreguntaPara("x".repeat(5_000));
    expect(q.length).toBeLessThan(700);
  });

  it("sin alt no inventa la línea del alt", () => {
    expect(ojosPreguntaPara("hola", null)).not.toMatch(/Alt text/);
    expect(ojosPreguntaPara("hola", "   ")).not.toMatch(/Alt text/);
  });
});

describe("el prompt enseña la misma taxonomía que el Chat", () => {
  // El bloque del adjunto en ai-design ya le explica al modelo qué NO puede
  // hacer a ciegas. Si las dos listas se separan, el detector empieza a decidir
  // con un criterio y el Chat a disculparse con otro — la forma exacta del
  // hallazgo 9, en otra superficie.
  it.each(["colours", "crop", "style", "alt text", "placing", "positioning"])(
    "menciona %o",
    (t) => {
      expect(OJOS_PROMPT.toLowerCase()).toContain(t);
    },
  );

  it("y dice explícitamente que ante la duda, NO", () => {
    expect(OJOS_PROMPT).toMatch(/not clear, answer NO/i);
  });
});
