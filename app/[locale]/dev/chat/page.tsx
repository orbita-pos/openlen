import { notFound } from "next/navigation";

import { ChatSandbox } from "./view";

// Dev-only: el chat nuevo (plans/new-chat/) —y el de hoy al lado, para
// comparar— con turnos de ejemplo, sin sesión, sin proyecto y sin pagar un
// turno de Len. `?tema=oscuro` lo pinta en oscuro; `?solo=new` o `?solo=old`
// monta uno solo. 404 en producción, como /dev/terminal.
export default async function ChatSandboxPage({
  searchParams,
}: {
  searchParams: Promise<{ tema?: string; solo?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { tema, solo } = await searchParams;
  return <ChatSandbox dark={tema === "oscuro"} only={solo === "new" || solo === "old" ? solo : null} />;
}
