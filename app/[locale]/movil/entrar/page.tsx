import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { auth } from "@/auth";
import { estadoValido } from "@/lib/movil/secreto";
import { crearCodigo } from "@/lib/movil/llaves";
import { urlDeRegreso } from "@/lib/movil/regreso";
import { Volver } from "./volver";

export const dynamic = "force-dynamic";

// Entrar desde la app del teléfono. Protegida en el middleware (sin sesión →
// login, que ahora conserva `?estado=`). Con sesión crea el código de un solo
// uso y devuelve a la app. Chrome puede no abrir un esquema propio sin un
// toque del usuario: por eso la página intenta sola y deja un botón.
export default async function EntrarDesdeLaApp({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ estado?: string; retorno?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { estado, retorno } = await searchParams;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect({ href: "/login", locale });
  if (!estadoValido(estado)) return <Volver url={null} />;
  const codigo = await crearCodigo(userId!, estado);
  const url = urlDeRegreso({
    retorno: retorno === "dev" ? "dev" : "app",
    codigo,
    estado,
    produccion: process.env.NODE_ENV === "production",
  });
  return <Volver url={url} />;
}
