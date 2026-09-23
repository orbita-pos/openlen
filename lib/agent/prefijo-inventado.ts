// lib/agent/prefijo-inventado.ts — el prefijo de país que nadie dio.
//
// 🔴 EL FALLO QUE CIERRA (H09 de `plans/auditoria-len-vs-claude-code-2026-09-22.md`).
// «pon 33 1234 5678 en el pie» sobre un sitio de Guadalajara y Len escribió
// `tel:+333312345678` en las cuatro páginas —el prefijo de FRANCIA—, y después
// lo confesó en el cierre. El caso aprobó: miraba el texto visible, y
// `enlaces-inventados` acepta a propósito que a un número le sobre el prefijo
// por delante (wa.me lo exige). Sus clientes marcaban a Francia hasta que el
// dueño leyera el aviso (C21, medido el 2026-09-22).
//
// LA VARA ES CLAUDE CODE: sin bloqueo, elige el defecto convencional y lo dice;
// pregunta lo que de verdad es del usuario. Un prefijo de país que nadie dio no
// es un defecto convencional —es un dato del dueño—; conservar las cifras
// dictadas, sí.
//
// Avisa, no rechaza — la misma postura que `enlaces-inventados`, su hermana: el
// prefijo pudo darlo el dueño hace tres turnos, fuera de la ventana. La prueba
// es de PROCEDENCIA: el prefijo tiene que salir del mensaje, del brief o de la
// página que ya había.

export interface PrefijoInventado {
  readonly href: string;
  /** Las cifras que el usuario dio. */
  readonly dictado: string;
  /** Lo que el modelo puso delante. */
  readonly prefijo: string;
}

function hrefsTelefonicos(html: string): string[] {
  const out: string[] = [];
  const re = /\bhref\s*=\s*["']((?:tel:|https?:\/\/(?:api\.)?wa\.me\/|https?:\/\/api\.whatsapp\.com\/send\?phone=)[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1]!);
  return out;
}

function cifrasDelEnlace(href: string): string {
  const sinEsquema = href.replace(/^tel:/i, "").replace(/^https?:\/\/[^/]+\/(?:send\?phone=)?/i, "");
  return sinEsquema.split(/[?&#]/)[0]!.replace(/\D/g, "");
}

/** Los números de 7 cifras o más que aparecen en un texto. */
function numerosDe(texto: string): string[] {
  const out: string[] = [];
  for (const m of texto.matchAll(/\+?\d(?:[\s().-]{0,2}\d)+/g)) {
    const cifras = m[0].replace(/\D/g, "");
    if (cifras.length >= 7) out.push(cifras);
  }
  return out;
}

export function prefijosInventados(args: {
  readonly antes: string;
  readonly despues: string;
  readonly fuentes: readonly (string | null | undefined)[];
}): PrefijoInventado[] {
  const previos = new Set(hrefsTelefonicos(args.antes).map((h) => h.toLowerCase()));
  const texto = [args.antes, ...args.fuentes].filter((t): t is string => typeof t === "string" && t.length > 0).join("\n");
  const numeros = numerosDe(texto);
  const out: PrefijoInventado[] = [];
  const vistos = new Set<string>();
  for (const href of hrefsTelefonicos(args.despues)) {
    if (previos.has(href.toLowerCase())) continue;
    const cifras = cifrasDelEnlace(href);
    if (cifras.length < 7) continue;
    // Tal cual en alguna fuente: el número completo lo dio alguien.
    if (numeros.includes(cifras)) continue;
    // El número dictado más largo que el enlace lleva al FINAL.
    const dictado = numeros.filter((n) => cifras.endsWith(n) && n.length < cifras.length).sort((a, b) => b.length - a.length)[0];
    if (!dictado) continue;
    const prefijo = cifras.slice(0, cifras.length - dictado.length);
    // El prefijo escrito con su «+» en alguna fuente —la página ya usaba ese
    // país, o el dueño lo dijo— basta. Ante la duda, callar.
    if (new RegExp(`\\+\\s*${prefijo}`).test(texto)) continue;
    const clave = `${prefijo}|${dictado}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push({ href, dictado, prefijo });
  }
  return out;
}

/** La frase para el modelo: qué pasó y qué hacer. */
export function avisoPrefijosInventados(lista: readonly PrefijoInventado[]): string {
  const detalle = lista.map((p) => `${p.href} (le pusiste +${p.prefijo} delante de ${p.dictado})`).join(", ");
  return (
    `Pusiste un prefijo de país que nadie te dio: ${detalle}. El país del número es un dato del dueño: si lo adivinas, sus clientes llaman a otro país. ` +
    "En un enlace tel: deja exactamente las cifras que te dieron. Si es un wa.me, que sí necesita el país, PREGÚNTALE al usuario de qué país es el número en vez de elegirlo tú."
  );
}
