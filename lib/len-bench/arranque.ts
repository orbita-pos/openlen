// lib/len-bench/arranque.ts — lo que hace un corredor PAGADO antes de su primer
// turno: apagar lo que tocaría producción, exigir la base local, la identidad
// de eval con saldo, y una cookie que abra sesión en el servidor de Len-Bench.
//
// Lo usan scripts/len-bench.ts y scripts/len-bench-disparos.ts. Vivía copiado
// en el primero; dos copias de un arranque que protege producción podían dejar
// de decir lo mismo (memoria `la-guarda-que-compara-dos-copias`).

import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { CENTICREDITOS_POR_CREDITO } from "@/lib/credits";
import { apagarEnEsteProceso, exigirBaseLocal } from "./entorno";
import { resolveEvalUser } from "./proyecto-de-eval";
import { acunarCookie, comprobarSesion } from "./sesion";

const SALDO_MINIMO_CREDITOS = 5_000;

// El reloj de Len-Bench NO puede ser más estricto que producción: con 240 s se
// abortó un turno de 34 pasos que seguía trabajando (humo 2 de Len 2.0) y se
// culpó al tope, cuando la ruta le daba 6 min. Aquí queda sólo un tope de
// seguridad que un turno sano no toca, y el plazo que manda es el de la ruta
// (V2 de plans/len-2/hipotesis/, en los dos brazos): en producción, sólo el
// reloj de silencio (180 s sin nada).
// 🔴 16/11 (batería 1 de Len 3.1): los 20 min de antes —«~170 pasos a ~7 s»—
// cortaron 13 turnos que seguían trabajando: 55–110 llamadas a 9–20 s cada una
// (DeepInfra, de día más lento), 90–97 % del tiempo en el modelo. Con la misma
// cuenta y lo medido, 170 pasos a 20 s ≈ 57 min: 60. Y si aun así corta, es del
// banco (`plazo_del_banco`, sesion.ts), no de Len.
export const TIMEOUT_TURNO_MS = 3_600_000;

export async function arrancarCorredor(base: string): Promise<{ owner: { id: string; email: string }; cookie: string }> {
  apagarEnEsteProceso(process.cwd());
  await exigirBaseLocal();
  const owner = await resolveEvalUser();
  // El saldo de la identidad de eval, repuesto: sin créditos la ruta rechaza el
  // turno y la corrida mediría un 402, no a Len.
  await db
    .update(schema.users)
    .set({ credits: sql`GREATEST(${schema.users.credits}, ${SALDO_MINIMO_CREDITOS * CENTICREDITOS_POR_CREDITO})` })
    .where(eq(schema.users.id, owner.id));
  const cookie = await acunarCookie({ userId: owner.id, email: owner.email, entorno: process.env });
  await comprobarSesion(base, cookie, owner.id);
  return { owner, cookie };
}
