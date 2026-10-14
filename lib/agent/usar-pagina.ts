// USAR LA PÁGINA — `use_page`, H9 (plans/len-2/hipotesis/H9-usar-la-pagina.md).
//
// 🔴 POR QUÉ EXISTE. Len medía la página tras cada edición y podía mirarla, pero
// NUNCA la usaba: no pulsaba, no tecleaba, no recargaba. Así se entregaron la
// calculadora cuya barra no movía el precio, el código de descuento que se
// «aplicaba» sin bajar nada y el botón de WhatsApp que seguía en un ancla. Claude
// Code lo pide con todas las letras: en un cambio de interfaz, usar la función en
// un navegador antes de darlo por hecho, probar el camino normal y los casos
// raros, y si no se pudo probar, decirlo en vez de darlo por bueno. Y si hay
// botones, se prueban pulsándolos.
//
// 🔴 NO ES LA PRUEBA DECLARADA QUE SE RETIRÓ, y la diferencia es el diseño entero.
// Aquélla juzgaba una aserción del modelo, sin lazo causal entre la acción y lo
// comprobado, y acusó páginas sanas (0 de 3). Esto NO JUZGA NADA: hace lo que un
// visitante haría y devuelve HECHOS de cada paso —qué pulsó, qué cambió en lo que
// se ve, qué guardó, a dónde mandó—. La conclusión es de Len, que tiene el
// fichero. Es el navegador de Claude Code (navigate, click, type, read_page), con
// varios pasos en una sola ida como su `browser_batch`, porque DeepSeek hace casi
// siempre una llamada por vuelta.
//
// Los tres agujeros MEDIDOS de la prueba declarada se tapan con hechos:
//   · lo que cambia SOLO (un contador, un carrusel) se marca, porque la página se
//     observa quieta antes de cada acción;
//   · un clic sobre algo que NADIE escucha lo dice la propia acción —la forma del
//     `(note: …)` de Claude Code—, no una regla que lo deduzca después;
//   · un control que no existe o que no es único no se pulsa «al azar»: la acción
//     no se hace y se dice con los candidatos, como el `Edit` que no casa.
//
// 🔴 NADA SALE (la regla del camino destructivo de `verify`): un formulario no
// llega al correo del dueño y un enlace a otro sitio no se abre — se dice a
// dónde iba.

import { createHash } from "node:crypto";
import { Script } from "node:vm";
import type { Browser, ElementHandle, Page } from "puppeteer";

import { TEXTO_DE_LA_PAGINA_ES_DATO } from "@/lib/agent/aviso-medido";
import type { InlineImage } from "@/lib/ai-gateway";
import { esperarALaRed, origenDeMedida, type DocumentoServido } from "@/lib/ai/origen-de-medida";
import { textoDelError, traductorDeMapas, type Traductor } from "@/lib/ai/sitio-del-error";
import { lanzarChromium } from "@/lib/ai/visual-quality-renderer";
import { carpetaDeLaVista, documentoMedible, type ContextoDeVista } from "@/lib/lienzo/documento";
import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";
import type { BrowserTabHolder, PasoDeUso } from "@/lib/agent/pasos-de-uso";

export type { PasoDeUso } from "@/lib/agent/pasos-de-uso";

/** Lo que se espera tras cada acción. Sin ventana, el 100 % de las
 *  comprobaciones de algo con tiempo dentro fallaban (medido el 2026-08-23 con
 *  un pomodoro correcto que aún marcaba 25:00 a los 0 ms). */
const VENTANA_MS = 1_500;
/** Lo que se espera ANTES de cada acción a que la página se quede quieta: al
 *  llevar el control a la vista se disparan las animaciones de «al verse», y no
 *  son efecto del clic. */
const QUIETUD_MS = 2_000;
const PLAZO_DE_LA_VISITA_MS = 90_000;

// ─── Lo que corre dentro de la página ──────────────────────────────────────
//
// ⚠️ COMO CADENA, nunca como función: `evaluate(() => …)` pasa por esbuild/tsx,
// que inyecta `__name`, y ése no existe en el navegador (ya costó una sesión).
// Se instala con `evaluateOnNewDocument`, antes que los scripts de la página y
// también tras cada recarga.

