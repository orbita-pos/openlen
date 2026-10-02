import { notFound } from "next/navigation";

import { VistaDeLaTerminal } from "./vista";

// Dev-only: la lente «Terminal» (F6a de plans/len-agente-2026) con comandos de
// ejemplo, y la lente «Cambios» con la tarjeta del pie del turno, para verlas
// sin sesión, sin proyecto y sin pagar un turno de Len. `?tema=oscuro` las
// pinta en oscuro; `?lente=cambios` abre la de cambios. 404 en producción,
// como /dev/loader.
export default async function TerminalPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tema?: string; lente?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { tema, lente } = await searchParams;
  return <VistaDeLaTerminal oscuro={tema === "oscuro"} cambios={lente === "cambios"} />;
}
