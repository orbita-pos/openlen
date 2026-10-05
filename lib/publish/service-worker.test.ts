// EL SERVICE WORKER NO ATRAPA A NADIE (pieza 9 de Len 2.5): dónde puede vivir
// el de un sitio, y el que se publica cuando el sitio no trae el suyo.
import { describe, expect, it } from "vitest";
import { SELF_UNREGISTERING_SW, serviceWorkerPaths } from "./service-worker";

describe("las rutas de service worker de una release", () => {
  it("siempre sw.js, más las que el sitio registra con un literal", () => {
    const files = [
      { path: "index.html", content: `<script>navigator.serviceWorker.register('/js/worker.js')</script>` },
      { path: "js/app.js", content: `if ('serviceWorker' in navigator) navigator.serviceWorker.register("offline-sw.js", { scope: "/" })` },
      { path: "menu/index.html", content: "<script>navigator.serviceWorker.register(`./sw-menu.js?v=2`)</script>" },
    ];
    // Relativa a la página que la registra, como la resuelve el navegador.
    expect(serviceWorkerPaths(files)).toEqual(["js/worker.js", "menu/sw-menu.js", "offline-sw.js", "sw.js"]);
  });

  it("lo de otro origen, una variable, una ruta reservada o un fichero que no es JS no cuenta", () => {
    const files = [
      {
        path: "index.html",
        content: `navigator.serviceWorker.register("https://otro.com/sw.js"); navigator.serviceWorker.register(url);
          navigator.serviceWorker.register("//cdn.com/sw.js"); navigator.serviceWorker.register("/assets/sw.js");
          navigator.serviceWorker.register("/datos.json")`,
      },
      { path: "data/x.json", content: `{"a":"navigator.serviceWorker.register('/js/no.js')"}` },
    ];
    expect(serviceWorkerPaths(files)).toEqual(["sw.js"]);
  });
});

describe("el que se da de baja", () => {
  it("se instala sin esperar, borra sus cachés, se da de baja y recarga las pestañas", () => {
    expect(SELF_UNREGISTERING_SW).toMatch(/self\.skipWaiting\(\)/);
    expect(SELF_UNREGISTERING_SW).toMatch(/caches\.delete\(/);
    expect(SELF_UNREGISTERING_SW).toMatch(/self\.registration\.unregister\(\)/);
    expect(SELF_UNREGISTERING_SW).toMatch(/client\.navigate\(client\.url\)/);
  });

  it("🔴 no intercepta nada: sin manejador de fetch, todo va a la red", () => {
    expect(SELF_UNREGISTERING_SW).not.toMatch(/addEventListener\(\s*["']fetch/);
  });

  it("es JavaScript que se puede evaluar", () => {
    expect(() => new Function(SELF_UNREGISTERING_SW)).not.toThrow();
  });
});
