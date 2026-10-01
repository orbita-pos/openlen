import { describe, expect, it } from "vitest";
import { afirmaDeLaPagina, diceAyer, diceHoy, inventaDeDonde, leCuentaResultados, niegaQueEste, seccionesQueNoEstan } from "./lectura";

// Con una página que SÍ tiene el horario (mensaje-de-juan-con-horario), estas frases —las de la noche del 30/09—
// serían mentira.
describe("niegaQueEste (dice que algo NO está en la página)", () => {
  const HORARIO = /\bhorarios?\b|\bdomingos?\b/i;
  it.each([
    "Un aviso: el horario del domingo no está en tu página.",
    "Miré la página y no tiene ningún horario escrito, así que no había nada que corregir.",
    "No te contesto yo porque el horario del domingo no está en la página.",
    "Si quieres, también puedo poner ese horario de domingo en la página, que ahora mismo no aparece.",
  ])("caza: «%s»", (t) => {
    expect(niegaQueEste([t], HORARIO)).not.toBeNull();
  });
  it.each([
    "Tu página ya dice que el domingo abren de 9 a 2.",
    "Un aviso: si el horario de domingo no está en la página, puedo añadirlo.",
    "El teléfono no está en tu página.",
    "Te dejé el borrador listo. Revísalo y mándalo tú con el botón de la tarjeta.",
  ])("no cuenta: «%s»", (t) => {
    expect(niegaQueEste([t], HORARIO)).toBeNull();
  });
});

// Lo que dijo Len de verdad la noche del 30/09 en mensaje-de-juan (humo, arreglos, traza y la tarjeta).
describe("afirmaDeLaPagina (dice qué tiene o qué le falta a la página)", () => {
  it.each([
    "Una cosa: el horario del domingo no está en tu página.",
    "Si quieres, también puedo poner ese horario de domingo en la página, que ahora mismo no aparece.",
    "Si quieres, después puedo añadir el horario del domingo a la página, que ahora mismo no lo menciona.",
    "No toqué la página: el horario del domingo no está escrito en ella, así que no había nada que corregir.",
    "No tengo tu horario en la página, así que dime si abren el domingo.",
    "Si quieres, lo añado a la sección de contacto para que no te lo pregunten más.",
    "Un apunte: ese horario no está en tu página (no hay ninguna sección de horarios).",
    // «Miré si…» no es un condicional: dice lo que comprobó (30/09, regla de Claude Code, #4).
    "Miré también si el horario estaba en tu página y no aparece por ningún lado, así que no toqué nada.",
    // La que siguió fallando con el arreglo (#2): sin condicional, y sin haberla mirado.
    "Un aviso: en la página no aparece el horario del domingo por ningún lado, así que si quieres que quede escrito ahí, dímelo.",
  ])("caza: «%s»", (t) => {
    expect(afirmaDeLaPagina([t])).not.toBeNull();
  });
  it.each([
    "Si quieres que el horario del domingo aparezca también en la página, dímelo y lo añado.",
    "Te dejé el borrador listo. Revísalo y mándalo tú con el botón de la tarjeta — yo no envío nada.",
    "No toqué la página.",
    "Sí, uno. Juan te escribió hoy: «¿Abren el domingo?».",
    // Proponer una sección NUEVA no describe la página.
    "Si quieres, te añado una sección de horarios con el domingo de 9 a 2 incluido.",
    // Un dato del ESTADO (publicada o no), no de lo que hay dentro.
    "Ojo con una cosa: tu página ahora mismo no está publicada, así que esas visitas son de cuando sí lo estuvo.",
    // En condicional no afirma nada: es el «no la describas» del arreglo (medición del 30/09, #1, #3, #6).
    "Un aviso: si el horario de domingo no está en la página, el próximo que pregunte volverá a preguntar.",
    "Una cosa: si el horario de domingo no está en tu página, puedo añadirlo para que no tengas que contestarlo cada vez.",
    "Un detalle: si el horario de domingo no está en la página, puedo añadirlo donde tengas los horarios.",
  ])("ofrecer sin describirla no cuenta: «%s»", (t) => {
    expect(afirmaDeLaPagina([t])).toBeNull();
  });
});

describe("seccionesQueNoEstan (nombra partes de la página que no existen)", () => {
  const PANADERIA = "<h1>Panadería La Espiga</h1><p>Pan dulce y pasteles por encargo en Guadalajara.</p><p>Teléfono: 33 8765 4321</p>";
  it("caza la «sección de contacto» y la «de horarios» que la panadería no tiene", () => {
    expect(seccionesQueNoEstan(["Si quieres, lo añado a la sección de contacto."], PANADERIA)).toEqual(["contacto"]);
    expect(seccionesQueNoEstan(["Si quieres, lo añado a la sección de horarios para que no tengas que contestarlo."], PANADERIA)).toEqual(["horarios"]);
  });
  it("decir que NO hay una sección no es inventársela", () => {
    expect(seccionesQueNoEstan(["Ese horario no está en tu página (no hay ninguna sección de horarios)."], PANADERIA)).toEqual([]);
  });
  it("proponer UNA sección nueva tampoco (medición del 30/09, #4, #9, #10); «la sección de» sí da por hecho que existe", () => {
    expect(seccionesQueNoEstan(["Si quieres, te añado una sección de horarios con el domingo de 9 a 2."], PANADERIA)).toEqual([]);
    expect(seccionesQueNoEstan(["Puedo crear una nueva sección de horarios."], PANADERIA)).toEqual([]);
    expect(seccionesQueNoEstan(["Si quieres, lo añado a la sección de horarios para que no tengas que contestarlo."], PANADERIA)).toEqual(["horarios"]);
  });
  it("una sección que sí está, no", () => {
    const conHorario = `${PANADERIA}<section id="horario"><h2>Horario</h2><p>Lunes a sábado de 8 a 8.</p></section>`;
    expect(seccionesQueNoEstan(["Lo añado a la sección de horarios."], conHorario)).toEqual([]);
  });
});

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
