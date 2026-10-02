// Copiar al portapapeles, con respaldo. Vivía dentro de `code-view.tsx`; sale
// aquí para que la lente «Terminal» copie con la MISMA función (la #14 de
// plans/len-agente-2026/notas/fase-5-taller.md).

/** Copiar al portapapeles con respaldo: `navigator.clipboard` no existe en
 *  contextos no seguros ni en navegadores viejos, y fallar en silencio al
 *  copiar es de las cosas que más molestan. */
export async function copiar(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* cae al respaldo */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
