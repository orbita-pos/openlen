// LAS FUNCIONES QUE CORREN EN EL LIENZO (y en el Chromium de los ojos), para
// el modo Diseño. Viajan por `.toString()` con `decl`
// (components/workspace-v2/serializar-al-iframe.ts): cada una se basta sola
// —sin imports ni constantes del módulo— y llama a las demás por su nombre,
// que `decl` deja definido en la página.
//
// La técnica de subir por las fibras desde un nodo del DOM es la del script
// de Claude Code para sus sistemas de diseño: `__reactFiber$` →
// `fiber.return`. El origen de cada fibra lo apunta nuestro jsx-dev-runtime
// (`lib/apps/design/jsx-dev-runtime.ts`) con la clave `element.props`.

type Fibra = { return?: Fibra | null; memoizedProps?: unknown; type?: unknown } | null;
type Tabla = WeakMap<object, { path: string; line: number; site?: string }>;

export function sourceChainOf(node: Element, max: number): { path: string; line: number; component: string | null; site?: string }[] {
  const tabla = (window as unknown as { __openlenSources?: Tabla }).__openlenSources;
  const out: { path: string; line: number; component: string | null; site?: string }[] = [];
  if (!tabla) return out;
  const claves = Object.keys(node);
  let fibra: Fibra = null;
  for (let i = 0; i < claves.length; i++) {
    if (claves[i]!.indexOf("__reactFiber$") === 0) {
      fibra = (node as unknown as Record<string, Fibra>)[claves[i]!] ?? null;
      break;
    }
  }
  while (fibra && out.length < max) {
    const props = fibra.memoizedProps;
    const src = props && typeof props === "object" ? tabla.get(props as object) : undefined;
    if (src) {
      const t = fibra.type as { displayName?: string; name?: string; render?: { displayName?: string; name?: string } } | string | undefined;
      const component =
        typeof t === "string" || !t ? null : t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || null;
      const prev = out[out.length - 1];
      if (!prev || prev.path !== src.path || prev.line !== src.line) {
        out.push(src.site ? { path: src.path, line: src.line, component, site: src.site } : { path: src.path, line: src.line, component });
      }
    }
    fibra = fibra.return ?? null;
  }
  return out;
}

export function primaryOf(chain: readonly { path: string }[]): number {
  if (chain.length === 0) return -1;
  for (let i = 0; i < chain.length; i++) if (chain[i]!.path.indexOf("/components/ui/") === -1) return i;
  return 0;
}

export function ownTextOf(el: Element, max: number): string {
  let s = "";
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i]!;
    if (n.nodeType === 3) s += " " + (n.textContent ?? "");
  }
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) : s;
}

export function readStylesOf(el: Element, properties: readonly string[]): Record<string, string> {
  const cs = getComputedStyle(el);
  const out: Record<string, string> = {};
  for (let i = 0; i < properties.length; i++) out[properties[i]!] = cs.getPropertyValue(properties[i]!).trim();
  return out;
}

/** Los elementos de la pantalla cuyo eslabón principal es ése. Con `site`, sólo los
 *  de esa misma etiqueta del código (no la de al lado en la misma línea). */
export function targetsOf(path: string, line: number, tag: string, max: number, site?: string): Element[] {
  const todos = document.getElementsByTagName(tag);
  const out: Element[] = [];
  for (let i = 0; i < todos.length; i++) {
    const chain = sourceChainOf(todos[i]!, max);
    const p = primaryOf(chain);
    if (p >= 0 && chain[p]!.path === path && chain[p]!.line === line && (!site || chain[p]!.site === site)) out.push(todos[i]!);
  }
  return out;
}

/** THE CHAT'S «@» (spec local 2026-10-27): every element on the screen whose
 *  source chain passes through that line — the element written there, or the
 *  root of a component used there — keeping only the outermost (a component's
 *  insides share its use line). */
export function outermostAtLine(path: string, line: number, max: number): Element[] {
  // Top-down: an element that matches is taken and its insides are not walked
  // (a wrapper's line would otherwise match, and be checked, for everything in it).
  const hits: Element[] = [];
  const stack: Element[] = document.body ? [document.body] : [];
  while (stack.length > 0) {
    const el = stack.pop()!;
    if (el !== document.body) {
      const chain = sourceChainOf(el, max);
      let hit = false;
      for (let j = 0; j < chain.length && !hit; j++) hit = chain[j]!.path === path && chain[j]!.line === line;
      if (hit) {
        hits.push(el);
        continue;
      }
    }
    for (let c = el.lastElementChild; c; c = c.previousElementSibling) stack.push(c);
  }
  return hits;
}

export function boxOf(path: string, line: number, tag: string, max: number): { x: number; y: number; width: number; height: number } | null {
  const t = targetsOf(path, line, tag, max);
  if (t.length === 0) return null;
  t[0]!.scrollIntoView({ block: "center" });
  const r = t[0]!.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
}
