"use client";

// ─────────────────────────────────────────────────────────────────────────────
// LA FOTO QUE CRUZA DE LA PORTADA AL TALLER.
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
//     reduce a ~1024px, así que hablamos de 100-300 KB.
//
// SE BORRA AL LEERLA. Es un pase de un solo uso: si el taller se abre otra vez
// —recargar, volver atrás— no debe reaparecer una foto que el usuario ya
// consumió. Ver `tomarReferenciaEnTransito`.
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

/** Guarda la foto para el salto. Devuelve `false` si no se pudo — el llamador
 *  sigue con el brief solo, que es lo que de verdad importa. */
export function dejarReferenciaEnTransito(ref: ReferenciaEnTransito): boolean {
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify(ref));
    return true;
  } catch {
    // Cuota llena (una foto enorme) o almacenamiento bloqueado. Sin ruido: el
    // usuario no puede hacer nada con esta información y su brief sigue en pie.
    return false;
  }
}

/** La lee Y LA BORRA. Un pase de un solo uso. */
export function tomarReferenciaEnTransito(): ReferenciaEnTransito | null {
  let crudo: string | null = null;
  try {
    crudo = sessionStorage.getItem(CLAVE);
    sessionStorage.removeItem(CLAVE);
  } catch {
    return null;
  }
  if (!crudo) return null;
  try {
    const o = JSON.parse(crudo) as Partial<ReferenciaEnTransito>;
    if (typeof o?.dataUrl !== "string" || !o.dataUrl.startsWith("data:image/")) return null;
    return { dataUrl: o.dataUrl, nombre: typeof o.nombre === "string" ? o.nombre : "" };
  } catch {
    return null;
  }
}

/** Para cuando el usuario quita la foto antes de enviar. */
export function olvidarReferenciaEnTransito(): void {
  try {
    sessionStorage.removeItem(CLAVE);
  } catch {
    /* nada que hacer */
  }
}
