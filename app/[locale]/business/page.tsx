import { redirect } from "@/i18n/navigation";

// ⚰️ Esta ruta servía la sección «Mi negocio», que luego se mudó dentro del
// taller como `/new?view=business`. El perfil entero se retiró el 2026-08-31,
// así que ya no hay sección a la que llevar a nadie.
//
// El redirector SE QUEDA, apuntando al taller: un marcador guardado o un enlace
// viejo tiene que aterrizar en algo, y un 404 sería castigar al usuario por un
// cambio nuestro.
export default async function BusinessPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: "/new", locale });
}
