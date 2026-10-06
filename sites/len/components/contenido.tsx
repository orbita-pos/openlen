import type { ReactNode } from "react";
import { REPO } from "@/lib/seo";

export function Fuente({ commit, ruta }: { commit?: string; ruta?: string }) {
  // Las dos: el fichero TAL COMO ESTABA en ese commit. Un artículo con fecha
  // cita lo que había entonces, aunque después se borrara de `master`.
  if (commit && ruta)
    return (
      <a className="src" href={`${REPO}/blob/${commit}/${ruta}`}>
        {ruta}
      </a>
    );
  if (commit)
    return (
      <a className="src" href={`${REPO}/commit/${commit}`}>
        {commit.slice(0, 8)}
      </a>
    );
  return (
    <a className="src" href={`${REPO}/blob/master/${ruta}`}>
      {ruta}
    </a>
  );
}

export function Cifra({ valor, commit, children }: { valor: string; commit: string; children?: ReactNode }) {
  return (
    <span className="cifra">
      <strong>{valor}</strong>
      {children ? <> {children}</> : null} <Fuente commit={commit} />
    </span>
  );
}

export function CifraGrande({ valor, commit, children }: { valor: string; commit: string; children: ReactNode }) {
  return (
    <div className="big-item">
      <b>{valor}</b>
      <small>{children}</small>
      <Fuente commit={commit} />
    </div>
  );
}

export function Figura({ pie, children }: { pie: ReactNode; children: ReactNode }) {
  return (
    <figure className="fig">
      {children}
      <figcaption className="cap">{pie}</figcaption>
    </figure>
  );
}

export function Abierto({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <aside className="open" id={id}>
      <h3>{titulo}</h3>
      {children}
    </aside>
  );
}

const COLOR = {
  vigilado: "#2f9e5b",
  construccion: "#c9a227",
  medicion: "#c9a227",
  decision: "#6a645a",
  retirado: "#9a9284",
} as const;

export function EstadoPrincipio({ estado, children }: { estado: keyof typeof COLOR; children: ReactNode }) {
  return (
    <span className="chip">
      <i className="dot" style={{ background: COLOR[estado] }} />
      {children}
    </span>
  );
}
