// lib/len-bench/sesion.ts — hablarle a Len como le habla el navegador.
//
// La cookie se ACUÑA con el mismo `encode` de Auth.js que firma las de
// producción (estrategia JWT, `session.user.id = token.sub` en auth.config.ts).
// Así la identidad de evaluación no necesita contraseña en ningún fichero. Y
// se COMPRUEBA antes de usarla contra /api/auth/session: una cookie mal
// firmada no fallaría aquí, fallaría como un 401 en el primer turno.

import { encode } from "next-auth/jwt";
import type { Entorno } from "./entorno";
import { crearLectorSse, type EventoSse } from "./sse";

/**
 * El nombre de la cookie de sesión, decidido como lo decide Auth.js.
 *
 * `auth()` dentro de una ruta arma la URL con `AUTH_URL ?? NEXTAUTH_URL` si
 * existen y, si no, con `x-forwarded-proto`, que Next pone a `http` en una
 * petición por http plano (next/dist/server/base-server.js). Con https la
 * cookie lleva el prefijo `__Secure-`, y la SAL del cifrado es el nombre: una
 * cookie con el nombre equivocado no se descifra, da 401.
 */
export function nombreDeCookie(entorno: Entorno): string {
  const url = entorno.AUTH_URL ?? entorno.NEXTAUTH_URL;
  const seguro = url ? new URL(url).protocol === "https:" : false;
  return `${seguro ? "__Secure-" : ""}authjs.session-token`;
}

/** El secreto que usa el servidor: `AUTH_SECRET ?? NEXTAUTH_SECRET`, el orden
 *  de `setEnvDefaults` en node_modules/next-auth/lib/env.js. */
export function secretoDeAuth(entorno: Entorno): string {
  const s = entorno.AUTH_SECRET ?? entorno.NEXTAUTH_SECRET;
  if (!s) {
    throw new Error(
      "ni AUTH_SECRET ni NEXTAUTH_SECRET están definidos: sin el secreto del servidor no se puede acuñar una " +
        "cookie que abra sesión. Carga .env.local con --env-file.",
    );
  }
  return s;
}

export async function acunarCookie(o: { userId: string; email: string; entorno: Entorno }): Promise<string> {
  const nombre = nombreDeCookie(o.entorno);
  const token = await encode({
    token: { sub: o.userId, email: o.email },
    secret: secretoDeAuth(o.entorno),
    salt: nombre,
    maxAge: 6 * 60 * 60,
  });
  return `${nombre}=${token}`;
}

export async function comprobarSesion(base: string, cookie: string, userId: string): Promise<void> {
  const r = await fetch(`${base}/api/auth/session`, { headers: { cookie } });
  const j = (await r.json().catch(() => null)) as { user?: { id?: string } } | null;
  if (j?.user?.id !== userId) {
    throw new Error(
      `la cookie acuñada no abre sesión en ${base} (status ${r.status}, user.id=${j?.user?.id ?? "ninguno"}). ` +
        `¿El servidor usa el mismo AUTH_SECRET/NEXTAUTH_SECRET y la misma AUTH_URL/NEXTAUTH_URL que este proceso?`,
    );
  }
}

export interface CuerpoDelTurno {
  readonly projectId: string;
  readonly prompt: string;
  /** Un uuid: la ruta descarta cualquier otra forma. */
  readonly turnId: string;
  readonly history: unknown[];
  readonly historyTotal: number;
  readonly dichoAntes: unknown;
  /**
   * El panel SIEMPRE lo manda, con lo que el dueño tiene seleccionado, y un
   * usuario nuevo tiene `"auto"` (chat-panel.tsx). Sin él, la ruta caería al
   * esfuerzo guardado en el perfil de la identidad de evaluación, que otra
   * corrida pudo cambiar: dos corridas medirían dos Len distintos.
   */
  readonly esfuerzo: string;
  readonly page?: string;
  /** La zona IANA del navegador, como la manda el panel (plans/len-resultados/
   *  diseno.md §7). Sin ella, la ruta usaría la guardada de la identidad de
   *  eval, que otra corrida pudo cambiar: el mismo problema que `esfuerzo`. */
  readonly zonaHoraria?: string;
  /** Len Dynamis (`lib/agent/dynamis.ts`): como el panel, sólo se manda ése. */
  readonly mode?: "dynamis";
}

