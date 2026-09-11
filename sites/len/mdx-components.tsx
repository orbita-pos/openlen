import type { MDXComponents } from "mdx/types";
import { Abierto, Cifra, CifraGrande, EstadoPrincipio, Figura, Fuente } from "@/components/contenido";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return { Abierto, Cifra, CifraGrande, EstadoPrincipio, Figura, Fuente, ...components };
}