export const PRELUDIO_DE_USO = `
(function () {
  if (window.__olUsar) return;
  var TIPOS = { click: 1, mousedown: 1, mouseup: 1, pointerdown: 1, pointerup: 1, touchstart: 1, touchend: 1 };
  // Los de un CAMPO: teclear, mover una barra, elegir en un desplegable.
  var TIPOS_CAMPO = { input: 1, change: 1, keyup: 1, keydown: 1, keypress: 1 };
  var oyen = new Set();
  var oyenCampo = new Set();
  var orig = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (tipo, fn, op) {
    if (TIPOS[tipo]) oyen.add(this);
    if (TIPOS_CAMPO[tipo]) oyenCampo.add(this);
    return orig.call(this, tipo, fn, op);
  };
  var R = { salidas: [], envios: [], elegido: null, hechos: [], webgl: "" };
  window.open = function (u) { R.salidas.push(String(u == null ? "" : u)); return null; };
  // LO QUE EL NAVEGADOR HACE POR LA PÁGINA Y NO SE VE EN EL DOM (14/10): tomar
  // el puntero, la pantalla completa, un contexto WebGL. En el turno del
  // Minecraft Len concluyó que este navegador no concede el pointer lock (sí lo
  // concede) porque nadie le dijo lo que pasó. Con el addEventListener ORIGINAL.
  orig.call(document, "pointerlockchange", function () { R.hechos.push(document.pointerLockElement ? "lock-on" : "lock-off"); });
  orig.call(document, "pointerlockerror", function () { R.hechos.push("lock-error"); });
  orig.call(document, "fullscreenchange", function () { R.hechos.push(document.fullscreenElement ? "fullscreen-on" : "fullscreen-off"); });
  orig.call(document, "fullscreenerror", function () { R.hechos.push("fullscreen-error"); });
  var getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (tipo) {
    var c = getContext.apply(this, arguments);
    if (/webgl/i.test(String(tipo))) R.webgl = c ? "ok" : R.webgl || "failed";
    return c;
  };
  // Los enlaces que sacan de ESTE documento no se siguen: se apunta a dónde iban.
  // En window y en burbuja: corre lo último, así que lee el href que el script
  // de la página le acaba de poner. Registrado con el addEventListener ORIGINAL:
  // lo nuestro no cuenta como alguien que escucha.
  orig.call(window, "click", function (e) {
    var t = e.target;
    var a = t && t.closest ? t.closest("a[href]") : null;
    if (!a || e.defaultPrevented) return;
    var escrito = a.getAttribute("href") || "";
    if (escrito.charAt(0) === "#") return;
    var u;
    try { u = new URL(a.href, location.href); } catch (x) { return; }
    if (u.origin === location.origin && u.pathname === location.pathname && u.search === location.search) return;
    R.salidas.push(u.origin === location.origin ? escrito : u.href);
    e.preventDefault();
  });
  function camposDe(f) {
    var c = [];
    try { new FormData(f).forEach(function (v, k) { c.push([String(k), typeof v === "string" ? v : "(archivo)"]); }); } catch (x) {}
    return c;
  }
  orig.call(window, "submit", function (e) {
    R.envios.push({ cancelado: e.defaultPrevented, campos: camposDe(e.target) });
    if (!e.defaultPrevented) e.preventDefault();
  });
  HTMLFormElement.prototype.submit = function () {
    R.envios.push({ cancelado: false, campos: camposDe(this), porScript: true });
  };

  function norm(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/\\s+/g, " ").trim().toLowerCase();
  }
  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    var cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden";
  }
  function textoDe(el) {
    var t = el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("alt") || "";
    return String(t).replace(/\\s+/g, " ").trim();
  }
  function etiquetaDe(e) {
    var partes = [];
    if (e.id) document.querySelectorAll('label[for="' + CSS.escape(e.id) + '"]').forEach(function (l) { partes.push(l.innerText || l.textContent); });
    var l = e.closest("label");
    if (l) partes.push(l.innerText || l.textContent);
    var lb = e.getAttribute("aria-labelledby");
    if (lb) lb.split(/\\s+/).forEach(function (id) { var x = document.getElementById(id); if (x) partes.push(x.textContent); });
    partes.push(e.getAttribute("aria-label"), e.getAttribute("placeholder"), e.getAttribute("name"), e.id);
    for (var i = 0; i < partes.length; i++) {
      var p = String(partes[i] == null ? "" : partes[i]).replace(/\\s+/g, " ").trim();
      if (p) return p.slice(0, 60);
    }
    return "";
  }
  function huellaDe(e) {
    var partes = [];
    if (e.id) document.querySelectorAll('label[for="' + CSS.escape(e.id) + '"]').forEach(function (l) { partes.push(l.textContent); });
    var l = e.closest("label");
    if (l) partes.push(l.textContent);
    var lb = e.getAttribute("aria-labelledby");
    if (lb) lb.split(/\\s+/).forEach(function (id) { var x = document.getElementById(id); if (x) partes.push(x.textContent); });
    partes.push(e.getAttribute("aria-label"), e.getAttribute("placeholder"), e.getAttribute("name"), e.id);
    return norm(partes.filter(Boolean).join(" "));
  }

  function foto() {
    var lineas = (document.body ? document.body.innerText : "").split("\\n")
      .map(function (l) { return l.replace(/\\s+/g, " ").trim(); })
      .filter(Boolean);
    document.querySelectorAll("input, select, textarea").forEach(function (e) {
      var t = (e.type || "").toLowerCase();
      if (["hidden", "password", "submit", "button", "reset", "image", "file"].indexOf(t) >= 0) return;
      var et = etiquetaDe(e) || t || e.tagName.toLowerCase();
      if (t === "checkbox" || t === "radio") {
        if (e.checked) lineas.push("[" + (t === "radio" ? "option" : "checkbox") + " «" + et + "»: checked]");
        return;
      }
      if (!visible(e)) return;
      var v = e.tagName === "SELECT" ? (e.options[e.selectedIndex] ? e.options[e.selectedIndex].text : "") : e.value;
      lineas.push("[field «" + et + "»: «" + String(v).replace(/\\s+/g, " ").slice(0, 80) + "»]");
    });
    var guardado = {};
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); guardado[k] = localStorage.getItem(k); } } catch (x) {}
    try { for (var j = 0; j < sessionStorage.length; j++) { var s = sessionStorage.key(j); guardado["(session) " + s] = sessionStorage.getItem(s); } } catch (x) {}
    return { lineas: lineas, guardado: guardado, url: location.href };
  }

  var CLIC = 'a, button, summary, label, input[type="button"], input[type="submit"], input[type="reset"], [role="button"], [role="tab"], [role="option"], [role="radio"], [role="checkbox"], [role="menuitem"], [role="switch"], [onclick], [tabindex]';
  function pulsables(todos) {
    var s = new Set(document.querySelectorAll(CLIC));
    oyen.forEach(function (n) { if (n && n.nodeType === 1 && n !== document.body && n !== document.documentElement) s.add(n); });
    var out = Array.from(s);
    return todos ? out : out.filter(visible);
  }
  // El de más adentro: una tarjeta que escucha el clic y envuelve su botón no
  // cuenta dos veces.
  function masAdentro(lista) {
    return lista.filter(function (el) { return !lista.some(function (o) { return o !== el && el.contains(o); }); });
  }
  function exactos(lista, q) {
    var ex = lista.filter(function (el) { return norm(textoDe(el)) === q; });
    return ex.length > 0 ? ex : lista;
  }
  // El bloque MÁS PEQUEÑO que contiene el control y dice «dentro»: así «Agregar»
  // dentro de «Taza» es el de la tarjeta de la taza y no el de toda la tienda.
  function dentroDe(lista, dentro) {
    if (!dentro) return lista;
    var d = norm(dentro), mejores = [], tam = Infinity;
    lista.forEach(function (el) {
      for (var a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        var t = norm(a.innerText);
        if (t.indexOf(d) < 0) continue;
        if (t.length < tam) { tam = t.length; mejores = [el]; } else if (t.length === tam) mejores.push(el);
        break;
      }
    });
    return mejores;
  }
  function pista(el) {
    var propio = norm(textoDe(el));
    for (var a = el.parentElement, k = 0; a && a !== document.body && k < 8; a = a.parentElement, k++) {
      var t = (a.innerText || "").replace(/\\s+/g, " ").trim();
      if (norm(t).length > propio.length + 2) return t.slice(0, 50);
    }
    return "";
  }
  function elegir(lista, q, dentro, que) {
    var c = dentroDe(masAdentro(exactos(lista, q)), dentro);
    if (c.length === 1) {
      R.elegido = c[0];
      var el = c[0];
      var tipo = el.tagName.toLowerCase() + (el.type && el.tagName !== "BUTTON" ? " type=" + el.type : "");
      // Los que TAMBIÉN lo dicen y no se pulsaron (se eligió el que lo dice
      // exacto, o el del bloque pedido): se nombran, como el Edit que avisa de
      // que hay más coincidencias. Callarlos escondía el botón roto.
      var otros = [];
      masAdentro(lista).forEach(function (o) {
        if (o === el || el.contains(o) || o.contains(el)) return;
        var t = textoDe(o).slice(0, 50);
        if (t && otros.indexOf(t) < 0) otros.push(t);
      });
      return { n: 1, que: que, tipo: tipo, texto: textoDe(el).slice(0, 80), href: el.getAttribute("href") || "", otros: otros.slice(0, 6), masOtros: Math.max(0, otros.length - 6) };
    }
    if (c.length === 0) return { n: 0, que: que };
    return { n: c.length, que: que, pistas: c.slice(0, 8).map(pista) };
  }

  function control(q0, dentro) {
    var q = norm(q0);
    var lista = pulsables(false).filter(function (el) { return norm(textoDe(el)).indexOf(q) >= 0; });
    if (lista.length === 0) {
      // Lo que se pulsa sin ser un control: un texto con un clic delegado en su
      // contenedor. Sólo si dice EXACTAMENTE eso.
      var sueltos = Array.from(document.querySelectorAll("body *")).filter(function (el) {
        return visible(el) && norm(el.innerText) === q;
      });
      if (sueltos.length > 0) {
        var r = elegir(sueltos, q, dentro, "texto");
        if (r.n !== 0) return r;
      }
      var ocultos = pulsables(true).filter(function (el) { return !visible(el) && norm(textoDe(el)).indexOf(q) >= 0; }).length;
      var hay = [];
      pulsables(false).forEach(function (el) { var t = textoDe(el).slice(0, 40); if (t && hay.indexOf(t) < 0) hay.push(t); });
      return { n: 0, ocultos: ocultos, hay: hay.slice(0, 15) };
    }
    return elegir(lista, q, dentro, "control");
  }

  function campo(en0) {
    var en = norm(en0);
    var lista = Array.from(document.querySelectorAll("input, textarea")).filter(function (e) {
      var t = (e.type || "").toLowerCase();
      if (["hidden", "submit", "button", "reset", "checkbox", "radio", "file", "image"].indexOf(t) >= 0) return false;
      return visible(e) && huellaDe(e).indexOf(en) >= 0;
    });
    if (lista.length === 1) {
      R.elegido = lista[0];
      return { n: 1, tipo: (lista[0].type || "text").toLowerCase(), etiqueta: etiquetaDe(lista[0]) };
    }
    if (lista.length > 1) return { n: lista.length, etiquetas: lista.slice(0, 8).map(etiquetaDe) };
    var selects = Array.from(document.querySelectorAll("select")).filter(function (s) { return visible(s) && huellaDe(s).indexOf(en) >= 0; }).length;
    var hay = [];
    document.querySelectorAll("input, textarea, select").forEach(function (e) {
      var t = (e.type || "").toLowerCase();
      if (["hidden", "submit", "button", "reset", "image"].indexOf(t) >= 0 || !visible(e)) return;
      var et = etiquetaDe(e);
      if (et && hay.indexOf(et) < 0) hay.push(et);
    });
    return { n: 0, selects: selects, hay: hay.slice(0, 15) };
  }

  function opcion(q0, dentro) {
    var q = norm(q0);
    // 1) La opción de un desplegable.
    var sel = Array.from(document.querySelectorAll("select")).filter(function (s) {
      return !s.disabled && visible(s) && Array.from(s.options).some(function (o) { return norm(o.textContent).indexOf(q) >= 0; });
    });
    sel = dentroDe(sel, dentro);
    if (sel.length > 1) return { n: sel.length, que: "desplegable", pistas: sel.slice(0, 8).map(etiquetaDe) };
    if (sel.length === 1) {
      var s = sel[0];
      var ops = Array.from(s.options).filter(function (o) { return norm(o.textContent).indexOf(q) >= 0; });
      var exacta = ops.filter(function (o) { return norm(o.textContent) === q; });
      var op = (exacta.length ? exacta : ops)[0];
      s.value = op.value;
      s.dispatchEvent(new Event("input", { bubbles: true }));
      s.dispatchEvent(new Event("change", { bubbles: true }));
      R.elegido = s;
      return { n: 1, que: "desplegable", texto: String(op.textContent).replace(/\\s+/g, " ").trim().slice(0, 80), etiqueta: etiquetaDe(s) };
    }
    // 2) La casilla o el radio con esa etiqueta (a menudo escondidos tras una etiqueta con estilo).
    var cas = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]')).filter(function (c) {
      if (c.disabled) return false;
      var l = c.closest("label");
      var pinta = visible(c) || (l && visible(l)) || (c.id && Array.from(document.querySelectorAll('label[for="' + CSS.escape(c.id) + '"]')).some(visible));
      return pinta && huellaDe(c).indexOf(q) >= 0;
    });
    cas = dentroDe(cas, dentro);
    if (cas.length > 1) {
      var exactas = cas.filter(function (c) { return norm(etiquetaDe(c)) === q; });
      if (exactas.length === 1) cas = exactas;
    }
    if (cas.length > 1) return { n: cas.length, que: "casilla", pistas: cas.slice(0, 8).map(etiquetaDe) };
    if (cas.length === 1) {
      var c = cas[0];
      var yaEstaba = c.checked;
      R.elegido = c;
      if (!(c.type === "checkbox" && c.checked)) c.click();
      return { n: 1, que: c.type === "radio" ? "radio" : "casilla", texto: etiquetaDe(c), yaEstaba: yaEstaba };
    }
    // 3) El botón con ese texto (un chip, una pestaña…): se pulsa como un visitante.
    var r = control(q0, dentro);
    if (r.n === 1) r.que = "boton";
    return r;
  }

  // El bloque que se lee (o se captura): el elemento más adentro con ese texto,
  // subiendo hasta que tenga algo de contexto.
  function bloque(q0) {
    var q = norm(q0);
    var todos = Array.from(document.querySelectorAll("body *")).filter(function (el) {
      return visible(el) && norm(el.innerText).indexOf(q) >= 0 && ["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].indexOf(el.tagName) < 0;
    });
    if (todos.length === 0) return null;
    var chicos = masAdentro(todos);
    var el = chicos[0];
    var minimo = Math.max(q.length * 3, 40);
    while (el.parentElement && el.parentElement !== document.body && (el.innerText || "").length < minimo && (el.parentElement.innerText || "").length <= 800) {
      el = el.parentElement;
    }
    return { el: el, sitios: chicos.length };
  }
  function leer(q0) {
    var b = bloque(q0);
    if (!b) return { encontrado: false };
    var el = b.el;
    var texto = (el.innerText || "").replace(/\\s+/g, " ").trim();
    var campos = [];
    el.querySelectorAll("input, select, textarea").forEach(function (e) {
      var t = (e.type || "").toLowerCase();
      if (["hidden", "password", "submit", "button", "reset", "image", "file", "checkbox", "radio"].indexOf(t) >= 0 || !visible(e)) return;
      var v = e.tagName === "SELECT" ? (e.options[e.selectedIndex] ? e.options[e.selectedIndex].text : "") : e.value;
      campos.push("[field «" + (etiquetaDe(e) || t) + "»: «" + String(v).slice(0, 80) + "»]");
    });
    return { encontrado: true, texto: texto.slice(0, 600), campos: campos, sitios: b.sitios };
  }

  // ¿Alguien escucha el clic de este control? El control, sus contenedores,
  // document y window, por addEventListener o por on…=.
  function escucha(el) {
    for (var n = el; n; n = n.parentNode) {
      if (oyen.has(n)) return true;
      if (n.nodeType === 1 && (n.onclick || n.onmousedown || n.onmouseup || n.onpointerdown || n.onpointerup || n.ontouchstart || n.ontouchend)) return true;
    }
    return oyen.has(window) || typeof window.onclick === "function";
  }
  // ¿Alguien escucha lo que se teclea o se elige en este campo? Él, su
  // formulario y sus contenedores, document y window.
  function escuchaCampo(el) {
    for (var n = el; n; n = n.parentNode) {
      if (oyenCampo.has(n)) return true;
      if (n.nodeType === 1 && (n.oninput || n.onchange || n.onkeyup || n.onkeydown || n.onkeypress)) return true;
    }
    return oyenCampo.has(window);
  }
  // ¿El navegador ya hace algo al pulsarlo, sin script? Un enlace, un botón que
  // envía su formulario, una casilla, una etiqueta, un <summary>.
  function accionPropia(el) {
    if (el.closest("a[href], summary, label, select, input, textarea")) return true;
    var b = el.closest("button, input[type=submit]");
    return !!(b && b.form && String(b.type || "submit").toLowerCase() === "submit");
  }
  function tapado(el) {
    var r = el.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return "";
    var top = document.elementFromPoint(x, y);
    if (!top || top === el || el.contains(top) || top.contains(el)) return "";
    return (top.innerText || top.getAttribute("aria-label") || top.tagName.toLowerCase()).replace(/\\s+/g, " ").trim().slice(0, 60);
  }
  function antesDeActuar() {
    var el = R.elegido;
    if (!el) return null;
    // "instant": con \`html{scroll-behavior:smooth}\` el desplazamiento se animaba
    // ~900 ms y el clic caía con la página aún moviéndose (el mouseup en otra
    // cosa, el clic a la sección). Así lo hace el propio Puppeteer.
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    var campo = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !/^(button|submit|reset|image)$/i.test(el.type || "");
    return campo ? { escucha: escuchaCampo(el), propia: false, campo: true } : { escucha: escucha(el), propia: accionPropia(el) };
  }
  function ancla(href) {
    if (!href || href.charAt(0) !== "#" || href.length < 2) return null;
    var id = decodeURIComponent(href.slice(1));
    return { id: id, existe: !!document.getElementById(id) };
  }
  function sacar() {
    var s = { salidas: R.salidas.slice(), envios: R.envios.slice() };
    R.salidas.length = 0;
    R.envios.length = 0;
    return s;
  }

  window.__olUsar = {
    foto: foto, control: control, campo: campo, opcion: opcion, leer: leer,
    escuchaElegido: function () { var e = R.elegido; return e ? { escucha: escuchaCampo(e) || escucha(e), propia: false, campo: true } : null; },
    antesDeActuar: antesDeActuar, tapadoAhora: function () { return R.elegido ? tapado(R.elegido) : ""; },
    ancla: ancla, sacar: sacar,
    hechos: function () { var h = R.hechos.slice(); R.hechos.length = 0; return h; },
    webgl: function () { return R.webgl; },
    // El bloque que se captura (Puppeteer lo lleva a la vista y lo recorta).
    bloqueDe: function (q0) { var b = bloque(q0); return b ? b.el : null; },
    elegido: function () { return R.elegido; },
    vaciarCampo: function () { var e = R.elegido; if (!e) return; e.focus(); e.value = ""; e.dispatchEvent(new Event("input", { bubbles: true })); },
    ponerValor: function (v) {
      var e = R.elegido; if (!e) return;
      var set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(e, v);
      e.dispatchEvent(new Event("input", { bubbles: true }));
      e.dispatchEvent(new Event("change", { bubbles: true }));
    },
    pulsarPorScript: function () { if (R.elegido) R.elegido.click(); }
  };
})();
`;

