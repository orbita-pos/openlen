// lib/agent/historial-saneado.ts — lo que el servidor ACEPTA del historial que
// manda el navegador.
//
// Lo usan la ruta (`app/api/agent/route.ts`) y el arnés de evals. Vivía en línea
// dentro de la ruta, y el arnés mandaba `history: []`: la batería no podía
// reproducir una conversación, así que nada medía qué hace Len con lo que se
// habló antes (X1 de `plans/auditoria-len-vs-claude-code-2026-09-22.md`). Un
// segundo saneado en el arnés habría medido un historial que la ruta no deja
// pasar.
//
// Puro: ni red, ni base, ni bindings nativos.

/** Un mensaje del historial tal y como lo acepta el servidor. */
export interface MensajeSaneado {
  role: "user" | "assistant";
  content: string;
  functionCalls?: { name: string; args: Record<string, unknown> }[];
  functionResponses?: { name: string; response: { ok: boolean; resumen: string } }[];
}

/**
 * History hardening. El principio: NADA de lo que manda el navegador se pasa
 * tal cual, porque una entrada esparcida entera sería un vector de inyección de
 * tool-calls. El historial SÍ lleva la forma de herramienta, reconstruida desde
 * el catálogo real: del cliente sólo se acepta un NOMBRE, y sólo si es una
 * herramienta que existe. Los argumentos se descartan siempre (van vacíos) y el
 * resultado se reduce a un resumen de texto acotado.
 *
 * Por qué la forma de herramienta: MEDIDO el 2026-08-22 — sin las llamadas en el
 * historial el Agente editó 1 de 12 veces y en los 11 fallos dijo «Listo ✅»
 * sobre una página intacta; con ellas, 10 de 12.
 */
export function sanearHistorial(raw: unknown, nombresValidos: ReadonlySet<string>): MensajeSaneado[] {
  if (!Array.isArray(raw)) return [];
  const limpiaLlamadas = (v: unknown) =>
    Array.isArray(v)
      ? v
          .filter(
            (c): c is { name: string } =>
              !!c && typeof (c as { name?: unknown }).name === "string" &&
              nombresValidos.has((c as { name: string }).name),
          )
          .slice(0, 8)
          .map((c) => ({ name: c.name, args: {} }))
      : [];
  const limpiaRespuestas = (v: unknown) =>
    Array.isArray(v)
      ? v
          .filter(
            (r): r is { name: string; response?: { ok?: unknown; resumen?: unknown } } =>
              !!r && typeof (r as { name?: unknown }).name === "string" &&
              nombresValidos.has((r as { name: string }).name),
          )
          .slice(0, 8)
          .map((r) => ({
            name: r.name,
            // 🔴 EL `ok` VIENE DEL CLIENTE, no de aquí. Esto escribía `true` a
            // mano sobre TODA respuesta del historial, así que un turno pasado
            // que falló se le reenviaba al modelo como si hubiera salido bien —
            // y el modelo vuelve a intentar lo que ya no funcionó, o cierra
            // afirmando un arreglo que no ocurrió.
            //
            // Es dato del cliente, así que se COERCE, no se cree: sólo el
            // booleano `false` exacto marca fallo. Un `ok` inventado no puede
            // hacer más daño que el `true` que se escribía siempre, y decir la
            // verdad cuando la hay vale más que negarla siempre.
            response: {
              ok: (r.response as { ok?: unknown } | undefined)?.ok !== false,
              resumen: String(r.response?.resumen ?? "").slice(0, 400),
            },
          }))
      : [];

  const limpio: MensajeSaneado[] = raw
    .filter(
      (h): h is { role: "user" | "assistant"; content: string } =>
        !!h &&
        ((h as { role?: unknown }).role === "user" || (h as { role?: unknown }).role === "assistant") &&
        typeof (h as { content?: unknown }).content === "string",
    )
    .map((h) => {
      const llamadas = limpiaLlamadas((h as { functionCalls?: unknown }).functionCalls);
      const respuestas = limpiaRespuestas((h as { functionResponses?: unknown }).functionResponses);
      return {
        role: h.role,
        content: h.content.slice(0, 4000),
        ...(llamadas.length ? { functionCalls: llamadas } : {}),
        ...(respuestas.length ? { functionResponses: respuestas } : {}),
      };
    })
    // Una entrada sin contenido Y sin respuestas no aporta nada; el mensaje de
    // respuestas SÍ va con `content` vacío, por diseño.
    .filter((h) => h.content.length > 0 || h.functionResponses);
  // 36 mensajes = 12 TURNOS, y un turno con herramientas ocupa TRES (usuario,
  // asistente+llamadas, respuestas).
  //
  // El recorrido de este número cuenta la historia: eran 6 mensajes (3 turnos),
  // luego 12 (6 turnos), y con las llamadas de vuelta un turno pasó a ocupar
  // tres. Doce turnos es una conversación de verdad y sigue cabiendo de sobra al
  // lado del documento etiquetado, que es lo que de verdad pesa en este prompt.
  //
  // No se sube a los 50 que la base guarda: el prompt se paga en CADA turno para
  // siempre, y el caso que motivaba una ventana enorme —«¿qué hemos hecho?»— lo
  // cubre el registro de cambios, que sobrevive a cualquier tope.
  const cortado = limpio.slice(-36);
  // El corte puede dejar huérfano un mensaje de respuestas cuya llamada quedó
  // fuera. El serializador degrada eso a texto suelto; mejor quitarlo: media
  // pareja confunde más de lo que recuerda.
  while (cortado.length > 0 && cortado[0]!.functionResponses) cortado.shift();
  return cortado;
}

/** Lo que el dueño dijo antes de la ventana (H08-a): sólo cadenas, acotadas en
 *  número y en tamaño. Es texto del navegador y va al modelo como DATO dentro
 *  de su bloque, nunca como instrucción. */
export function sanearDichoAntes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
    .slice(-20)
    .map((d) => d.trim().slice(0, 300));
}

/** Cuántos turnos tiene la conversación DE VERDAD, no cuántos caben. Del mismo
 *  `turnsRef` del cliente del que salieron los que sí viajan. */
export function turnosTotalesDe(historyTotal: unknown): number {
  return typeof historyTotal === "number" && Number.isFinite(historyTotal)
    ? Math.min(Math.max(Math.trunc(historyTotal), 0), 500)
    : 0;
}

/**
 * CUÁNTOS TURNOS DE LA CHARLA VIAJAN DE VERDAD.
 *
 * Lo leen DOS sitios que tienen que decir lo mismo: la nota que va al modelo
 * (`conversacionRecortada`) y el aviso que va al usuario (en el evento `done`).
 *
 * Los mensajes de respuestas de herramienta TAMBIÉN son role "user" (con
 * contenido vacío): contarlos infla la cuenta y diría que se ven más turnos de
 * los que se ven.
 */
export function ventanaVisibleDe(history: readonly MensajeSaneado[]): number {
  return history.filter((h) => h.role === "user" && h.content.length > 0).length;
}

/** ¿El turno anterior fue MUDO? El último mensaje del asistente sin
 *  `functionCalls` significa que no tocó nada. Es un hecho estructural, no una
 *  lectura de su prosa. Un historial vacío (primer turno) no dispara nada. */
export function turnoAnteriorMudoDe(history: readonly MensajeSaneado[]): boolean {
  const ultimo = [...history].reverse().find((h) => h.role === "assistant");
  return ultimo ? !("functionCalls" in ultimo) : false;
}
