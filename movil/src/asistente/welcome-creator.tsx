// MEET YOUR ASSISTANT (spec local 2026-11-16-movil-es-tu-asistente, §5.1): Len móvil is her app, so whoever opens it
// with none creates her here — her figure, her name, her shape, her color, how she talks — on the web creator's pieces
// and words (`own.creator.*`, the web's own messages in the 10 languages). Born from the phone, her bubble stays off
// (Jesús, 16/11): she is made to pass your requests to Len. «Ahora no» leaves today's app.
import { useCallback, useState } from "react";
import { useTranslations } from "use-intl";

import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { AssistantFigure } from "@/components/workspace-v2/assistant/figure";
import { LiveFigure } from "@/components/workspace-v2/assistant/live-figure";
import { ASSISTANT_NAME_MAX, ASSISTANT_TONES, type AssistantTone } from "@/lib/assistants/names";
import { FIGURE_COLORS, checkLook, offered, type FigureCategory, type FigureLook } from "@/lib/figure/look";
import { curatedLook } from "@/lib/figure/random";
import { tintOf } from "@/lib/figure/tint";

import { createAssistantFromPhone, figurasEncendidas } from "../api/asistente";
import { useAtras } from "../atras";
import "./welcome-creator.css";

type Failure = "name" | "nameTaken" | "projectHas" | "ownerOnly" | "generic";
const FAILURE_OF_CODE: Readonly<Record<string, Failure>> = { name_taken: "nameTaken", project_has_assistant: "projectHas", solo_dueno: "ownerOnly" };
const CATEGORIES: readonly FigureCategory[] = ["shape", "eyes", "eyewear", "accessory"];
const seed = () => Math.floor(Math.random() * 0xffffffff);

export function WelcomeCreator({ cliente, projectId, idioma, onCreated, onNotNow }: {
  cliente: ClienteDeOpenLen;
  /** Her home: the project on screen if it is yours, or your newest. */
  projectId: string;
  idioma: string;
  onCreated: (id: string) => void;
  onNotNow: () => void;
}) {
  const t = useTranslations("movil.asistente");
  const [name, setName] = useState("");
  const [look, setLook] = useState<FigureLook>(() => curatedLook(seed()));
  const [tone, setTone] = useState<AssistantTone>("friendly");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const ask = useCallback(() => figurasEncendidas(cliente), [cliente]);
  useAtras(true, onNotNow);

  /** One part changed; whatever the catalog would not take is not picked. */
  const pick = (patch: Partial<FigureLook>) => {
    const next = checkLook({ ...look, ...patch });
    if (next.ok) setLook(next.value);
  };
  const create = async () => {
    setSaving(true);
    setFailure(null);
    const r = await createAssistantFromPhone(cliente, { projectId, name, look, tone, locale: idioma });
    setSaving(false);
    if (r.ok) { onCreated(r.id); return; }
    setFailure(r.field === "name" ? "name" : (r.error && FAILURE_OF_CODE[r.error]) || "generic");
  };
  const tint = tintOf(look.color);
  const onHer = tint ? { background: tint.tint, color: tint.ink, boxShadow: `inset 0 0 0 1px ${tint.edge}` } : undefined;

  return (
    <section className="welcome lm-m lm-marca" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <header className="welcome-hero" style={{ background: `radial-gradient(120% 100% at 50% 0%, color-mix(in srgb, ${look.color} 24%, transparent), transparent 72%)` }}>
        <h1 id="welcome-title">{t("bienvenidaTitulo")}</h1>
        <p>{t("bienvenidaTexto")}</p>
        <LiveFigure look={look} size={132} ask={ask} label={name.trim() || undefined} />
        <button type="button" className="welcome-surprise" style={onHer} onClick={() => setLook(curatedLook(seed()))}>{t("own.creator.surprise")}</button>
      </header>
      <div className="welcome-body">
        <label className="welcome-label">
          {t("own.creator.name")}
          <input data-assistant-name="" value={name} maxLength={ASSISTANT_NAME_MAX} placeholder={t("own.creator.namePlaceholder")} aria-invalid={failure === "name" || undefined} onChange={(e) => setName(e.target.value)} />
        </label>
        {CATEGORIES.map((category) => (
          <fieldset key={category} className="welcome-set" data-figure-category={category}>
            <legend className="welcome-label">{t(`own.creator.${category}`)}</legend>
            <div className="welcome-options">
              {offered(category).map((id) => (
                <button key={id} type="button" aria-label={t(`own.creator.option.${category}.${id}`)} aria-pressed={look[category] === id} onClick={() => pick({ [category]: id })}>
                  <AssistantFigure look={{ ...look, [category]: id } as FigureLook} size={34} />
                </button>
              ))}
            </div>
          </fieldset>
        ))}
        <fieldset className="welcome-set">
          <legend className="welcome-label">{t("own.creator.color")}</legend>
          <div className="welcome-colors">
            {FIGURE_COLORS.map((c) => (
              <button key={c} type="button" aria-pressed={look.color === c} aria-label={t(`own.creator.colors.${c.slice(1)}`)} style={{ background: c }} onClick={() => pick({ color: c })} />
            ))}
            <label className="welcome-free" title={t("own.creator.freeColor")}>
              <input type="color" aria-label={t("own.creator.freeColor")} value={look.color} onChange={(e) => pick({ color: e.target.value })} />
            </label>
          </div>
        </fieldset>
        <fieldset className="welcome-set">
          <legend className="welcome-label">{t("own.creator.tone")}</legend>
          <div className="welcome-tones">
            {ASSISTANT_TONES.map((x) => (
              <button key={x} type="button" aria-pressed={tone === x} onClick={() => setTone(x)}>{t(`own.tones.${x}`)}</button>
            ))}
          </div>
        </fieldset>
      </div>
      <footer className="welcome-foot">
        {failure && <p role="alert">{t(`own.errors.${failure}`)}</p>}
        <button type="button" className="lm-btn lm-sec" data-welcome-not-now="" disabled={saving} onClick={onNotNow}>{t("ahoraNo")}</button>
        <button type="button" className="lm-btn lm-pri" data-assistant-done="" style={onHer} disabled={saving || name.trim() === ""} onClick={() => void create()}>{t("own.creator.done")}</button>
      </footer>
    </section>
  );
}