export async function enviarTurno(o: {
  readonly base: string;
  readonly cookie: string;
  readonly cuerpo: CuerpoDelTurno;
  readonly timeoutMs: number;
}): Promise<EventoSse[]> {
  const abort = new AbortController();
  /** El id que la ruta manda en el primer evento: con él se pide parar. */
  let turnoId: string | null = null;
  // 🔴 EL PLAZO PARA EL TURNO, NO SÓLO LA LECTURA (Len 2.1). La ruta ya no corta
  // el turno cuando el cliente se va, así que abortar el `fetch` dejaría a Len
  // trabajando —y gastando— detrás de una corrida que ya pasó a la siguiente.
  // Primero se le pide parar, como el ■ del panel; luego se deja de leer.
  const reloj = setTimeout(async () => {
    if (turnoId) {
      await fetch(`${o.base}/api/agent/cancelar`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: o.cookie },
        body: JSON.stringify({ turnoId }),
      }).catch(() => {});
    }
    abort.abort();
  }, o.timeoutMs);
  try {
    const r = await fetch(`${o.base}/api/agent`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: o.cookie },
      body: JSON.stringify(o.cuerpo),
      signal: abort.signal,
    });
    if (!r.ok || !r.body) throw new Error(`/api/agent respondió ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const lector = crearLectorSse();
    const eventos: EventoSse[] = [];
    const dec = new TextDecoder();
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const nuevos = lector.empujar(dec.decode(value, { stream: true }));
      for (const e of nuevos) {
        const id = (e.datos as { turnoId?: unknown } | null)?.turnoId;
        if (e.nombre === "turno" && typeof id === "string") turnoId = id;
      }
      eventos.push(...nuevos);
    }
    eventos.push(...lector.empujar(dec.decode() + "\n\n"));
    return eventos;
  } finally {
    clearTimeout(reloj);
  }
}

export interface TarjetaDePublicar {
  readonly subdominio: string;
  readonly idiomas: readonly string[];
  readonly republicar: boolean;
}

/** La tarjeta «Publicar» que Len dejó en el turno (`publicar` NUNCA publica:
 *  prepara la tarjeta y espera el tap del dueño). La última, si hay varias. */
export function tarjetaDePublicar(eventos: readonly EventoSse[]): TarjetaDePublicar | null {
  let t: TarjetaDePublicar | null = null;
  for (const e of eventos) {
    const d = e.datos as { action?: unknown; subdominio?: unknown; idiomas?: unknown; republicar?: unknown } | null;
    if (e.nombre !== "confirm" || d?.action !== "publicar" || typeof d.subdominio !== "string") continue;
    t = {
      subdominio: d.subdominio,
      idiomas: Array.isArray(d.idiomas) ? d.idiomas.filter((x): x is string => typeof x === "string") : [],
      republicar: d.republicar === true,
    };
  }
  return t;
}

/**
 * El TAP del dueño en la tarjeta: lo mismo que `agent-confirm-card.tsx`. Un
 * nombre nuevo se comprueba primero (`/api/subdomains/check`); re-publicar el
 * suyo no. `languages` sólo va si Len eligió idiomas: la ruta trata una clave
 * PRESENTE como «guarda esto». Como el `artifactPublishGranted` del corredor de
 * Claude Code: sólo se toca en los encargos que lo conceden (`publicaLen`).
 */
export async function tocarPublicar(o: {
  readonly base: string;
  readonly cookie: string;
  readonly projectId: string;
  readonly tarjeta: TarjetaDePublicar;
  readonly fetch?: typeof fetch;
}): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const f = o.fetch ?? fetch;
  const headers = { "content-type": "application/json", cookie: o.cookie };
  const { subdominio, idiomas, republicar } = o.tarjeta;
  if (!republicar) {
    const r = await f(`${o.base}/api/subdomains/check`, { method: "POST", headers, body: JSON.stringify({ subdomain: subdominio }) });
    const j = (await r.json().catch(() => ({}))) as { available?: boolean; reason?: string };
    if (!r.ok || !j.available) return { ok: false, motivo: `subdominio no disponible: ${j.reason ?? r.status}` };
  }
  const r = await f(`${o.base}/api/projects/${o.projectId}/publish`, {
    method: "POST",
    headers,
    body: JSON.stringify({ subdomain: subdominio, ...(idiomas.length > 0 ? { languages: idiomas } : {}) }),
  });
  return r.ok ? { ok: true } : { ok: false, motivo: `publicar respondió ${r.status}` };
}

/** Lo que Len le escribió al dueño en el turno: la suma de sus eventos `text`
 *  (la ruta reenvía cada evento del bucle como `event: <type>`). */
export function textoDeLen(eventos: readonly EventoSse[]): string {
  return eventos
    .filter((e) => e.nombre === "text")
    .map((e) => String((e.datos as { text?: unknown } | null)?.text ?? ""))
    .join("");
}

/** Las herramientas que Len llamó en el turno, sin repetir y en el orden de la
 *  primera llamada: el `tool` de sus eventos `action` (el bucle emite uno al
 *  empezar cada llamada y otro al acabarla). */
export function herramientasDeLen(eventos: readonly EventoSse[]): string[] {
  const vistas: string[] = [];
  for (const e of eventos) {
    const tool = (e.datos as { tool?: unknown } | null)?.tool;
    if (e.nombre === "action" && typeof tool === "string" && !vistas.includes(tool)) vistas.push(tool);
  }
  return vistas;
}