// ─── Lo que corre en el servidor ────────────────────────────────────────────

interface Foto {
  readonly lineas: string[];
  readonly guardado: Record<string, string>;
  readonly url: string;
}

const US = (expr: string) => `window.__olUsar.${expr}`;

async function foto(page: Page): Promise<Foto> {
  return (await page.evaluate(US("foto()"))) as Foto;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = (s: string, max = 140) => {
  const t = s.replace(/\s+/g, " ").trim();
  return `«${t.length > max ? `${t.slice(0, max)}…` : t}»`;
};

/** La forma de una línea con las cifras fuera: un contador que va de 1.200 a
 *  1.350 es la MISMA línea moviéndose. */
function forma(linea: string): string {
  return linea.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\d+([.,]\d+)*/g, "#").replace(/\s+/g, " ").trim();
}

/** Espera a que la página se quede quieta y apunta lo que cambió SIN que nadie
 *  tocara nada: eso no es efecto de la acción que viene. */
async function quieta(page: Page, cambiantes: Set<string>): Promise<Foto> {
  let prev = await foto(page);
  const hasta = Date.now() + QUIETUD_MS;
  let iguales = 0;
  while (Date.now() < hasta && iguales < 2) {
    await dormir(200);
    const f = await foto(page);
    if (f.lineas.join("\n") === prev.lineas.join("\n")) iguales++;
    else {
      iguales = 0;
      for (const l of diferencia(prev.lineas, f.lineas).flatMap((c) => [...c.quita, ...c.pone])) cambiantes.add(forma(l));
    }
    prev = f;
  }
  return prev;
}

