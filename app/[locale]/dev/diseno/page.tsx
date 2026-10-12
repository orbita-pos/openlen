import { notFound } from "next/navigation";

import { VistaDelPanelDeDiseno } from "./vista";

// Dev-only: el panel del modo Diseño de las apps con elementos de ejemplo, para
// verlo sin una app corriendo (en local el lienzo de una app no arranca).
// `?tema=oscuro` lo pinta en oscuro. 404 en producción, como /dev/terminal.
export default async function DesignPanelPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tema?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { tema } = await searchParams;
  return <VistaDelPanelDeDiseno oscuro={tema === "oscuro"} />;
}
