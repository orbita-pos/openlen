"use client";

// ─────────────────────────────────────────────────────────────────────────────
// LAS FOTOS QUE CRUZAN DE LA PORTADA AL TALLER.
//
// El héroe manda al taller por una URL (`/new?brief=…&autostart=1`). Una imagen
// no cabe en una URL, y el visitante suele estar SIN SESIÓN: al enviar se abre
// el diálogo de registro, se va a `/register`, vuelve, y sólo entonces genera.
// La foto tiene que sobrevivir ese viaje entero.
//
// POR QUÉ `sessionStorage` Y NO OTRA COSA:
//
//   · `localStorage` persistiría entre visitas. Una foto que subiste hace tres
//     días reapareciendo en un brief nuevo es un fantasma, no una comodidad.
//   · Un estado de React no sobrevive a `/register`.
//   · IndexedDB aguanta más, pero es asíncrono y aquí sobra: el compositor ya
//     reduce a ~1024px, así que hablamos de 100-300 KB por foto — y son cuatro
//     como mucho (`MAX_REFERENCIAS`), que es justo el número elegido para que
//     el lote entero quepa en la cuota de `sessionStorage` sin acercarse.
//
// SE BORRA AL LEERLA. Es un pase de un solo uso: si el taller se abre otra vez
// —recargar, volver atrás— no debe reaparecer una foto que el usuario ya
// consumió. Ver `tomarReferenciasEnTransito`.
//
// TODO ACCESO VA EN try/catch. En una pestaña privada, con las cookies de sitio
// bloqueadas o con la cuota llena, `sessionStorage` **LANZA** — no devuelve
// null. Ese es exactamente el fallo que ya nos tiró una página entera antes
// (ver la memoria `medir-en-origen-opaco`): la excepción sube y se lleva por
// delante el envío del brief, que sí funcionaba.
// ─────────────────────────────────────────────────────────────────────────────

const CLAVE = "openlen:referencia-en-transito";

export interface ReferenciaEnTransito {
  /** `data:<mime>;base64,…` — tal cual lo produce el compositor. */
  readonly dataUrl: string;
  /** El nombre del fichero, sólo para poder enseñarlo. Nunca viaja al modelo. */
  readonly nombre: string;
}

/** Guarda las fotos para el salto. Devuelve `false` si no se pudo — el llamador
 *  sigue con el brief solo, que es lo que de verdad importa.
 *
 *  UNA SOLA CLAVE PARA TODAS, y no una por foto: `sessionStorage` no tiene
 *  transacciones, así que N claves se pueden quedar a medias —tres escritas y
 *  la cuarta reventando por cuota— y entonces el taller lee un lote que el
 *  usuario nunca compuso. Con una clave o entra el lote entero o no entra
 *  ninguno, que es la única de las dos que se puede explicar. */
export function dejarReferenciasEnTransito(refs: readonly ReferenciaEnTransito[]): boolean {
  try {
    if (refs.length === 0) {
      sessionStorage.removeItem(CLAVE);
      return true;
    }
    sessionStorage.setItem(CLAVE, JSON.stringify(refs));
    return true;
  } catch {
    // Cuota llena (fotos enormes) o almacenamiento bloqueado. Sin ruido: el
    // usuario no puede hacer nada con esta información y su brief sigue en pie.
    return false;
  }
}

/** Las lee Y LAS BORRA. Un pase de un solo uso.
 *
 *  LEE TAMBIÉN EL FORMATO VIEJO —un objeto suelto en vez de un array—, y no
 *  por gusto de compatibilidad: quien tenga la portada abierta AHORA MISMO
 *  guardó con el código de antes, y va a leer con el de después en cuanto se
 *  despliegue. Sin esta rama, esa persona pierde su foto en silencio. */
export function tomarReferenciasEnTransito(): ReferenciaEnTransito[] {
  let crudo: string | null = null;
  try {
    crudo = sessionStorage.getItem(CLAVE);
    sessionStorage.removeItem(CLAVE);
  } catch {
    return [];
  }
  if (!crudo) return [];
  try {
    const leido: unknown = JSON.parse(crudo);
    const lista = Array.isArray(leido) ? leido : [leido];
    const fuera: ReferenciaEnTransito[] = [];
    for (const o of lista) {
      const r = o as Partial<ReferenciaEnTransito> | null;
      if (typeof r?.dataUrl !== "string" || !r.dataUrl.startsWith("data:image/")) continue;
      fuera.push({ dataUrl: r.dataUrl, nombre: typeof r.nombre === "string" ? r.nombre : "" });
    }
    return fuera;
  } catch {
    return [];
  }
}

/** Para cuando el usuario quita las fotos antes de enviar. */
export function olvidarReferenciasEnTransito(): void {
  try {
    sessionStorage.removeItem(CLAVE);
  } catch {
    /* nada que hacer */
  }
}
