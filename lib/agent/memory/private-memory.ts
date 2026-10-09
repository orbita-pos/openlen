/**
 * LA MEMORIA PERSONAL NO SE QUEDA EN LA CONVERSACIÓN COMPARTIDA (plans/len-md).
 *
 * En Claude Code y en DeepSeek cada persona tiene su sesión, y su
 * `~/.claude/CLAUDE.md` sólo entra en la suya. Aquí la conversación de un
 * proyecto la comparten sus miembros, y la fila de un turno se reenvía en los
 * turnos de los demás. Así que se hace lo mismo con otra forma: el
 * `~/.len/LEN.md` de quien habla entra en el contexto de SU turno
 * (`userMemoryBlock`) y lo que se guarda y se reenvía de la conversación dice
 * que se tocó, sin su texto. Y, como Claude Code con lo pensado en turnos
 * anteriores, un turno que la tocó no reenvía su razonamiento (H15): podría
 * citarla.
 *
 * Lo encontró el ensayo de caja del 08/10: el Read y el Edit del LEN.md de Eli
 * se guardaban enteros, y el turno siguiente de Ana se los mandaba al modelo.
 *
 * Puro.
 */
import type { Message } from "@/lib/ai-gateway";
import { CLAVE_TOOL_RESULT } from "@/lib/agent/ficheros/resultado";
import { HOME_DIR, PERSONAL_LEN_MD } from "@/lib/agent/ficheros/len-md";

export const PRIVATE_MEMORY_NOTE =
  "[~/.len/LEN.md is private to whoever was speaking in that turn: its text is not kept in the shared conversation]";

/** La de antes del 08/10, en las transcripciones viejas. */
const LEGACY_PERSONAL = "/memoria/dueno.md";

export function touchesPersonalMemory(path: unknown): boolean {
  if (typeof path !== "string") return false;
  const p = path.startsWith("~/") ? `${HOME_DIR}${path.slice(1)}` : path;
  return p === PERSONAL_LEN_MD || p === LEGACY_PERSONAL;
}

// Un comando que nombra la carpeta de la persona (`~/.len`, `$HOME/.len`,
// `/home/user/.len`), su LEN.md por cualquier camino, o la ruta vieja.
const PERSONAL_IN_COMMAND = /(~|\$HOME|\$\{HOME\}|\/home\/user)\/\.len\b|\.len\/LEN\.md|\/memoria\/dueno\.md/;

function isPrivateCall(call: { readonly name?: string; readonly args?: Record<string, unknown> }): boolean {
  const args = call.args ?? {};
  if (call.name === "bash") return typeof args.command === "string" && PERSONAL_IN_COMMAND.test(args.command);
  return touchesPersonalMemory(args.file_path);
}

function redactedArgs(name: string | undefined, args: Record<string, unknown> | undefined): Record<string, unknown> {
  if (name === "bash") return { command: `# ${PRIVATE_MEMORY_NOTE}` };
  return { file_path: args?.file_path, note: PRIVATE_MEMORY_NOTE };
}

/** El turno tal y como puede quedarse en la conversación compartida. */
export function withoutPersonalMemory<M extends Pick<Message, "role" | "content" | "reasoning" | "functionCalls" | "functionResponses">>(
  mensajes: readonly M[],
): M[] {
  // Por mensaje de llamadas, qué posiciones son privadas; su respuesta va en el siguiente.
  const privadas = mensajes.map((m) => (m.functionCalls ?? []).map((c) => isPrivateCall(c)));
  const tocada = privadas.some((p) => p.includes(true));
  if (!tocada) return [...mensajes];
  return mensajes.map((m, i) => {
    let out: M = m;
    if (m.reasoning) {
      const { reasoning: _quitado, ...resto } = out;
      out = resto as M;
    }
    if (privadas[i]!.includes(true)) {
      out = { ...out, functionCalls: m.functionCalls!.map((c, j) => (privadas[i]![j] ? { ...c, args: redactedArgs(c.name, c.args) } : c)) };
    }
    const anteriores = i > 0 ? privadas[i - 1]! : [];
    if (m.functionResponses?.length && anteriores.includes(true)) {
      out = {
        ...out,
        functionResponses: m.functionResponses.map((r, j) =>
          anteriores[j]
            ? { ...r, response: { ...(typeof r.response.ok === "boolean" ? { ok: r.response.ok } : {}), [CLAVE_TOOL_RESULT]: PRIVATE_MEMORY_NOTE } }
            : r,
        ),
      };
    }
    return out;
  });
}
