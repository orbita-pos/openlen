// users.credits: CRÉDITOS -> CENTICRÉDITOS (x100).
//
// Acompaña al cambio de `lib/credits.ts` del 2026-08-30: la columna sigue
// siendo `integer` y pasa a guardar centésimas de crédito, para poder cobrar
// 1,08 en vez de redondear a 2. Ver el comentario de CENTICREDITOS_POR_CREDITO.
//
// 🔴 EL ORDEN IMPORTA Y NO ES SIMÉTRICO:
//
//     1. ESTA MIGRACIÓN                      (saldos x100, con el código viejo)
//     2. el despliegue con el código nuevo
//
// Así, la ventana entre los dos pasos deja a la gente con 100x créditos bajo el
// código viejo — generoso durante unos minutos, y nadie se queda fuera.
//
// AL REVÉS ES UN CIERRE: el código nuevo leyendo saldos viejos ve 20
// centicréditos, o sea 0,20 créditos, y TODO EL MUNDO se queda sin saldo hasta
// que corra esto. Nunca desplegar primero.
//
// ES DE UNA SOLA VEZ, así que NO va en la lista de `build-migrations.mjs`: esas
// son DDL idempotente («añade la columna si no está») y ésta multiplica datos.
// Correrla dos veces multiplicaría por 10.000.
//
// LA GUARDA ES LA SUMA QUE TÚ DECLARAS, y es infalsificable: si la base no
// tiene exactamente ese total, no toca nada. Tras migrar la suma es 100x, así
// que un segundo intento con el mismo número se niega solo.
//
// Probé antes una guarda por «hay saldos por encima del allotment del plan, así
// que ya migró» y estaba MAL — lo cazó la corrida en seco: en producción hay
// saldos recargados a mano por encima del plan (un free con 100 sobre 20, un
// pro con 1.000 sobre 150), así que ese techo no distingue nada.
//
//   npm run credits:centicreditos                              (informa, no toca)
//   npm run credits:centicreditos -- --suma-esperada=N --aplicar
import { sql } from "drizzle-orm";
import { db } from "../lib/db";
import { CENTICREDITOS_POR_CREDITO } from "../lib/credits";

async function main() {
  const r = await db.execute(
    sql.raw(
      `select count(*)::int as filas,
              coalesce(max(credits), 0)::int as maximo,
              coalesce(sum(credits), 0)::int as total
       from users`,
    ),
  );
  const [fila] = ((r as unknown as { rows?: unknown[] }).rows ??
    (r as unknown as unknown[])) as { filas: number; maximo: number; total: number }[];

  console.log(`usuarios: ${fila.filas} · saldo máximo: ${fila.maximo} · suma: ${fila.total}`);

  const arg = process.argv.find((a) => a.startsWith("--suma-esperada="));
  const esperada = arg ? Number(arg.split("=")[1]) : null;
  const aplicar = process.argv.includes("--aplicar");

  if (esperada === null || !aplicar) {
    console.log(
      `\nEN SECO. Multiplicaría ${fila.filas} saldos por ${CENTICREDITOS_POR_CREDITO}` +
        ` (suma ${fila.total} -> ${fila.total * CENTICREDITOS_POR_CREDITO}).\n` +
        `Para aplicarla:  --suma-esperada=${fila.total} --aplicar`,
    );
    process.exit(0);
  }

  if (esperada !== fila.total) {
    console.error(
      `\nNO SE TOCA NADA. Declaraste ${esperada} y la base suma ${fila.total}.\n` +
        `Si ${fila.total} es ${esperada} x ${CENTICREDITOS_POR_CREDITO}, esta migración YA CORRIÓ.`,
    );
    process.exit(1);
  }

  await db.execute(
    sql.raw(`update users set credits = credits * ${CENTICREDITOS_POR_CREDITO}`),
  );
  console.log(`\nHECHO. ${fila.filas} saldos x${CENTICREDITOS_POR_CREDITO}.`);
  console.log(`AHORA despliega el código nuevo — hasta entonces la app lee 100x de más.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
