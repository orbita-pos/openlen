/**
 * DE QUIÉN ES UN FORMULARIO Y CÓMO CONTESTARLE. Puro: sólo mira las claves y
 * los valores que escribió el visitante. Nunca inventa: lo que no está, null.
 */
export interface Contacto { nombre: string | null; correo: string | null; telefono: string | null }

const CLAVE_NOMBRE = /^(nombre|name|tu nombre|nombre completo|full ?name)$/i;
const CLAVE_CORREO = /(correo|e-?mail|mail)/i;
const CLAVE_TELEFONO = /(tel[eé]fono|tel|phone|whats|celular|m[oó]vil|cel)/i;
const ES_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ES_TELEFONO = /^\+?[\d\s().-]{8,20}$/;

export function contactoDe(datos: Record<string, string>): Contacto {
  let nombre: string | null = null;
  let correo: string | null = null;
  let telefono: string | null = null;
  for (const [clave, crudo] of Object.entries(datos)) {
    const valor = String(crudo ?? "").trim();
    if (!valor) continue;
    if (!nombre && CLAVE_NOMBRE.test(clave.trim())) nombre = valor;
    else if (!correo && ES_CORREO.test(valor) && (CLAVE_CORREO.test(clave) || valor.includes("@"))) correo = valor;
    else if (!telefono && CLAVE_TELEFONO.test(clave) && ES_TELEFONO.test(valor)) telefono = valor;
  }
  return { nombre, correo, telefono };
}

export function lineaDe(datos: Record<string, string>, max = 80): string {
  const c = contactoDe(datos);
  const deContacto = new Set([c.nombre, c.correo, c.telefono].filter(Boolean));
  const primera = Object.values(datos).map((v) => String(v ?? "").trim()).find((v) => v && !deContacto.has(v)) ?? "";
  return primera.length > max ? `${primera.slice(0, max)}…` : primera;
}
