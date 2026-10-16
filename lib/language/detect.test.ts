// @vitest-environment node
// El idioma de lo escrito y CUÁNTA señal hay: Len por correo lo usa con su
// inglés por defecto (`detectLanguage`); el chat necesita saber cuándo no hay
// señal, para mirar los mensajes anteriores (`lib/agent/user-language.ts`).
import { describe, expect, it } from "vitest";
import { detectLanguage, languageSignal } from "./detect";

describe("languageSignal", () => {
  it("el idioma y cuántas palabras lo delatan", () => {
    expect(languageSignal("puedes hacerme que el hero que se vea como el hero de airbnb")).toEqual({ language: "es", points: 4 });
    // please, change, the, price, the, page
    expect(languageSignal("please change the price on the page")).toEqual({ language: "en", points: 6 });
  });

  it("la escritura (japonés, coreano, chino) y ¿¡ñ lo dicen solas: señal fuerte", () => {
    expect(languageSignal("価格を変えてください")?.language).toBe("ja");
    expect(languageSignal("가격을 바꿔 주세요")?.language).toBe("ko");
    expect(languageSignal("请修改价格")?.language).toBe("zh");
    expect(languageSignal("¿puedes?")?.language).toBe("es");
    expect(languageSignal("¿puedes?")!.points).toBeGreaterThanOrEqual(3);
  });

  it("sin una palabra que lo delate, null: no se inventa el inglés", () => {
    expect(languageSignal("continua")).toBeNull();
    expect(languageSignal("ok")).toBeNull();
    expect(languageSignal("")).toBeNull();
  });

  it("🔴 «de» y «en» no hacen neerlandés una frase en español (ensayo de caja, 16/10: Len contestó en neerlandés)", () => {
    expect(languageSignal("Publica la app en su dirección de siempre. No cambies nada, sólo publícala.")?.language).toBe("es");
    expect(languageSignal("Sube el menú de comida en dos columnas")?.language).toBe("es");
    expect(languageSignal("agrega fotos de tacos en el menú")?.language).toBe("es");
  });

  it("CONTRA-PRUEBA: el neerlandés sigue siendo neerlandés, y sin más señal que «de» y «en» no se inventa nada", () => {
    expect(languageSignal("Verander de kleur van de knop en maak het groter")?.language).toBe("nl");
    expect(languageSignal("maak de tekst groter en zet een foto erbij")?.language).toBe("nl");
    expect(languageSignal("de knop en de tekst")?.language).not.toBe("es");
  });

  it("detectLanguage, el de Len por correo, sigue diciendo inglés sin señal", () => {
    expect(detectLanguage("ok")).toBe("en");
    expect(detectLanguage("cambia el precio de la página por favor")).toBe("es");
  });
});
