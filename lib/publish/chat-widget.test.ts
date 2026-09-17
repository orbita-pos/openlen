import { describe, expect, it } from "vitest";
import { bakeChatWidget } from "@/lib/publish/chat-widget";

const BASE = `<!doctype html><html lang="es"><body><main>hi</main></body></html>`;
const cfg = { sub: "demo", accent: "#7C3AED", mount: "fab" as const, selfServeJoin: true };

describe("bakeChatWidget", () => {
  it("injects the widget before </body> and is idempotent", () => {
    const once = bakeChatWidget(BASE, cfg);
    expect(once).toContain("data-ol-chat-widget");
    expect(once.indexOf("</body>")).toBeGreaterThan(once.indexOf("data-ol-chat-widget"));
    expect(bakeChatWidget(once, cfg)).toBe(once); // second bake is a no-op
  });
  it("fills the data-ol-chat-section placeholder in section mode", () => {
    const withSection = `<!doctype html><html lang="es"><body><div data-ol-chat-section></div></body></html>`;
    const out = bakeChatWidget(withSection, { ...cfg, mount: "section" });
    expect(out).toContain("data-ol-chat-widget");
    expect(out).toMatch(/data-ol-chat-section[^>]*>[\s\S]*data-ol-chat-widget/);
  });
  it("never emits data-slot-path and escapes < in config", () => {
    const out = bakeChatWidget(BASE, cfg);
    expect(out).not.toContain("data-slot-path");
    expect(out).not.toContain("</script><");
    expect(out).toContain("#7C3AED");
  });

  // Restyle WhatsApp 2026-07-15
  it("un acento que no es hex NO se interpola al CSS (guard anti-inyección)", () => {
    const out = bakeChatWidget(BASE, { ...cfg, accent: "red}body{background:url(//evil)" });
    expect(out).not.toContain("evil");
    expect(out).toContain("#FF5A36"); // cae al default
  });

  it("sin acento configurado cae al coral OpenLen (#FF5A36), no a un color inventado", () => {
    const out = bakeChatWidget(BASE, { sub: "demo", mount: "fab", selfServeJoin: true });
    expect(out).toContain("#FF5A36");
  });

  // Apilamiento de burbujas: el asistente ocupa los 18 px de la esquina, así
  // que un chat que NO se fusiona con él se hornea una ranura arriba.
  it("bakes the caller's bottom offset into the FAB and the panel", () => {
    const out = bakeChatWidget(BASE, { ...cfg, bottomPx: 86 });
    expect(out).toContain('"bottom":86');
    const own = bakeChatWidget(BASE, cfg);
    expect(own).not.toContain('"bottom"'); // sin offset = 18 px por default
  });

  it("skips the API calls when there is no sub (draft preview shell only)", () => {
    const out = bakeChatWidget(BASE, { ...cfg, sub: "" });
    expect(out).toContain("if(!C.sub){authView();return}");
  });

  it("el script trae la piel WhatsApp: avatar del header, papel tapiz y timestamps", () => {
    const out = bakeChatWidget(BASE, cfg);
    expect(out).toContain('"ava"'); // avatar circle en el header
    expect(out).toContain("radial-gradient"); // papel tapiz
    expect(out).toContain("fmtT"); // formateador de hora de burbuja
    expect(out).toContain('"hello"'); // saludo como burbuja en el form
    // el acento configurado sigue mandando sobre el default
    expect(out).toContain("#7C3AED");
  });
});

// EL FOCO ES DEL VISITANTE, NO DEL WIDGET.
//
// MEDIDO el 2026-09-16 en móvil, con el chat en modo sección: la vista de
// invitado se pinta AL CARGAR la página, y enfocaba «Tu nombre» sola. El
// visitante estaba escribiéndole al asistente; el resto de lo que tecleó y el
// Enter se fueron al chat, y su pregunta no salió nunca. En un teléfono además
// desplaza la página y abre el teclado sin que nadie toque nada.
//
// Estas pruebas EJECUTAN el script horneado en jsdom en vez de mirar la cadena:
// «no aparece .focus()» pasaría igual si el widget se rompiera entero. Con
// `sub` vacío el arranque no llama a la API (es la trampilla de la vista
// previa), así que la vista de invitado se pinta sin red de por medio.
describe("el foco del chat incrustado", () => {
  const pintar = (html: string) => {
    document.open();
    document.write(html);
    document.close();
    // El script corre SOLO: el entorno jsdom de vitest lleva
    // `runScripts: "dangerously"`, asi que el widget ya arranco dentro del
    // document.write y para cuando volvemos el anfitrion tiene su shadowRoot.
    // Ejecutar el texto a mano ademas seria un no-op —`instance()` sale por su
    // guarda de `if(host.shadowRoot)return`—, y una linea que no sujeta nada
    // parece que sujeta algo. Medido con una sonda el 2026-09-16.
    return document.querySelector("[data-ol-chat-host]") as HTMLElement;
  };
  const invitado = { ...cfg, sub: "", identityMode: "guest" as const };

  it("🔴 en modo sección NO enfoca al cargar: el visitante no lo abrió", async () => {
    const host = pintar(
      bakeChatWidget(
        `<!doctype html><html lang="es"><body><div data-ol-chat-section></div></body></html>`,
        { ...invitado, mount: "section" },
      ),
    );
    // El foco se pedía en un setTimeout(…, 0): hay que dejar pasar el turno.
    await new Promise((r) => setTimeout(r, 5));
    expect(host.shadowRoot!.querySelector("input")).not.toBeNull(); // se pintó
    expect(host.shadowRoot!.activeElement).toBeNull();
  });

  it("y con la burbuja, abrirla SÍ enfoca — que es lo que el visitante pidió", async () => {
    // El brazo de control de la de arriba: si el arreglo fuese «quitar el
    // foco», esto se caería y diría que se perdió la comodidad que sí valía.
    const host = pintar(
      bakeChatWidget(`<!doctype html><html lang="es"><body><main>hi</main></body></html>`, {
        ...invitado,
        mount: "fab",
      }),
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(host.shadowRoot!.activeElement).toBeNull(); // cerrada, nada enfocado
    (host.shadowRoot!.querySelector("button.fab") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 5));
    expect(host.shadowRoot!.activeElement).toBe(host.shadowRoot!.querySelector("input"));
  });
});
