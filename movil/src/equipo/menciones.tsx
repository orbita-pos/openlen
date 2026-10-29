import { useId, useRef, useState } from "react";
import { arrobaEnCurso, opcionesDeMencion, ponerMencion, trozosConMenciones, colorDePersona, type PersonaMencionable } from "@/lib/workspace-v2/menciones";

export function TextoMenciones({ texto, personas }: { texto: string; personas: readonly PersonaMencionable[] }) {
  return <>{trozosConMenciones(texto, personas).map((p, i) => p.userId || p.len
    ? <span key={i} className="eq-mencion" data-mencion={p.len ? "len" : "persona"} style={{ color: p.len ? "var(--c-qr-ink,#B93F08)" : colorDePersona(p.userId!, personas.map(p => p.userId)) }}>{p.texto}</span>
    : <span key={i}>{p.texto}</span>)}</>;
}
export function CajaMenciones({ value, onChange, personas, conLen, disabled = false, label, placeholder, onEnviar }: {
  value: string; onChange: (texto: string) => void; personas: readonly PersonaMencionable[]; conLen: boolean; disabled?: boolean; label: string; placeholder: string; onEnviar: () => void;
}) {
  const campo = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(value.length);
  const [seleccion, setSeleccion] = useState(0);
  const [oculto, setOculto] = useState(false);
  const lista = useId();
  const buscando = arrobaEnCurso(value, Math.min(cursor, value.length));
  const opciones = !disabled && !oculto && buscando ? opcionesDeMencion(buscando.busca, personas, conLen) : [];
  const activa = Math.min(seleccion, Math.max(0, opciones.length - 1));
  const elegir = (etiqueta: string) => {
    if (!buscando) return;
    const nuevo = ponerMencion(value, buscando.desde, cursor, etiqueta);
    onChange(nuevo.texto); setCursor(nuevo.cursor); setOculto(true);
    requestAnimationFrame(() => { campo.current?.focus(); campo.current?.setSelectionRange(nuevo.cursor, nuevo.cursor); });
  };
  return <div className="eq-componer">
    {opciones.length > 0 && <div className="eq-opciones" role="listbox" id={lista} aria-label={label}>
      {opciones.map((p, i) => <button type="button" role="option" aria-selected={i === activa} id={`${lista}-${i}`} key={p.userId ?? "len"} onPointerDown={e => e.preventDefault()} onClick={() => elegir(p.etiqueta)}>
        <span className="eq-inicial" aria-hidden="true">{p.etiqueta.slice(0, 1)}</span><span>@{p.etiqueta}</span>
      </button>)}
    </div>}
    <textarea ref={campo} value={value} onChange={e => { onChange(e.target.value); setCursor(e.target.selectionStart); setSeleccion(0); setOculto(false); }} onSelect={e => { setCursor(e.currentTarget.selectionStart); setOculto(false); }}
      disabled={disabled} maxLength={4000} rows={2} aria-label={label} placeholder={placeholder} aria-autocomplete="list" aria-controls={opciones.length ? lista : undefined}
      aria-activedescendant={opciones.length ? `${lista}-${activa}` : undefined} autoComplete="off" enterKeyHint="send" onKeyDown={e => {
        if (e.nativeEvent.isComposing) return;
        if (opciones.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); setSeleccion((activa + (e.key === "ArrowDown" ? 1 : -1) + opciones.length) % opciones.length); }
        else if (opciones.length && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); elegir(opciones[activa].etiqueta); }
        else if (e.key === "Escape") { if (opciones.length) { e.preventDefault(); e.stopPropagation(); } setOculto(true); }
        else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onEnviar(); }
      }} />
  </div>;
}
