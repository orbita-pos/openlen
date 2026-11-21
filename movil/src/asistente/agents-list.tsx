// THE LIST OF AGENTS (spec local 2026-11-19-agentes-para-todos, §2.2 and §6.8): each of the person's agents, «como
// contactos de WhatsApp» — her figure and her name, the app's one marked —, to choose whom to talk to. As a panel (with
// `onCerrar`) when there are several beside your pages; as the whole screen when you have no pages (`AgentsHome`).
// «Crear un agente» opens the web, where Len makes them (§6.3); only when the server can (`onCrear`).
import { useTranslations } from "use-intl";

import { AssistantFigure } from "@/components/workspace-v2/assistant/figure";
import { lookOfRow } from "@/lib/assistants/look";
import type { AssistantListItem } from "@/lib/assistants/view";

import "./agents-list.css";

export function AgentsList({
  agentes,
  actual,
  onElegir,
  onCrear,
  onCerrar,
}: {
  agentes: readonly AssistantListItem[];
  /** The app's one: marked. */
  actual: string | null;
  /** Tapping one is talking to her. */
  onElegir: (a: AssistantListItem) => void;
  /** Absent: no «Crear un agente» (agents off on the server, or a server from before). */
  onCrear?: () => void;
  /** Present: a panel, with its title and a way back. */
  onCerrar?: () => void;
}) {
  const t = useTranslations("movil.asistente");
  const lista = (
    <ul className="agentes-lista">
      {agentes.map((a) => (
        <li key={a.id}>
          <button type="button" className="agentes-fila" data-agente={a.id} aria-current={a.id === actual ? "true" : undefined} onClick={() => onElegir(a)}>
            <AssistantFigure look={lookOfRow(a)} size={40} />
            <b>{a.name}</b>
          </button>
        </li>
      ))}
      {onCrear && (
        <li>
          <button type="button" className="agentes-fila agentes-crear" data-crear-agente="" onClick={onCrear}>
            {t("crearAgente")}
          </button>
        </li>
      )}
    </ul>
  );
  if (!onCerrar) return lista;
  return (
    <section className="app-gestion app-resumen lm-m lm-marca" role="dialog" aria-modal="true" aria-labelledby="agentes-titulo">
      <header>
        <div>
          <h1 id="agentes-titulo">{t("agentes")}</h1>
        </div>
        <button className="gestion-cerrar" data-agentes-volver="" onClick={onCerrar} aria-label={t("cerrar")}>
          ×
        </button>
      </header>
      <div className="gestion-cuerpo">{lista}</div>
    </section>
  );
}
