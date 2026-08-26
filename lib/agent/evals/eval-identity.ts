/**
 * QUÉ CUENTA PUEDE SER LA DUEÑA DE UNA EVALUACIÓN.
 *
 * El arnés del Agente no sólo crea un proyecto de usar y tirar: el turno puede
 * llamar a `recordar_preferencia`, y eso escribe en `users.agentMemory` — la
 * memoria que cruza TODOS los proyectos de esa persona. La limpieza borra el
 * proyecto y nada más, así que lo escrito en la memoria se queda.
 *
 * `EVAL_USER_EMAIL` ya existía sin valor por defecto, y eso estaba bien: el
 * arnés se niega a correr sin dueño explícito. Lo que faltaba es que **nada
 * impedía apuntarlo a una cuenta de verdad**. Es una variable de entorno; poner
 * ahí tu propio correo es un despiste de un segundo, y el daño —tus preferencias
 * globales pisadas por un caso de prueba— no se ve hasta que el Agente empieza a
 * tratarte según lo que dijo un fixture.
 *
 * DECISIÓN de Jesús (2026-08-25): identidad propia de evaluación. Aquí está la
 * puerta.
 *
 * CÓMO. La dirección tiene que llevar la ETIQUETA `+openlen-eval` — la sintaxis
 * de subdirección de RFC 5233, que Gmail y la mayoría de proveedores entregan a
 * la misma bandeja. Eso hace la cuenta trivial de crear y, sobre todo, IMPOSIBLE
 * de acertar por accidente: nadie escribe su correo normal con esa etiqueta
 * dentro. La puerta no protege contra alguien decidido —quien quiera saltársela,
 * se la salta creando la cuenta— sino contra el despiste, que es de lo que hay
 * que proteger.
 *
 * Y no basta con esto: quien llame sigue teniendo que restaurar `agentMemory`
 * al terminar. Una etiqueta dice de quién es la cuenta, no repara lo que el
 * turno escribió dentro.
 */

/** La etiqueta que marca una dirección como identidad de evaluación. */
export const EVAL_TAG = "+openlen-eval";

export type IdentidadEval =
  | { readonly ok: true; readonly email: string }
  | { readonly ok: false; readonly motivo: string };

/**
 * Pura a propósito: la regla se puede probar entera sin base de datos, y el
 * arnés no puede tener una segunda copia de «qué cuenta vale».
 */
export function identidadDeEval(raw: string | undefined | null): IdentidadEval {
  const email = raw?.trim() ?? "";
  if (!email) {
    return {
      ok: false,
      motivo:
        "EVAL_USER_EMAIL no está puesta — el arnés no corre sin un dueño explícito (no hay valor por defecto).",
    };
  }
  const arroba = email.lastIndexOf("@");
  const local = arroba === -1 ? "" : email.slice(0, arroba);
  if (!local.includes(EVAL_TAG)) {
    return {
      ok: false,
      motivo:
        `EVAL_USER_EMAIL="${email}" no es una identidad de evaluación. Un turno del ` +
        `Agente puede escribir en users.agentMemory, que cruza TODOS los proyectos ` +
        `de esa cuenta, y la limpieza sólo borra el proyecto. Usa una dirección con ` +
        `la etiqueta ${EVAL_TAG} (por ejemplo tu-correo${EVAL_TAG}@gmail.com): llega ` +
        `a tu misma bandeja y no se puede confundir con tu cuenta de verdad.`,
    };
  }
  return { ok: true, email };
}

/**
 * ¿Aterrizó la preferencia en ALGÚN sitio?
 *
 * `recordar_preferencia` tiene dos destinos y el turno elige: alcance
 * «siempre» (el defecto) escribe en `users.agentMemory` —la memoria de la
 * PERSONA, que cruza sus proyectos— y «esta_pagina» escribe en
 * `projects.userBrief`. El oráculo del arnés exigía la SEGUNDA a secas, y por
 * eso suspendía los dos casos que la cubren: sus prompts dicen «siempre», el
 * modelo elegía bien el alcance global, y el eval lo castigaba por acertar.
 *
 * La memoria se compara CONTRA LA DE ANTES del caso, no contra vacío: la
 * identidad de evaluación puede traer algo escrito de antes, y «no está vacía»
 * daría por bueno un turno que no guardó nada.
 */
export function preferenciaAterrizo(args: {
  memoriaPrevia: string | null;
  memoriaAhora: string | null;
  userBrief: string | null | undefined;
}): boolean {
  const global = args.memoriaAhora !== args.memoriaPrevia;
  const local = Boolean(args.userBrief?.trim());
  return global || local;
}