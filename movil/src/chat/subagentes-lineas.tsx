// Una línea por hijo: descripción, tipo, estado, pasos y tiempo. El ■ para sólo a ese hijo.
import { useTranslations } from "use-intl";
import type { RunDelMovil } from "./subagentes";
import "./subagentes.css";

const duracion = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

export function SubagentesLineas({ runs, parar }: { runs: readonly RunDelMovil[]; parar(id: string): Promise<void> }) {
  const t = useTranslations("movil.chat.subagentes");
  return <div className="ch-subagentes">{runs.map(r => <div className="ch-subagente" data-subagente={r.id} key={r.id}>
    <div className="ch-subagente-texto">
      <strong>{r.description}</strong>
      <small>{r.preset !== "general-purpose" && <span>{r.preset} · </span>}{t(`status.${r.status}`)} · {t("steps", { n: r.toolUses })}{r.durationMs !== null && ` · ${duracion(r.durationMs)}`}</small>
      {r.worktree && r.worktree.state !== "nothing" && <small>{t(`worktree.${r.worktree.state}`, { n: r.worktree.state === "brought" ? r.worktree.files.length : 0 })}</small>}
    </div>
    {r.status === "running" && <button type="button" className="ch-subagente-parar" aria-label={t("stop")} onClick={() => void parar(r.id).catch(() => {})}>■</button>}
  </div>)}</div>;
}
