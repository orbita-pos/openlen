"use client";

// EL TEXTO DE LEN EN EL CHAT, sacado de `panels/chat-panel.tsx` para que el
// ejemplo de `/dev/terminal` pinte el mismo componente que el Chat.

import type { ReactNode } from "react";

import { collapseBlankLines, trozosConFormato } from "@/lib/chat/formato-de-len";
import { rutaMencionada } from "@/lib/workspace-v2/abrir-fichero";

/** Un trozo de código del texto de Len; si nombra un fichero del turno, lo abre. */
function CodigoDeLen({
  texto,
  ruta,
  onAbrir,
}: {
  texto: string;
  ruta: string | null;
  onAbrir: ((ruta: string) => void) | undefined;
}) {
  const clase = "font-mono text-[11.5px] rounded px-1 border bd";
  if (!ruta || !onAbrir) return <code className={clase}>{texto}</code>;
  return (
    <button
      type="button"
      onClick={() => onAbrir(ruta)}
      title={ruta}
      className={`${clase} text-accent hover:underline align-baseline`}
    >
      {texto}
    </button>
  );
}

/** Un enlace del chat: se abre en otra pestaña, sin darle a la página de destino acceso a ésta. */
export function ChatLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-link underline-offset-2 hover:underline break-all">
      {children}
    </a>
  );
}

/** Lo que Len escribe, con su **negrita**, `código`, *cursiva* y enlaces pintados
 *  en vez de con las marcas a la vista. Cada trozo es texto que React escapa. */
export function TextoDeLen({
  texto,
  rutas = [],
  onAbrir,
}: {
  texto: string;
  /** Los ficheros que el turno leyó o cambió: un trozo de código que nombra
   *  uno de ellos abre ese fichero (la #9, `rutaMencionada`). */
  rutas?: readonly string[];
  onAbrir?: (ruta: string) => void;
}) {
  return (
    <>
      {trozosConFormato(collapseBlankLines(texto)).map((t, i) =>
        t.tipo === "negrita" ? (
          <strong key={i} className="font-semibold">
            {t.texto}
          </strong>
        ) : t.tipo === "codigo" ? (
          <CodigoDeLen key={i} texto={t.texto} ruta={onAbrir ? rutaMencionada(t.texto, rutas) : null} onAbrir={onAbrir} />
        ) : t.tipo === "cursiva" ? (
          <em key={i}>{t.texto}</em>
        ) : t.tipo === "enlace" ? (
          <ChatLink key={i} href={t.href!}>
            {t.texto}
          </ChatLink>
        ) : (
          t.texto
        ),
      )}
    </>
  );
}
