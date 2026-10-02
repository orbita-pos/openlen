import { notFound } from "next/navigation";

import { VistaDeLaTerminal } from "./vista";

// Dev-only: la lente «Terminal» (F6a de plans/len-agente-2026) con comandos de
// ejemplo, para verla sin sesión, sin proyecto y sin pagar un turno de Len.
// `?tema=oscuro` la pinta en oscuro. 404 en producción, como /dev/loader.
export default async function TerminalPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tema?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { tema } = await searchParams;
  return <VistaDeLaTerminal oscuro={tema === "oscuro"} />;
}
