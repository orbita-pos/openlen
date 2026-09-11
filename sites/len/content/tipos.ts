export type Portada = "primera" | "segunda" | "tercera";

export interface MetaArticulo {
  slug: string; // igual en en y es
  title: string;
  dek: string; // entradilla
  date: string; // YYYY-MM-DD
  category: string; // "Research"
  topic: string; // "Agentes", "Verificación"…
  cover: Portada;
  readingMinutes: number;
  author: string; // decisión abierta de la spec §8: "Equipo OpenLen" hasta que Jesús diga otra cosa
  cifra: { valor: string; nota: string; commit: string }; // la de «Lo último»
  indice: { id: string; texto: string }[];
}
