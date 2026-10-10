// El servicio de Realtime de las páginas (`/realtime/v1`, lib/backend/realtime),
// un proceso aparte de Next: los manejadores de ruta de Next no sostienen
// WebSockets. Lo empaqueta scripts/build-cron.mjs en
// .next/standalone/realtime/server.mjs y lo corre la unidad
// infra/app/openlen-realtime.service con el mismo /etc/openlen/openlen.env.
//
//   PAGES_REALTIME_PORT       el puerto en 127.0.0.1 (4100); Caddy le pasa /realtime/v1/*.
//   PAGES_REALTIME_PASSWORD   la de `openlen_realtime` (LOGIN REPLICATION), para
//                             el slot de wal2json de postgres_changes. Sin ella,
//                             postgres_changes contesta su error y lo demás sigue.
//   PAGES_REALTIME_*          los límites (lib/backend/realtime/limits.ts).

import { Client } from "pg";

import { backendConfigured } from "@/lib/backend/pg";
import { changeSource } from "@/lib/backend/realtime/poller";
import { realtimeProjectForHost } from "@/lib/backend/realtime/project-lookup";
import { createRealtimeServer } from "@/lib/backend/realtime/server";
import { pgWalReader } from "@/lib/backend/realtime/wal-reader";

/** La URL de `openlen_realtime` a la base del proyecto: la del clúster
 *  (PAGES_DATABASE_URL) con otro usuario y otra base. */
function replicationUrl(database: string): string | null {
  const base = process.env.PAGES_DATABASE_URL;
  const password = process.env.PAGES_REALTIME_PASSWORD;
  if (!base || !password) return null;
  const u = new URL(base);
  u.username = "openlen_realtime";
  u.password = encodeURIComponent(password);
  u.pathname = `/${database}`;
  return u.toString();
}

const rt = createRealtimeServer({
  // Sin clúster configurado no hay proyectos: «Tenant not found», no se finge.
  resolveProject: async (host, origin) => (backendConfigured() ? realtimeProjectForHost(host, origin) : null),
  changeSource: (project) => {
    const url = replicationUrl(`ol_${project.ref}`);
    if (!url || !project.db) return null;
    return changeSource(
      project.db,
      pgWalReader({
        slotName: `realtime_${project.ref}`,
        connect: () => new Client({ connectionString: url, options: "-c search_path=pg_catalog", application_name: "realtime_rls" }),
      }),
    );
  },
});

const port = Number(process.env.PAGES_REALTIME_PORT ?? 4100);
rt.server.listen(port, "127.0.0.1", () => {
  console.log(`[realtime] escuchando en 127.0.0.1:${port}`);
});

// Su `SignalHandler`: al parar, cada socket recibe el cierre y se sueltan los slots.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void rt.close().finally(() => process.exit(0));
  });
}
