// Quién hace esta petición: la sesión de la web o la llave del teléfono.
// Sólo la usan las rutas de LA lista (lib/movil/rutas-de-la-app.ts). Con
// «Authorization» manda la llave y NADA más: una llave mala no cae a la
// cookie, para que el fallo se vea en vez de quedar tapado.
import { auth } from "@/auth";
import { llaveDeLaCabecera } from "./secreto";

export async function usuarioDeLaPeticion(req: Request): Promise<string | null> {
  const cabecera = req.headers.get("authorization");
  if (cabecera !== null) {
    const llave = llaveDeLaCabecera(cabecera);
    if (!llave) return null;
    // Se carga aquí y no arriba: las pruebas de las rutas que no mandan llave
    // no necesitan base de datos.
    const { usuarioDeLaLlave } = await import("./llaves");
    return usuarioDeLaLlave(llave);
  }
  const session = await auth();
  return session?.user?.id ?? null;
}
