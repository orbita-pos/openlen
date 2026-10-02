// UNA LÍNEA DE CÓDIGO CON SUS COLORES (la #15 de
// plans/len-agente-2026/notas/fase-5-taller.md): los trozos de
// `lib/workspace-v2/colorear.ts` con su clase `sx-*` (los colores están en
// `tokens.css`, en claro y en oscuro). Todo va como TEXTO de React: el código
// nunca se interpreta.

import type { Trozo } from "@/lib/workspace-v2/colorear";

export function LineaColoreada({ trozos }: { trozos: readonly Trozo[] }) {
  if (trozos.length === 0) return <>{" "}</>;
  return (
    <>
      {trozos.map((t, i) =>
        t.tipo ? (
          <span key={i} className={`sx-${t.tipo}`}>
            {t.texto}
          </span>
        ) : (
          t.texto
        ),
      )}
    </>
  );
}
