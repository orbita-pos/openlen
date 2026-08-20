import { describe, expect, it } from "vitest";

import { ipInPrivateRange, ipv6IsPrivate, validateUrl } from "./validate-url";

/**
 * La defensa SSRF entera del scraping vivía SIN UNA SOLA PRUEBA.
 *
 * Es lo único que impide que una URL escrita por un visitante haga que NUESTRO
 * servidor consulte la red interna del Hetzner — o el endpoint de metadatos de
 * la nube, que es como se roban credenciales de infraestructura. Un fallo aquí
 * no degrada una página: entrega el servidor.
 *
 * Estas pruebas no usan red: las IP literales las resuelve `dns.lookup` sin
 * salir de la máquina.
 */
describe("ipInPrivateRange — el clasificador", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback, el otro extremo del /8"],
    ["10.0.0.1", "RFC-1918 clase A"],
    ["10.255.255.255", "RFC-1918 clase A, límite"],
    ["172.16.0.1", "RFC-1918 clase B, inicio"],
    ["172.31.255.255", "RFC-1918 clase B, final"],
    ["192.168.1.1", "RFC-1918 clase C"],
    ["169.254.169.254", "METADATOS DE NUBE — el que roba credenciales"],
    ["169.254.0.1", "link-local"],
    ["0.0.0.0", "ruta por defecto"],
    ["0.1.2.3", "el resto del 0/8"],
  ])("bloquea %s (%s)", (ip) => {
    expect(ipInPrivateRange(ip)).toBe(true);
  });

  it.each([
    ["8.8.8.8"],
    ["1.1.1.1"],
    ["172.32.0.1"], // JUSTO fuera del /12 — el error clásico es tomar 172.x entero
    ["172.15.255.255"], // justo antes
    ["11.0.0.1"], // junto al 10/8
    ["126.255.255.255"], // junto al 127/8
  ])("deja pasar %s, que es pública", (ip) => {
    expect(ipInPrivateRange(ip)).toBe(false);
  });

  // Falla CERRADO: lo que no sabe leer, lo trata como privado. Es la decisión
  // correcta — un parser que ante la duda deja pasar es una puerta abierta.
  it.each([["no-una-ip"], ["1.2.3"], ["1.2.3.4.5"], ["999.1.1.1"], [""], ["::1"]])(
    "ante lo que no entiende (%s) bloquea",
    (raw) => {
      expect(ipInPrivateRange(raw)).toBe(true);
    },
  );
});

