// Las cajas de la terminal real pausadas hace una semana (lib/agent/sandbox/reaper.ts). La corre
// openlen-sandbox-reaper.timer. Corta: lista → mata → olvida → sale. Sale con 1 si alguna no se
// pudo matar, para que systemd lo marque y se vea en `journalctl -u openlen-sandbox-reaper`.
import { reapSandboxes, sandboxCleanupDriver } from "@/lib/agent/sandbox/reaper";

async function main() {
  const driver = sandboxCleanupDriver();
  if (!driver) {
    console.log("[sandbox-reaper] sin E2B_API_KEY: nada que matar");
    process.exit(0);
  }
  const r = await reapSandboxes({ driver, now: new Date() });
  console.log(`[sandbox-reaper] matadas ${r.killed} · fallidas ${r.failed}`);
  process.exit(r.failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("[sandbox-reaper] falló", e);
  process.exit(1);
});
