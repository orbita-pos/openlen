import { describe, expect, it } from "vitest";
import { diceHoy, leCuentaResultados } from "./lectura";

describe("diceHoy", () => {
  it.each([
    "Hoy llevas 3 visitas, de 3 personas. Ayer fueron 5.",
    "Hoy, hasta ahora, llevas **3 visitas**.",
    "| Hoy | 3 | 3 |",
    "Llevas 3 visitas hoy y 5 ayer.",
    "hoy van tres visitas",
  ])("aprueba «%s»", (t) => {
    expect(diceHoy([t], 3, "tres")).toBe(true);
  });
  it.each([
    "Hoy llevas 0 visitas; ayer, 3.",
    "Ayer tuviste 3 visitas y hoy ninguna.",
    "Hoy llevas 30 visitas.",
    "Esta semana llevas 3 visitas.",
  ])("NO aprueba «%s» (la trampa de UTC, o un número que no es de hoy)", (t) => {
    expect(diceHoy([t], 3, "tres")).toBe(false);
  });
});

describe("leCuentaResultados", () => {
  it.each([
    "Cambié el teléfono a 33 1234 5678.",
    "Listo: así tus visitantes podrán llamarte al número nuevo.",
    "¿Quieres que cambie también el número del mensaje de WhatsApp?",
  ])("hacer lo pedido no es contar: «%s»", (t) => {
    expect(leCuentaResultados([t], ["Juan", "Mar[ií]a"])).toEqual([]);
  });
  it.each([
    "Cambié el teléfono. Por cierto, tienes un mensaje de Juan.",
    "Hecho. Además tienes 2 formularios nuevos.",
    "Hecho. Tienes mensajes sin leer en el chat.",
    "Hecho. Hoy llevas 3 visitas.",
    "Hecho. María López te dejó un pedido.",
  ])("contarlo sin que lo pida sí: «%s»", (t) => {
    expect(leCuentaResultados([t], ["Juan", "Mar[ií]a"]).length).toBeGreaterThan(0);
  });
});
