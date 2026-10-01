import { useTranslations } from "use-intl";

export function SinRed({ onReintentar }: { onReintentar: () => void }) {
  const t = useTranslations("movil.red");
  return (
    <section className="lm-layer lm-incoming lm-m lm-marca is-on">
      <div className="lm-inc-top"><b>Len</b><span>{t("sinRed")}</span></div>
      <div className="lm-inc-actions">
        <button type="button" className="lm-round lm-accept" onClick={onReintentar}><span />{t("reintentar")}</button>
      </div>
    </section>
  );
}
