"use client";

// LEN HACE DE «O» EN EL TITULAR (09/10, sobre la portada de Grok Bot: «Meet ◉
// Grok Bot»). La cara de Len ya es un anillo, así que en vez de ir encima del
// titular se mete DENTRO, en el sitio de una letra.
//
// 🔴 LA LETRA LA ELIGE CADA IDIOMA, no este componente. En la traducción la
// «o» que se cambia va envuelta en `<len>o</len>` (es: «Tu pr<len>o</len>pio»),
// y la letra se queda en el DOM como texto para lectores de pantalla y para
// copiar: el titular sigue diciendo «propio». Un idioma sin «o» (de, ja, ko,
// zh) pone `<len></len>` vacío y la cara va suelta, como en la de Grok.
//
// Tamaño en `em`, para que siga al titular en los tres cortes de letra: el
// anillo de `cara.js` llena 54 de los 64 del lienzo, así que una caja de .84em
// deja un anillo de ~.71em, la altura de una mayúscula — la de Grok también
// es de mayúscula, no de minúscula. Saluda al entrar y luego sigue el cursor.

import { useEffect, useState, type ReactNode } from "react";
import { CaraDeLen, type EstadoDeLaCara } from "@/components/llamada/cara-de-len";

const GREETING_MS = 2400;

export function LenLetra({ children }: { children?: ReactNode }) {
  const [estado, setEstado] = useState<EstadoDeLaCara>("saludando");

  useEffect(() => {
    const id = window.setTimeout(() => setEstado("reposo"), GREETING_MS);
    return () => window.clearTimeout(id);
  }, []);

  const suelta = !children || (Array.isArray(children) && children.length === 0);

  return (
    <span className={suelta ? undefined : "-mx-[0.035em]"}>
      {!suelta && <span className="sr-only">{children}</span>}
      <span className="relative inline-block size-[0.84em] align-[-0.06em]" aria-hidden>
        <CaraDeLen estado={estado} props="none" className="absolute inset-0" />
      </span>
    </span>
  );
}
