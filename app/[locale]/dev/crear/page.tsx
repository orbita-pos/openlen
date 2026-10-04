import { notFound } from "next/navigation";

import { CreateSandbox } from "./view";

// Dev-only: los dos inputs de Crear —el de la portada y el de /new sin
// proyecto— con los componentes DE VERDAD y sin sesión, para verlos y
// compararlos con el compositor del chat nuevo. `?tema=oscuro` lo pinta en
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