interface Cambio {
  readonly quita: string[];
  readonly pone: string[];
}

/** Diferencia por líneas (LCS), en bloques de «quita» y «pone» contiguos. */
export function diferencia(a: readonly string[], b: readonly string[]): Cambio[] {
  // Lo común por delante y por detrás fuera: casi siempre cambia un trozo.
  let ini = 0;
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++;
  let finA = a.length;
  let finB = b.length;
  while (finA > ini && finB > ini && a[finA - 1] === b[finB - 1]) {
    finA--;
    finB--;
  }
  const x = a.slice(ini, finA);
  const y = b.slice(ini, finB);
  if (x.length === 0 && y.length === 0) return [];
  if (x.length * y.length > 400_000) return [{ quita: [...x], pone: [...y] }];
  const m = x.length;
  const n = y.length;
  const t: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) t[i]![j] = x[i] === y[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
  const cambios: Cambio[] = [];
  let actual: { quita: string[]; pone: string[] } | null = null;
  const cerrar = () => {
    if (actual && (actual.quita.length || actual.pone.length)) cambios.push(actual);
    actual = null;
  };
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && x[i] === y[j]) {
      cerrar();
      i++;
      j++;
    } else if (j < n && (i >= m || t[i]![j + 1]! >= t[i + 1]![j]!)) {
      actual ??= { quita: [], pone: [] };
      actual.pone.push(y[j]!);
      j++;
    } else {
      actual ??= { quita: [], pone: [] };
      actual.quita.push(x[i]!);
      i++;
    }
  }
  cerrar();
  return cambios;
}

const MAX_CAMBIOS = 10;

interface CambioVisto {
  readonly texto: string;
  /** Cambia también sin tocar nada: no es efecto del paso. */
  readonly solo: boolean;
}

/**
 * Lo que cambió entre dos fotos, en líneas para el informe. Vacío = nada.
 *
 * `propio` dice qué línea es el efecto DIRECTO de la acción —el campo en el
 * que se tecleó, la casilla que se marcó—: eso ya lo dice el paso, y contarlo
 * como cambio taparía que no pasó nada más (la calculadora del 25/09: la barra
 * se movía y el precio no).
 */
function contarCambios(
  antes: Foto,
  despues: Foto,
  cambiantes: ReadonlySet<string>,
  propio: (linea: string) => boolean = () => false,
): CambioVisto[] {
  const out: CambioVisto[] = [];
  const solo = (l: string) => cambiantes.has(forma(l));
  const marca = (l: string) => (solo(l) ? " (this also changes by itself, without touching anything)" : "");
  for (const c of diferencia(antes.lineas, despues.lineas)) {
    const quita = c.quita.filter((l) => !propio(l));
    const pone = c.pone.filter((l) => !propio(l));
    const pares = Math.min(quita.length, pone.length);
    for (let k = 0; k < pares; k++) out.push({ texto: `${q(quita[k]!)} → ${q(pone[k]!)}${marca(pone[k]!)}`, solo: solo(pone[k]!) });
    for (const l of quita.slice(pares)) out.push({ texto: `no longer there: ${q(l)}${marca(l)}`, solo: solo(l) });
    for (const l of pone.slice(pares)) out.push({ texto: `appeared: ${q(l)}${marca(l)}`, solo: solo(l) });
  }
  const vistos: CambioVisto[] =
    out.length > MAX_CAMBIOS
      ? [...out.slice(0, MAX_CAMBIOS), { texto: `(and ${out.length - MAX_CAMBIOS} more change(s) in what is shown)`, solo: out.slice(MAX_CAMBIOS).every((c) => c.solo) }]
      : out;
  const claves = new Set([...Object.keys(antes.guardado), ...Object.keys(despues.guardado)]);
  for (const k of claves) {
    const a = antes.guardado[k];
    const b = despues.guardado[k];
    if (a === b) continue;
    vistos.push({ texto: b === undefined ? `deleted from the browser ${q(k, 60)}` : `saved in the browser ${q(k, 60)} = ${q(b, 160)}`, solo: false });
  }
  return vistos;
}

function decodificada(u: string): string {
  try {
    return decodeURIComponent(u.replace(/\+/g, " "));
  } catch {
    return u;
  }
}

function describirPaso(p: PasoDeUso): string {
  if ("click" in p) return `click ${q(p.click)}${p.within ? ` within ${q(p.within)}` : ""}`;
  if ("type" in p) return `type ${q(p.type)} into ${q(p.into)}`;
  if ("choose" in p) return `choose ${q(p.choose)}${p.within ? ` within ${q(p.within)}` : ""}`;
  if ("reload" in p) return "reload";
  if ("screenshot" in p) return isScreen(p.screenshot) ? "screenshot of the screen" : `screenshot of ${q(p.screenshot)}`;
  if ("eval" in p) return "eval";
  return `read ${q(p.read)}`;
}

const isScreen = (target: string) => target.trim().toLowerCase() === "screen";

// ─── Los ojos como Claude Code (14/10) ──────────────────────────────────────
//
// La captura y `eval` son pasos de la MISMA visita, como en `chromium-cli`
// (`nav` → actuar → `screenshot` → `console --errors`): lo que se ve después de
// «Click to play» sólo existe después del clic. La captura vuelve al modelo como
// imagen —sin nadie que la describa por él— y `eval` le deja inspeccionar lo
// que no se lee (un canvas, el estado de un juego) sin meter código de
// depuración en la app, que es lo que tuvo que hacer en el turno del Minecraft.

/** Un `eval` que no vuelve en este tiempo tiene la página colgada: la visita para. */
const EVAL_MS = 10_000;
/** Lo que se devuelve de un valor: una inspección, no un volcado. */
const MAX_EVAL_RESULT = 2_000;

/** Dos fotogramas: lo que la página acaba de pedir ya está pintado (un canvas, una
 *  transición que empezó). Acotado: una página con el hilo ocupado no espera aquí. */
async function twoFrames(page: Page): Promise<void> {
  await Promise.race([
    page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))").catch(() => undefined),
    dormir(1_500),
  ]);
}

async function takeScreenshot(page: Page, target: string, images: InlineImage[]): Promise<string> {
  await twoFrames(page);
  let dataBase64: string;
  if (isScreen(target)) {
    dataBase64 = (await page.screenshot({ type: "jpeg", quality: 80, encoding: "base64" })) as string;
  } else {
    const handle = (await page.evaluateHandle(US(`bloqueDe(${JSON.stringify(target)})`))).asElement() as ElementHandle<Element> | null;
    if (!handle) return `${q(target)} isn't shown on the page.`;
    await handle.scrollIntoView().catch(() => undefined);
    await twoFrames(page);
    dataBase64 = (await handle.screenshot({ type: "jpeg", quality: 80, encoding: "base64" })) as string;
  }
  images.push({ mimeType: "image/jpeg", dataBase64 });
  return `attached below as image ${images.length}${isScreen(target) ? " (what a visitor sees on a 1280×900 desktop screen)" : ""}.`;
}

/** ¿Es una expresión? Se compila sin correr (`vm.Script` no ejecuta): si lo es, se
 *  devuelve su valor, como en una consola; si no, son sentencias con su `return`. */
