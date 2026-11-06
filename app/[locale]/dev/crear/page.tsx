import { notFound } from "next/navigation";

import { CreateSandbox } from "./view";

// Dev-only: el input de Crear —el de la portada, el único desde el 06/11— con
// el componente DE VERDAD y sin sesión, para verlo y compararlo con el
// compositor del chat nuevo. `?tema=oscuro` lo pinta en
// oscuro. 404 en producción, como /dev/chat.
export default async function CreateSandboxPage({
  searchParams,
}: {
  searchParams: Promise<{ tema?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { tema } = await searchParams;
  return <CreateSandbox dark={tema === "oscuro"} />;
}
