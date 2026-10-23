import type { MDXComponents } from "mdx/types";
import { Abierto, Cifra, CifraGrande, EstadoPrincipio, Figura, Fuente } from "@/components/contenido";

import { ResultadosModelo } from "@/components/resultados-modelo";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return { ResultadosModelo, Abierto, Cifra, CifraGrande, EstadoPrincipio, Figura, Fuente, ...components };
}
