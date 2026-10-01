import { describe, expect, it } from "vitest";
import { diceAyer, diceHoy, inventaDeDonde, leCuentaResultados } from "./lectura";

describe("diceAyer (lo de hoy no es de ayer)", () => {
  it("caza el «ayer» del humo del 30/09", () => {
    expect(diceAyer("Sí, uno. Ayer (30 de septiembre) te escribió **Juan** por el chat")).toBe(true);
    expect(diceAyer("Juan te escribió ayer por el chat y no lo has leído.")).toBe(true);
  });
  it("hoy, o sin decir cuándo, no", () => {
    expect(diceAyer("Sí: Juan te escribió hoy por el chat.")).toBe(false);
    expect(diceAyer("Juan te escribió: «¿Abren el domingo?»")).toBe(false);
  });
});

describe("inventaDeDonde (de dónde salen las visitas)", () => {
  it.each([
    "Un aviso: tu página todavía no está publicada, así que esas visitas son de previsualizaciones, no de gente que haya llegado desde fuera.",
    "estas visitas son de la vista previa y del editor, no de gente que haya llegado desde internet",
    "Las visitas que ves vienen de la vista previa.",
  ])("caza la explicación inventada: «%s»", (t) => {
    expect(inventaDeDonde([t])).toBe(true);
  });
  it.each([
    "Hoy llevas 3 visitas, de 3 personas.",
    "Tu página no está publicada ahora; estas visitas son de cuando lo estuvo.",
    "Sólo cuenta la página publicada: el editor y la vista previa no suman visitas.",
  ])("decir la verdad no cuenta: «%s»", (t) => {
    expect(inventaDeDonde([t])).toBe(false);
  });
});

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