function isExpression(code: string): boolean {
  try {
    new Script(`(async () => (${code}\n))`);
    return true;
  } catch {
    return false;
  }
}

async function runEval(page: Page, code: string): Promise<{ text: string; stuck: boolean }> {
  const body = isExpression(code) ? `return (${code}\n);` : code;
  const script = `(async () => {
  const show = (v) => {
    if (v === undefined) return "undefined";
    if (typeof v === "function") return "a function";
    if (typeof Element !== "undefined" && v instanceof Element) return "<" + v.tagName.toLowerCase() + ">";
    try { const j = JSON.stringify(v); return j === undefined ? String(v) : j; } catch (e) { return String(v); }
  };
  try {
    const v = await (async () => {
${body}
    })();
    return { ok: true, text: show(v) };
  } catch (e) {
    return { ok: false, text: (e && e.name ? e.name + ": " : "") + (e && e.message !== undefined ? e.message : String(e)) };
  }
})()`;
  const r = (await Promise.race([
    page.evaluate(script).catch((e: unknown) => ({ ok: false, text: e instanceof Error ? e.message : String(e) })),
    dormir(EVAL_MS).then(() => null),
  ])) as { ok: boolean; text: string } | null;
  if (!r) return { text: `didn't return in ${EVAL_MS / 1000} s: the page is busy (an endless loop?), so the visit stops here.`, stuck: true };
  const text = r.text.length > MAX_EVAL_RESULT ? `${r.text.slice(0, MAX_EVAL_RESULT)}… (cut at ${MAX_EVAL_RESULT} characters)` : r.text;
  return { text: r.ok ? text : `threw ${text}`, stuck: false };
}

/** Lo que hizo el navegador por la página en el paso (el preludio lo apunta). */
const BROWSER_FACTS: Record<string, string> = {
  "lock-on": "the page took the pointer (pointer lock is on): the mouse now moves the view, as for a visitor who clicked.",
  "lock-off": "the page released the pointer (pointer lock is off).",
  "lock-error": "the page asked for the pointer (pointer lock) and the browser refused it.",
  "fullscreen-on": "the page went fullscreen.",
  "fullscreen-off": "the page left fullscreen.",
  "fullscreen-error": "the page asked for fullscreen and the browser refused it.",
};

export interface VisitaParams {
  readonly html: string;
  readonly pasos: readonly PasoDeUso[];
  /** El fichero, para el informe (`/index.html`). */
  readonly ruta: string;
  /** El contexto con el que se hornea: la página que el dueño ve en el lienzo. */
  readonly vista?: ContextoDeVista | null;
  /** Entrar como un usuario de la página (lib/backend/auth/visit-session.ts):
   *  la sesión de supabase-js, guardada en su clave antes de que corra la página. */
  readonly signedInAs?: SignedInAs | null;
  /** La pestaña del turno: con ella la visita sigue donde la dejó la anterior
   *  (`newBrowserTabHolder`, en la sesión). Sin ella, abre y cierra la suya. */
  readonly tab?: BrowserTabHolder;
  /** Empezar de cero en la pestaña, como un visitante nuevo. */
  readonly newVisit?: boolean;
}

export interface SignedInAs {
  readonly email: string;
  readonly storageKey: string;
  readonly session: Record<string, unknown>;
}

/** Guarda la sesión en el `localStorage` del documento de arriba, como si el
 *  usuario hubiera entrado antes. Sólo en la PRIMERA carga: se retira tras ella,
 *  para que una página que cierra la sesión no la recupere al recargar. */
const storeSessionScript = (s: SignedInAs) => `
(function () {
  if (window.top !== window) return;
  try { localStorage.setItem(${JSON.stringify(s.storageKey)}, ${JSON.stringify(JSON.stringify(s.session))}); } catch (x) {}
})();`;

export interface VisitaInternals {
  readonly lanzar?: () => Promise<Browser>;
  readonly plazoMs?: number;
}

interface Previo {
  readonly escucha: boolean;
  readonly propia: boolean;
  /** Es un campo (se teclea o se elige), no algo que se pulsa. */
  readonly campo?: boolean;
}

/** Las líneas de la foto que son el efecto DIRECTO de la acción. */
const lineaDelCampo = (etiqueta: string) => (l: string) => l.startsWith(`[field «${etiqueta}»:`);
const lineaDeCasilla = (l: string) => l.startsWith("[option «") || l.startsWith("[checkbox «");

type Actuacion =
  | { readonly ok: false; readonly hecho: string }
  | {
      readonly ok: true;
      readonly hecho: string;
      readonly antes: Foto;
      readonly detalle: string[];
      /** Del control: ¿alguien lo escucha? ¿hace algo el navegador solo? */
      readonly previo: Previo | null;
      /** Qué líneas de la foto son el efecto directo de la acción. */
      readonly propio?: (linea: string) => boolean;
      /** Lo que va al FINAL del paso, detrás de lo que pasó. */
      readonly alFinal?: string[];
    };

interface ResultadoControl {
  readonly n: number;
  readonly que?: string;
  readonly tipo?: string;
  readonly texto?: string;
  readonly href?: string;
  readonly etiqueta?: string;
  readonly pistas?: string[];
  readonly ocultos?: number;
  readonly hay?: string[];
  readonly yaEstaba?: boolean;
  /** Otros controles que también dicen el texto y no se pulsaron. */
  readonly otros?: string[];
  readonly masOtros?: number;
}

interface ResultadoCampo {
  readonly n: number;
  readonly tipo?: string;
  readonly etiqueta?: string;
  readonly etiquetas?: string[];
  readonly selects?: number;
  readonly hay?: string[];
}

/** Los campos que no se teclean: se les pone el valor, como hace el navegador
 *  cuando un visitante mueve la barra o elige en el calendario. */
const SIN_TECLEAR = new Set(["range", "date", "time", "month", "week", "datetime-local", "color"]);

