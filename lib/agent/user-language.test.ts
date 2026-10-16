// @vitest-environment node
// EL IDIOMA EN QUE ESCRIBE EL USUARIO, no el de su interfaz (Jesús, 10/10).
// Con la interfaz en inglés y escribiendo en español, Len contestó en inglés:
// el contexto nombraba el idioma de la INTERFAZ. Los mensajes, los suyos de Holi.
import { describe, expect, it } from "vitest";
import { userWritingLanguage } from "./user-language";

const HOLI_T1 =
  "hazme una aplicacion para un sistema de paquete de viajes, se llama holi, y vendemos paquetes a todo mexico, usa y sur america, quiero que la page sea blanca con azul, primero solo hagamos el design y luego nos metemos para la base de dato";

describe("userWritingLanguage", () => {
  it("🔴 su mensaje, si lo dice claro, aunque no haya historial (Holi, turno 17: contestó en inglés)", () => {
    expect(userWritingLanguage("puedes hacerme que el hero que se vea como el hero de airbnb", [])).toBe("es");
  });

  it("🔴 un aviso en inglés pegado en una charla en español: manda la charla (Holi, turno 2)", () => {
    expect(userWritingLanguage("“#/destinos” doesn’t point to any section on this page", [HOLI_T1])).toBe("es");
  });

  it("un mensaje sin señal («continua»): el de sus mensajes anteriores", () => {
    expect(userWritingLanguage("continua", ["no, no estas entiendo quiero que hagas la animacion de irse hacia abajo o hacia arriba"])).toBe("es");
  });

  it("con poca señal y sin historial, la poca que hay (Holi, turno 18)", () => {
    expect(userWritingLanguage("haz el navbar mas lindo y menos generico", [])).toBe("es");
  });

  it("si cambia de idioma con claridad, manda el mensaje", () => {
    expect(userWritingLanguage("please change the price on the page and add a contact form", [HOLI_T1])).toBe("en");
  });

  it("🔴 una frase en español con «de» y «en» no es neerlandés (ensayo de caja, 16/10)", () => {
    expect(userWritingLanguage("Publica la app en su dirección de siempre. No cambies nada, sólo publícala.", [])).toBe("es");
  });

  it("sin ninguna señal: null, y el contexto usa el de la interfaz", () => {
    expect(userWritingLanguage("ok", [])).toBeNull();
    expect(userWritingLanguage("ok", ["👍", "https://holi.mx"])).toBeNull();
  });
});
