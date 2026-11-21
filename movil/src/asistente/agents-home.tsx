// NO PAGES: YOUR AGENTS ARE THE APP (spec local 2026-11-19-agentes-para-todos, §1 and §6.8). Someone who never made a page
// and made agents on the web opens the phone: their agents live in their hidden space, which isn't in the list of pages,
// so the app is the list of their agents — tapping one opens her chat (the main screen's, over this) — instead of
// «Aún no tienes páginas». The main screen keeps everything else (her chat, the panels, the notices).
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import type { AssistantListItem } from "@/lib/assistants/view";

import { AgentsList } from "./agents-list";

export function AgentsHome({
  agentes,
  actual,
  onElegir,
  onCrear,
  atajos,
}: {
  agentes: readonly AssistantListItem[];
  actual: string;
  onElegir: (a: AssistantListItem) => void;
  onCrear?: () => void;
  /** «Tareas», the notices' control, «Salir». */
  atajos: ReactNode;
}) {
  const t = useTranslations("movil.asistente");
  return (
    <section className="lm-layer lm-chat lm-m lm-marca is-on app-agentes" data-mode="agents" aria-labelledby="agentes-inicio">
      <h1 id="agentes-inicio">{t("agentes")}</h1>
      <AgentsList agentes={agentes} actual={actual} onElegir={onElegir} {...(onCrear ? { onCrear } : {})} />
      <div className="app-agentes-atajos">{atajos}</div>
    </section>
  );
}