async function actuar(
  page: Page,
  paso: Exclude<PasoDeUso, { readonly read: string } | { readonly screenshot: string } | { readonly eval: string }>,
  cambiantes: Set<string>,
): Promise<Actuacion> {
  if ("reload" in paso) {
    const antes = await foto(page);
    await page.reload({ waitUntil: "load", timeout: 20_000 });
    return {
      ok: true,
      hecho: "I reloaded the page (what was saved in the browser and in this visit's stores is kept).",
      antes,
      detalle: [],
      previo: null,
    };
  }

  if ("type" in paso) {
    const r = (await page.evaluate(US(`campo(${JSON.stringify(paso.into)})`))) as ResultadoCampo;
    if (r.n !== 1) {
      return {
        ok: false,
        hecho:
          r.n > 1
            ? `couldn't: there are ${r.n} fields that match ${q(paso.into)}: ${(r.etiquetas ?? []).map((e) => q(e, 50)).join(", ")}. Say which one with a more exact text from its label.`
            : r.selects
              ? `couldn't: ${q(paso.into)} is a dropdown; it is chosen with \`choose\`, not typed into.`
              : `couldn't: there is no visible field with the label, placeholder or name ${q(paso.into)}.${
                  (r.hay ?? []).length ? ` The fields there are: ${r.hay!.map((e) => q(e, 50)).join(", ")}.` : " The page has no visible field."
                }`,
      };
    }
    const previo = (await page.evaluate(US("antesDeActuar()"))) as Previo | null;
    const antes = await quieta(page, cambiantes);
    const propio = lineaDelCampo(r.etiqueta || r.tipo || "input");
    const etiqueta = q(r.etiqueta || paso.into);
    if (SIN_TECLEAR.has(r.tipo ?? "")) {
      await page.evaluate(US(`ponerValor(${JSON.stringify(paso.type)})`));
      const hecho = r.tipo === "range" ? `I moved the slider ${etiqueta} to ${q(paso.type)}.` : `I set ${q(paso.type)} in the field ${etiqueta} (<input type=${r.tipo}>).`;
      return { ok: true, hecho, antes, detalle: [], previo, propio };
    }
    await page.evaluate(US("vaciarCampo()"));
    await page.keyboard.type(paso.type, { delay: 10 });
    await page.keyboard.press("Tab");
    return { ok: true, hecho: `I typed ${q(paso.type)} into the field ${etiqueta} and left the field.`, antes, detalle: [], previo, propio };
  }

  const esElige = "choose" in paso;
  const texto = "choose" in paso ? paso.choose : paso.click;
  const dentro = paso.within ?? "";
  // `choose` sobre un desplegable o una casilla actúa DENTRO de la búsqueda, así
  // que la foto de antes va primero.
  let antes: Foto | null = esElige ? await quieta(page, cambiantes) : null;
  const expr = `${esElige ? "opcion" : "control"}(${JSON.stringify(texto)}, ${JSON.stringify(dentro)})`;
  const r = (await page.evaluate(US(expr))) as ResultadoControl;
  if (r.n !== 1) {
    let hecho: string;
    if (r.n > 1) {
      const cuales = r.que === "desplegable" ? "dropdowns" : r.que === "casilla" ? "checkboxes" : "controls";
      const pistas = (r.pistas ?? []).filter(Boolean);
      hecho = `couldn't: there are ${r.n} ${cuales} that say ${q(texto)}${dentro ? ` within ${q(dentro)}` : ""}. Say which one with \`within\` (a text from its block)${pistas.length ? `: ${pistas.map((t) => q(t, 50)).join(", ")}` : ""}.`;
    } else if (dentro) {
      hecho = `couldn't: there is no ${esElige ? "option" : "control"} ${q(texto)} inside a block that says ${q(dentro)}.`;
    } else {
      hecho = `couldn't: there is no ${esElige ? "option (not in a dropdown, nor a checkbox, nor a button)" : "visible control"} that says ${q(texto)}.`;
      if (r.ocultos) hecho += ` ${r.ocultos} control(s) say it but can't be seen: hidden.`;
      if ((r.hay ?? []).length) hecho += ` What can be pressed: ${r.hay!.map((t) => q(t, 40)).join(", ")}.`;
    }
    return { ok: false, hecho };
  }
  if (r.que === "desplegable" || r.que === "radio" || r.que === "casilla") {
    const previo = (await page.evaluate(US("escuchaElegido()"))) as Previo | null;
    if (r.que === "desplegable") {
      const hecho = `I chose ${q(r.texto ?? texto)} in the dropdown ${q(r.etiqueta ?? "")}.`;
      return { ok: true, hecho, antes: antes!, detalle: [], previo, propio: lineaDelCampo(r.etiqueta ?? "") };
    }
    const hecho = r.yaEstaba
      ? `${q(r.texto ?? texto)} was already checked; I changed nothing.`
      : `I checked ${r.que === "radio" ? "the option" : "the checkbox"} ${q(r.texto ?? texto)}.`;
    return { ok: true, hecho, antes: antes!, detalle: [], previo: r.yaEstaba ? null : previo, propio: lineaDeCasilla };
  }

  // Un control que se PULSA: se lleva a la vista, se deja que se quede quieto
  // (lo que se dispara al verse no es efecto del clic) y se pulsa con el ratón,
  // como un visitante.
  const previo = (await page.evaluate(US("antesDeActuar()"))) as Previo | null;
  antes = await quieta(page, cambiantes);
  const detalle: string[] = [];
  const tapa = (await page.evaluate(US("tapadoAhora()"))) as string;
  const handle = (await page.evaluateHandle(US("elegido()"))).asElement() as ElementHandle<Element> | null;
  let porScript = false;
  try {
    if (!handle) throw new Error("sin elemento");
    await handle.click({ delay: 20 });
  } catch {
    porScript = true;
    await page.evaluate(US("pulsarPorScript()")).catch(() => undefined);
  }
  const hecho = `I pressed ${r.que === "texto" ? "the text" : `a <${r.tipo}>`} ${q(r.texto ?? texto)}.`;
  if (tapa) detalle.push(`(note: on top of that control there is another element, ${q(tapa, 60)}: a visitor's click lands on that one, and that is where mine landed.)`);
  if (porScript) detalle.push("(note: it couldn't be pressed with the mouse —no size or off screen—, so I pressed it by script.)");
  const alFinal: string[] = [];
  if ((r.otros ?? []).length) {
    alFinal.push(
      `(note: other controls also say ${q(texto)} and I didn't press them: ${r.otros!.map((t) => q(t, 50)).join(", ")}${r.masOtros ? ` and ${r.masOtros} more` : ""}. To try one, name it in full or use within.)`,
    );
  }
  if (r.href) {
    const ancla = (await page.evaluate(US(`ancla(${JSON.stringify(r.href)})`))) as { id: string; existe: boolean } | null;
    if (ancla) {
      detalle.push(
        ancla.existe
          ? `it is a link to ${q(`#${ancla.id}`)}: it takes you to that part of this same page.`
          : `(note: it is a link to ${q(`#${ancla.id}`)} and there is no element on the page with id=${q(ancla.id)}.)`,
      );
    }
  }
  return { ok: true, hecho, antes, detalle, previo, alFinal };
}

/** `read`: lo pintado por el JS puede llegar después de la carga, así que se
 *  espera un poco a que aparezca antes de decir que no está. */
async function leerPaso(page: Page, texto: string): Promise<string> {
  let r: { encontrado: boolean; texto?: string; campos?: string[]; sitios?: number } = { encontrado: false };
  for (let t = 0; t < 6; t++) {
    r = (await page.evaluate(US(`leer(${JSON.stringify(texto)})`))) as typeof r;
    if (r.encontrado) break;
    await dormir(500);
  }
  if (!r.encontrado) return `${q(texto)} isn't shown on the page.`;
  const campos = (r.campos ?? []).length ? ` ${r.campos!.join(" ")}` : "";
  const sitios = (r.sitios ?? 1) > 1 ? ` (it appears in ${r.sitios} places; this is the first)` : "";
  return `it reads: ${q(r.texto ?? "", 600)}${campos}${sitios}`;
}

interface Eventos {
  fueraPorRed: string[];
  dialogos: string[];
  otrasApi: string[];
}

/** Una pestaña abierta: el navegador, su página y la versión del documento que
 *  enseña. Lo que la página escucha se registra UNA vez, al abrirla. */
interface OpenTab {
  readonly browser: Browser;
  readonly page: Page;
  readonly origen: Awaited<ReturnType<typeof origenDeMedida>>;
  readonly ev: Eventos;
  /** Los errores de JavaScript desde que se abrió; cada visita cuenta los suyos. */
  readonly errores: string[];
  /** Lo que cambia solo, aprendido en esta versión de la página. */
  readonly cambiantes: Set<string>;
  traducir: Traductor | undefined;
  doc: DocumentoServido | null;
  opciones: Awaited<ReturnType<typeof carpetaDeLaVista>>;
  /** La versión que enseña: el documento y sus ficheros, sin la pantalla. */
  version: string;
  /** Lo que se abrió (el documento y la pantalla de una app). */
  inicio: string;
  enUnaApp: boolean;
  sessionScript: { identifier: string } | null;
}

/** Una pestaña que nadie usa en este tiempo se cierra sola (el turno la cierra antes). */
const TAB_IDLE_MS = 3 * 60_000;

function versionOf(html: string, opciones: OpenTab["opciones"]): string {
  const h = createHash("sha256");
  h.update(html);
  h.update(`\0${opciones?.pagina ?? ""}`);
  const files = opciones?.files ?? {};
  for (const k of Object.keys(files).sort()) h.update(`\0${k}\0${files[k]}`);
  return h.digest("hex");
}