describe("validateUrl — la puerta", () => {
  it.each([
    ["file:///etc/passwd", "leer archivos del servidor"],
    ["ftp://ejemplo.com", "otro protocolo"],
    ["javascript:alert(1)", "esquema ejecutable"],
    ["data:text/html,<h1>x", "documento embebido"],
  ])("rechaza %s (%s)", async (raw) => {
    const r = await validateUrl(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("invalid-url");
  });

  it("rechaza lo que ni siquiera es una URL", async () => {
    const r = await validateUrl("esto no es una url");
    expect(r.ok).toBe(false);
  });

  it.each([
    ["http://localhost/", "localhost por nombre"],
    ["http://0.0.0.0/", "la ruta por defecto"],
    ["http://algo.local/", "mDNS de la red local"],
    ["http://servicio.internal/", "nombre interno de nube"],
    ["http://intranet/", "un host sin punto = red local"],
  ])("bloquea %s por NOMBRE, antes de tocar el DNS (%s)", async (raw) => {
    const r = await validateUrl(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ssrf-blocked");
  });

  it.each([
    ["http://127.0.0.1:3000/", "nuestro propio Next"],
    ["http://10.0.0.5/", "red privada"],
    ["http://192.168.1.1/", "el router"],
    ["http://169.254.169.254/latest/meta-data/", "METADATOS DE NUBE"],
  ])("bloquea %s tras resolver la IP (%s)", async (raw) => {
    const r = await validateUrl(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ssrf-blocked");
  });

  // Sin esto la puerta no sirve de nada: si bloqueara TODO, pasaría todas las
  // pruebas de arriba y la función seguiría estando rota.
  it("deja pasar una URL pública normal", async () => {
    const r = await validateUrl("https://example.com/algo");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.hostname).toBe("example.com");
      expect(ipInPrivateRange(r.value.resolvedIp)).toBe(false);
    }
  });
});

/**
 * HUECOS CONOCIDOS — documentados aquí porque una defensa cuyos límites nadie
 * escribió se confunde con una defensa completa, y entonces alguien construye
 * encima creyéndola hermética.
 *
 * Ninguno se explota con las rutas de HOY (nada llama a validateUrl con URL de
 * visitante todavía). Se cierran ANTES de abrir la referencia por URL.
 */
describe("lo que esta puerta NO cubre", () => {
  // 1. IPv6. `dns.lookup(hostname, { family: 4 })` sólo pide registros A, y
  //    `ipInPrivateRange` sólo entiende IPv4 (por eso trata `::1` como
  //    privado: no lo parsea y falla cerrado, que es lo correcto).
  //    Pero un host con A pública y AAAA a `::1` pasa la validación y el
  //    `fetch` posterior puede elegir IPv6. Falta bloquear ::1, fc00::/7 y
  //    fe80::/10, y resolver AMBAS familias.
  // 1. CERRADO a medias: ahora se resuelven AMBAS familias y basta una privada
  //    para rechazar el host. `ipInPrivateRange` sigue sin parsear IPv6 — pero
  //    falla cerrado, y un host sin IPv4 pública se rechaza en vez de aprobarse
  //    a medias, porque `resolvedIp` no podría fijarse.
  it("`::1` se bloquea por no parsear — falla cerrado, que es lo correcto", () => {
    expect(ipInPrivateRange("::1")).toBe(true);
    expect(ipInPrivateRange("fc00::1")).toBe(true);
  });
});

describe("ipv6IsPrivate — el clasificador que faltaba", () => {
  // Nació de un bug MEDIDO: al pedir las dos familias, `ipInPrivateRange`
  // devolvía true para toda IPv6 (no las parsea) y example.com quedaba
  // bloqueada. Falla cerrado, sí — pero la función entera dejaba de servir.
  it.each([
    ["::1", "loopback"],
    ["::", "sin especificar"],
    ["fc00::1", "únicas locales"],
    ["fd12:3456::1", "únicas locales, la mitad de arriba del /7"],
    ["fe80::1", "enlace local"],
    ["fe80::1%eth0", "enlace local con zona"],
    ["::ffff:127.0.0.1", "IPv4 MAPEADA al loopback — la puerta de atrás clásica"],
    ["::ffff:169.254.169.254", "IPv4 mapeada a los metadatos de nube"],
  ])("bloquea %s (%s)", (ip) => {
    expect(ipv6IsPrivate(ip)).toBe(true);
  });

  it.each([
    ["2606:4700:10::6814:179a", "Cloudflare — la de example.com"],
    ["2001:4860:4860::8888", "Google DNS"],
    ["::ffff:8.8.8.8", "IPv4 mapeada, pero pública"],
  ])("deja pasar %s (%s)", (ip) => {
    expect(ipv6IsPrivate(ip)).toBe(false);
  });

  // 2. CERRADO: CGNAT, benchmarking y las asignaciones especiales del IETF ya
  //    se bloquean. "No es RFC-1918" no significaba "es de internet".
  it.each([
    ["100.64.0.1", "CGNAT — lo usan las nubes de verdad"],
    ["100.127.255.255", "CGNAT, el otro extremo del /10"],
    ["198.18.0.1", "benchmarking"],
    ["192.0.0.1", "asignaciones especiales IETF"],
  ])("CERRADO: %s se bloquea (%s)", (ip) => {
    expect(ipInPrivateRange(ip)).toBe(true);
  });

  it("y 100.128.0.1, justo fuera del CGNAT, sigue pasando", () => {
    expect(ipInPrivateRange("100.128.0.1")).toBe(false);
  });

  // 3. EL MÁS SERIO — DNS rebinding. `validateUrl` resuelve y aprueba, y luego
  //    QUIEN HAGA EL FETCH vuelve a resolver por su cuenta. Un DNS con TTL 0
  //    puede devolver una IP pública en la comprobación y 127.0.0.1 medio
  //    segundo después.
  //
  //    No se arregla dentro de esta función: se arregla conectando a la IP YA
  //    VALIDADA (`resolvedIp`, que este contrato ya devuelve) en vez de al
  //    hostname. Por eso el valor de retorno lo incluye — y por eso quien
  //    llame tiene que usarlo.
  it("devuelve la IP validada, que es lo que el fetch debe usar", async () => {
    const r = await validateUrl("https://example.com/");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.resolvedIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });
});
