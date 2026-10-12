// La limpieza diaria del MCP (lib/mcp/cleanup.ts). La corre
// openlen-mcp-cleanup.timer. Corta: conecta → borra → sale. Sale con 1 si
// falla, para que systemd lo marque y se vea en `journalctl -u openlen-mcp-cleanup`.
import { cleanupMcp } from "@/lib/mcp/cleanup";

async function main() {
  const r = await cleanupMcp();
  console.log(
    `[mcp-cleanup] peticiones ${r.requests} · accesos ${r.accessTokens} · refrescos ${r.refreshTokens} · clientes ${r.clients} · auditoría ${r.audit}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("[mcp-cleanup] falló", e);
  process.exit(1);
});