async function openTab(internals: VisitaInternals, signedInAs: SignedInAs | null | undefined): Promise<OpenTab> {
  const browser = await (internals.lanzar ?? lanzarChromium)();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const origen = await origenDeMedida();
    const tab: OpenTab = {
      browser,
      page,
      origen,
      ev: { fueraPorRed: [], dialogos: [], otrasApi: [] },
      errores: [],
      cambiantes: new Set(),
      traducir: undefined,
      doc: null,
      opciones: undefined,
      version: "",
      inicio: "",
      enUnaApp: false,
      sessionScript: null,
    };
    await installSubresourceSsrfGuard(page, {
      allowOrigins: [origen.origin],
      alSalir: (u) => tab.ev.fueraPorRed.push(u),
    });
    await page.evaluateOnNewDocument(PRELUDIO_DE_USO);
    tab.sessionScript = signedInAs ? await page.evaluateOnNewDocument(storeSessionScript(signedInAs)) : null;
    page.on("dialog", (d) => {
      const cual = d.type() === "confirm" ? "a question (confirm)" : d.type() === "prompt" ? "a prompt" : "an alert";
      tab.ev.dialogos.push(`${cual} came up saying ${q(d.message(), 120)}; I accepted it.`);
      void d.accept().catch(() => undefined);
    });
    // Con DÓNDE nació, si la traza lo dice: en una app, su fichero de /src; y si
    // va empaquetada (plan 02), por su mapa, que llega con la carpeta.
    page.on("pageerror", (e) => tab.errores.push(textoDelError(e, 200, tab.traducir)));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      // Un subrecurso relativo que aquí no se sirve no es un error de la página.
      if (/^Failed to load resource/i.test(t)) return;
      tab.errores.push(t.slice(0, 200));
    });
    page.on("response", (r) => {
      try {
        const u = new URL(r.url());
        if (u.host === origen.origin && u.pathname.startsWith("/api/")) {
          tab.ev.otrasApi.push(`${r.request().method()} ${u.pathname}`);
        }
      } catch {
        /* no es una URL: nada que apuntar */
      }
    });
    return tab;
  } catch (e) {
    await browser.close().catch(() => undefined);
    throw e;
  }
}

async function closeOpenTab(tab: OpenTab): Promise<void> {
  tab.doc?.soltar();
  tab.doc = null;
  await tab.browser.close().catch(() => undefined);
}

/** Carga en la pestaña ESTA versión del documento (la primera vez, o porque los
 *  ficheros cambiaron): mismo origen, así que lo que la página guardó se queda. */
async function loadVersion(tab: OpenTab, html: string, opciones: OpenTab["opciones"], version: string, enUnaApp: boolean): Promise<void> {
  const anterior = tab.doc;
  // LA CARPETA (pieza 9 de Len 2.5): los ficheros de la vista se contestan
  // desde memoria (el guardia), y el documento vive en la ruta de su página.
  tab.traducir = traductorDeMapas(opciones?.sourceMaps);
  tab.doc = tab.origen.publicar(html, opciones ?? undefined);
  tab.opciones = opciones;
  tab.version = version;
  tab.enUnaApp = enUnaApp;
  // UNA APP: la visita empieza en la pantalla pedida (`#/ventas`) y espera a
  // que la app pida sus datos —tras cargar y tras cada paso— (H12).
  tab.inicio = tab.doc.url + (opciones?.hash ?? "");
  tab.cambiantes.clear();
  await tab.page.goto(tab.inicio, { waitUntil: "load", timeout: 20_000 });
  await esperarALaRed(tab.page, opciones ?? undefined);
  anterior?.soltar();
  if (tab.sessionScript) {
    await tab.page.removeScriptToEvaluateOnNewDocument(tab.sessionScript.identifier);
    tab.sessionScript = null;
  }
}

/**
 * Una visita a la página. Nunca lanza por algo de la página: lo que no se pudo
 * hacer va al informe. Lanza sólo si no hay navegador — y quien llama dice «no
 * se pudo abrir», que no es «funciona» ni «no funciona».
 *
 * Con `tab` (la pestaña del turno), la visita sigue donde la dejó la anterior,
 * como la sesión de navegador de Claude Code; si los ficheros cambiaron, la
 * página se carga otra vez con la versión nueva —lo que haría el HMR de un
 * servidor de desarrollo— y se dice. Sin `tab` (y con `signedInAs`, que abre y
 * cierra su sesión del backend), cada visita abre y cierra la suya.
 */
export async function usarPagina(p: VisitaParams, internals: VisitaInternals = {}): Promise<{ informe: string; images?: InlineImage[] }> {
  if (!p.tab || p.signedInAs) {
    const tab = await openTab(internals, p.signedInAs);
    try {
      const { informe, images } = await visitTab(tab, p, internals, { persistent: false, recovered: false });
      return { informe, ...(images ? { images } : {}) };
    } finally {
      await closeOpenTab(tab);
    }
  }
  const holder = p.tab;
  const turn = holder.queue.then(() => visitInHolder(holder, p, internals));
  holder.queue = turn.then(
    () => undefined,
    () => undefined,
  );
  return turn;
}

async function visitInHolder(holder: BrowserTabHolder, p: VisitaParams, internals: VisitaInternals): Promise<{ informe: string; images?: InlineImage[] }> {
  if (holder.timer) clearTimeout(holder.timer);
  holder.timer = null;
  let tab = holder.current as OpenTab | null;
  let recovered = false;
  if (tab && (!tab.browser.connected || tab.page.isClosed())) {
    await closeOpenTab(tab);
    holder.current = tab = null;
    recovered = true;
  }
  if (tab && p.newVisit) {
    await closeOpenTab(tab);
    holder.current = tab = null;
  }
  if (!tab) holder.current = tab = await openTab(internals, null);
  try {
    const r = await visitTab(tab, p, internals, { persistent: true, recovered });
    // Un `eval` que no volvió deja la página colgada: la pestaña no sirve más.
    if (r.stuck) {
      holder.current = null;
      await closeOpenTab(tab);
    }
    return { informe: r.informe, ...(r.images ? { images: r.images } : {}) };
  } catch (e) {
    // No se pudo abrir o cargar: la pestaña no queda a medias para la siguiente.
    holder.current = null;
    await closeOpenTab(tab);
    throw e;
  } finally {
    if (holder.current) {
      holder.timer = setTimeout(() => void closeBrowserTab(holder), TAB_IDLE_MS);
      holder.timer.unref?.();
    }
  }
}

/** Al acabar el turno: la pestaña se cierra y la sesión la olvida. */
export async function closeBrowserTab(holder: BrowserTabHolder | undefined): Promise<void> {
  if (!holder) return;
  if (holder.timer) clearTimeout(holder.timer);
  holder.timer = null;
  const tab = holder.current as OpenTab | null;
  holder.current = null;
  if (tab) await closeOpenTab(tab);
}

