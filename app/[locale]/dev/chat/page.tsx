import { notFound } from "next/navigation";

import { readScene, scenes } from "@/lib/agent/replay-scenes/scene-files";
import { storedTurnOfSceneRow } from "@/lib/agent/replay-scenes/scene-turns";
import { ChatSandbox } from "./view";

// Dev-only: el chat nuevo (plans/new-chat/) —y el de hoy al lado, para
// comparar— con turnos de ejemplo, sin sesión, sin proyecto y sin pagar un
// turno de Len. `?tema=oscuro` lo pinta en oscuro; `?solo=new` o `?solo=old`
// monta uno solo. `?scene=<nombre>` arranca con los turnos de una escena real de
// Len 3.1 (`lib/agent/replay-scenes/`, descargada fuera del repo). 404 en
// producción, como /dev/terminal.
export default async function ChatSandboxPage({
  searchParams,
}: {
  searchParams: Promise<{ tema?: string; solo?: string; scene?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { tema, solo, scene } = await searchParams;
  // Sólo un nombre de la lista: nunca una ruta que venga en la URL.
  const file = scene && scenes.some((s) => s.name === scene) ? readScene(scene) : null;
  return (
    <ChatSandbox
      dark={tema === "oscuro"}
      only={solo === "new" || solo === "old" ? solo : null}
      scene={file ? file.rows.map(storedTurnOfSceneRow) : null}
    />
  );
}
