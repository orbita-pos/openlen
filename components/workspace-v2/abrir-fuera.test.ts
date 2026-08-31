// LO QUE EL TALLER ABRE, Y LO QUE NO.
//
// La mitad del iframe la mide `enlaces-del-sitio.browser.test.ts` con un
// navegador de verdad —el sandbox rechazando el protocolo externo no se puede
// ver en jsdom—. Esto mide la otra mitad: qué hace el PADRE con el destino que
// le sube, que es donde vive la decisión de seguridad y donde vivía un aviso
// que mentía en cada clic.
import { describe, expect, it, vi, afterEach } from "vitest";

import { abrirDesdeElTaller, destinoDelLienzo } from "./abrir-fuera";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("destinoDelLienzo — en qué cubo cae cada destino", () => {
  it("http(s) se abre en pestaña", () => {
    expect(destinoDelLienzo("https://wa.me/525512345678")).toBe("http");
    expect(destinoDelLienzo("http://ejemplo.com")).toBe("http");
    expect(destinoDelLienzo("HTTPS://EJEMPLO.COM")).toBe("http");
  });

  it("los esquemas de contacto se entregan al sistema", () => {
    // Éste es el bug #2: los tres morían mudos dentro del sandbox del lienzo.
    expect(destinoDelLienzo("mailto:hola@x.com")).toBe("externo");
    expect(destinoDelLienzo("tel:+525512345678")).toBe("externo");
    expect(destinoDelLienzo("whatsapp://send?phone=52551234")).toBe("externo");
    expect(destinoDelLienzo("sms:+52551234")).toBe("externo");
    // Y uno que nadie previó, que es justo el punto de que la lista sea de
    // PROHIBIDOS: con una lista de permitidos, éste volvería a morir en
    // silencio y el fallo entero regresaría con otro nombre.
    expect(destinoDelLienzo("tg://resolve?domain=cafe")).toBe("externo");
  });

  it("nunca abre lo que correría con el origen de OpenLen", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
      "blob:https://openlen.com/abc",
      "file:///C:/Users/jesus",
      "about:blank",
      "view-source:https://openlen.com",
    ]) {
      expect(destinoDelLienzo(url), url).toBe("prohibido");
    }
  });

  it("el esquema partido con TAB o salto de línea tampoco pasa", () => {
    // El navegador BORRA TAB, LF y CR de una URL antes de usarla, así que
    // "java\tscript:" es "javascript:" para él. Comparar el texto crudo dejaría
    // pasar exactamente lo que la lista prohíbe.
    expect(destinoDelLienzo("java\tscript:alert(1)")).toBe("prohibido");
    expect(destinoDelLienzo("java\nscript:alert(1)")).toBe("prohibido");
    expect(destinoDelLienzo("java\rscript:alert(1)")).toBe("prohibido");
  });

  it("sin esquema no es un protocolo raro: es una ruta, y navegaría el taller", () => {
    // Un `<a href="/cuenta">` creado en el documento del PADRE apunta a
    // openlen.com/cuenta. Entregar esto se llevaría el taller por delante.
    expect(destinoDelLienzo("/cuenta")).toBe("prohibido");
    expect(destinoDelLienzo("alert(1)")).toBe("prohibido");
    expect(destinoDelLienzo("")).toBe("prohibido");
    expect(destinoDelLienzo("//cdn.evil.com/x")).toBe("prohibido");
  });
});

describe("abrirDesdeElTaller", () => {
  it("http(s) va por window.open, con noopener", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    expect(abrirDesdeElTaller("https://wa.me/52551234")).toBe("abierta");
    expect(open).toHaveBeenCalledWith("https://wa.me/52551234", "_blank", "noopener,noreferrer");
  });

  it("un protocolo externo se entrega con un ancla, NO con window.open", () => {
    // `window.open("tel:…")` abre una pestaña que el navegador cierra a
    // continuación: un parpadeo en blanco. Un ancla del documento del taller le
    // pasa el destino al sistema y no navega.
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const clicks: string[] = [];
    const clickReal = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clicks.push(this.getAttribute("href") ?? "");
    };
    try {
      expect(abrirDesdeElTaller("tel:+525512345678")).toBe("entregada");
      expect(clicks).toEqual(["tel:+525512345678"]);
      expect(open).not.toHaveBeenCalled();
      // Y no deja basura en el documento del taller.
      expect(document.querySelectorAll("a").length).toBe(0);
    } finally {
      HTMLAnchorElement.prototype.click = clickReal;
    }
  });

  it("un esquema prohibido no abre ni entrega nada", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    expect(abrirDesdeElTaller("javascript:alert(1)")).toBe("prohibido");
    expect(open).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
});

describe("el aviso de «tu navegador bloqueó la pestaña»", () => {
  // 🔴 EL BRAZO DE CONTROL DE UN AVISO QUE MENTÍA EN CADA CLIC.
  //
  // `window.open` CONSUME la activación transitoria. La primera versión leía
  // `navigator.userActivation.isActive` DESPUÉS de abrir —o sea, siempre
  // false— y lo combinaba con el valor de retorno, que con `noopener` es
  // siempre null aunque la pestaña se haya abierto. Las dos señales post
  // mortem: el aviso salía SIEMPRE, con la pestaña abierta delante.
  //
  // Esta prueba reproduce el consumo: la activación se apaga en cuanto
  // `window.open` corre. Con el orden malo el resultado sería "sin-gesto".
  const conActivacion = (viva: boolean) => {
    let activa = viva;
    Object.defineProperty(navigator, "userActivation", {
      configurable: true,
      get: () => ({ isActive: activa }),
    });
    vi.spyOn(window, "open").mockImplementation(() => {
      activa = false; // así se comporta el navegador de verdad
      return null;
    });
  };

  it("no sale cuando había gesto, aunque open lo consuma y devuelva null", () => {
    conActivacion(true);
    expect(abrirDesdeElTaller("https://wa.me/52551234")).toBe("abierta");
  });

  it("sale cuando de verdad no había gesto", () => {
    conActivacion(false);
    expect(abrirDesdeElTaller("https://wa.me/52551234")).toBe("sin-gesto");
  });
});