async function visitTab(
  tab: OpenTab,
  p: VisitaParams,
  internals: VisitaInternals,
  o: { readonly persistent: boolean; readonly recovered: boolean },
): Promise<{ informe: string; images?: InlineImage[]; stuck: boolean }> {
  const html = documentoMedible(p.html, p.vista ?? null);
  const plazoMs = internals.plazoMs ?? PLAZO_DE_LA_VISITA_MS;
  const plazo = Date.now() + plazoMs;
  const opciones = await carpetaDeLaVista(p.vista);
  const version = versionOf(html, opciones);
  const enUnaApp = Boolean(p.vista?.app);
  const inicio = (doc: DocumentoServido) => doc.url + (opciones?.hash ?? "");

  // Qué visita es: la primera de la pestaña, la misma página tal cual, otra
  // pantalla de la misma versión, o la versión nueva tras cambiar los ficheros.
  let como: "nueva" | "igual" | "otra" | "recargada";
  if (!tab.doc) {
    como = "nueva";
    await loadVersion(tab, html, opciones, version, enUnaApp);
  } else if (tab.version !== version) {
    como = "recargada";
    await loadVersion(tab, html, opciones, version, enUnaApp);
  } else if (inicio(tab.doc) !== tab.inicio) {
    como = "otra";
    tab.inicio = inicio(tab.doc);
    tab.cambiantes.clear();
    await tab.page.goto(tab.inicio, { waitUntil: "load", timeout: 20_000 });
    await esperarALaRed(tab.page, opciones ?? undefined);
  } else {
    como = "igual";
  }
  const page = tab.page;
  const doc = tab.doc!;
  // Lo que pasó ENTRE visitas no es de esta: se empieza con la cuenta a cero.
  const desdeError = como === "nueva" ? 0 : tab.errores.length;
  if (como !== "nueva") {
    tab.ev.fueraPorRed.length = 0;
    tab.ev.dialogos.length = 0;
    tab.ev.otrasApi.length = 0;
    await page.evaluate(US("hechos()")).catch(() => undefined);
    await page.evaluate(US("sacar()")).catch(() => undefined);
  }

  const visitor = p.signedInAs
    ? `signed in as ${p.signedInAs.email} (a real session of the page's backend, closed when the visit ends; nothing else saved from before)`
    : "as a new visitor (with nothing saved from before)";
  const encabezadoDeLaVisita = {
    nueva: o.persistent
      ? `Visit to ${p.ruta} ${visitor}, in a desktop browser tab that stays open: your next use_page in this turn carries on from where this one leaves it.`
      : `Visit to ${p.ruta} ${visitor}, in a desktop browser.`,
    igual: `Same tab as your last call, still on ${p.ruta}: the files didn't change, so the page is as you left it (what is on screen and what it saved).`,
    otra: `Same tab, now on ${p.ruta}: the files didn't change, so what the page saved in the browser is kept.`,
    recargada: `Same tab, ${p.ruta} loaded again with the files as they are now (they changed since your last call): what the page saved in the browser is kept, what was on screen is not.`,
  }[como];
  const lineas: string[] = [`${encabezadoDeLaVisita} ${TEXTO_DE_LA_PAGINA_ES_DATO}`];
  if (o.recovered) lineas.push("(note: the tab from your last call had stopped responding, so this is a new visit.)");
  const notas = new Set<string>();
  const images: InlineImage[] = [];
  const ev = tab.ev;
  const cambiantes = tab.cambiantes;
  const sinHash = (u: string) => u.split("#")[0];
  let stuck = false;

  let hechos = 0;
  for (const [i, paso] of p.pasos.entries()) {
    const encabezado = `${i + 1}. ${describirPaso(paso)}`;
    hechos = i + 1;
    if (Date.now() > plazo) {
      lineas.push(`${encabezado} → not done: the visit went over ${Math.round(plazoMs / 1000)} s and was cut here.`);
      break;
    }
    if ("read" in paso) {
      lineas.push(`${encabezado} → ${await leerPaso(page, paso.read)}`);
      continue;
    }
    if ("screenshot" in paso) {
      lineas.push(`${encabezado} → ${await takeScreenshot(page, paso.screenshot, images).catch(() => "the screenshot couldn't be taken this time.")}`);
      continue;
    }
    if ("eval" in paso) {
      const r = await runEval(page, paso.eval);
      lineas.push(`${encabezado} → ${r.text}`);
      if (r.stuck) {
        stuck = true;
        break;
      }
      continue;
    }
    const accion = await actuar(page, paso, cambiantes);
    if (!accion.ok) {
      lineas.push(`${encabezado} → ${accion.hecho}`);
      break;
    }
    await dormir(VENTANA_MS);
    await esperarALaRed(page, tab.opciones ?? undefined);

    const detalle = [...accion.detalle];
    // ¿Se fue la página? Por algo que el preludio no vio o por un `location`
    // del script. Se apunta y se vuelve, porque los pasos siguen.
    let seFue = "";
    if (sinHash(page.url()) !== sinHash(doc.url)) {
      seFue = page.url();
      await page.goto(tab.inicio, { waitUntil: "load", timeout: 20_000 }).catch(() => undefined);
      await esperarALaRed(page, tab.opciones ?? undefined);
    }
    const despues = await foto(page);
    const cambios = seFue ? [] : contarCambios(accion.antes, despues, cambiantes, accion.propio);
    const propios = cambios.filter((c) => !c.solo);
    const sale = (await page.evaluate(US("sacar()")).catch(() => ({ salidas: [], envios: [] }))) as {
      salidas: string[];
      envios: { cancelado: boolean; campos: [string, string][]; porScript?: boolean }[];
    };
    const salidas = [...new Set([...sale.salidas, ...ev.fueraPorRed].map(decodificada))];
    ev.fueraPorRed.length = 0;
    for (const s of salidas) {
      detalle.push(
        /^[a-z][a-z0-9+.-]*:/i.test(s)
          ? `it was sending to ${q(s, 300)} (not opened).`
          : `it was sending to ${q(s, 200)}, another page of the site (not opened in this visit).`,
      );
    }
    if (seFue) detalle.push("the page tried to leave, so I loaded it again to carry on: what wasn't saved was lost.");
    for (const e of sale.envios) {
      const campos = e.campos.length ? e.campos.map(([k, v]) => `${k}=${q(v, 60)}`).join(", ") : "no field with a name";
      if (e.cancelado && tab.enUnaApp) {
        // En una app, TODO formulario lo maneja su código con
        // `preventDefault`: es lo normal, no una entrega que se pierde.
        detalle.push(`the app handled the form submission in its code. It carried: ${campos}.`);
      } else if (e.cancelado) {
        detalle.push(`the page's script CANCELED the form submission (preventDefault). It carried: ${campos}.`);
        notas.add(
          "(note: a form whose submission the script cancels doesn't reach the user on the published page: OpenLen gives it its destination at publish time, and the `preventDefault` cancels that.)",
        );
      } else {
        detalle.push(`sent the form${e.porScript ? " (by script)" : ""} with: ${campos}.`);
        notas.add("(note: in this visit forms aren't sent; once published, what a visitor sends reaches the user's email and their Inbox.)");
      }
    }
    detalle.push(...ev.dialogos);
    ev.dialogos.length = 0;
    const hechosDelNavegador = ((await page.evaluate(US("hechos()")).catch(() => [])) as string[])
      .map((h) => BROWSER_FACTS[h])
      .filter((h): h is string => !!h);
    detalle.push(...hechosDelNavegador);
    for (const a of new Set(ev.otrasApi)) detalle.push(`called \`${a}\`, which only answers on the published page: it couldn't be checked here.`);
    ev.otrasApi.length = 0;

    // Lo que cambia solo no es efecto del paso: si es lo ÚNICO que cambió,
    // el paso no hizo nada, y se dice (el contador que tapaba el botón muerto).
    if (propios.length === 0 && salidas.length === 0 && sale.envios.length === 0 && !seFue && hechosDelNavegador.length === 0) {
      const salvo = cambios.length > 0 ? " (only what changes by itself changed)" : "";
      if ("reload" in paso) detalle.push(`after reloading, the page looks the same as before reloading${salvo}.`);
      else {
        const campo = accion.previo?.campo === true;
        detalle.push(
          campo
            ? `nothing else changed: not what is shown, not the other fields, not what is saved in the browser${salvo}.`
            : `nothing changed: not what is shown, not the fields, not what is saved in the browser${salvo}.`,
        );
        if (accion.previo && !accion.previo.escucha && !accion.previo.propia) {
          detalle.push(
            campo
              ? "(note: neither this field, nor its form, nor the page listens to what is typed or chosen in it: there is nothing behind it.)"
              : "(note: neither this control, nor its containers, nor the page listens to the click, the mouse or the touch, and the browser does nothing of its own when it is pressed: there is nothing behind it.)",
          );
        }
      }
    }
    detalle.push(...(accion.alFinal ?? []));
    lineas.push(`${encabezado} → ${accion.hecho}`);
    for (const c of [...cambios.map((x) => x.texto), ...detalle]) lineas.push(`   · ${c}`);
  }
  if (hechos < p.pasos.length) {
    const faltan = p.pasos.slice(hechos).map((_, k) => String(hechos + k + 1));
    lineas.push(`${faltan.length === 1 ? "Step" : "Steps"} ${faltan.join(", ")} ${faltan.length === 1 ? "wasn't" : "weren't"} done.`);
  }
  // LO QUE ES DEL ENTORNO, dicho (la skill `verify` de Claude Code: decidir
  // si algo es del cambio o del entorno). En el turno del Minecraft Len vio
  // 10 fps y tuvo que adivinar que era el render por software.
  const webgl = stuck ? "" : ((await page.evaluate(US("webgl()")).catch(() => "")) as string);
  if (webgl === "ok") {
    notas.add("(note: this browser draws WebGL in software, without a GPU: what it draws is right, but it runs far slower than for a visitor — frame rates read here aren't a visitor's.)");
  } else if (webgl === "failed") {
    notas.add("(note: the page asked for a WebGL context and this browser couldn't create one: what depends on it isn't drawn here.)");
  }
  if (stuck && o.persistent) notas.add("(note: because the page got stuck, the tab was closed: your next use_page opens it again as a new visitor.)");

  const unicos = [...new Set(tab.errores.slice(desdeError))];
  lineas.push(
    unicos.length === 0
      ? "JavaScript errors in the visit: none."
      : `JavaScript errors in the visit: ${unicos.slice(0, 5).map((e) => q(e, 200)).join("; ")}${unicos.length > 5 ? ` (and ${unicos.length - 5} more)` : ""}.`,
  );
  lineas.push(...notas);
  return { informe: lineas.join("\n"), ...(images.length > 0 ? { images } : {}), stuck };
}
