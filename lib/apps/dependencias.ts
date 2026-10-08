// lib/apps/dependencias.ts — lo que el código de una app web puede importar
// por su nombre (`import { useState } from "react"`).
//
// Es a las apps lo que `lib/librerias.ts` es a las páginas: una lista CORTA Y
// CERRADA, y cada entrada entra por una decisión explícita, porque es código de
// terceros que corre en el navegador de cada visitante (spec local
// docs/superpowers/specs/2026-10-07-apps-design.md, §5.3).
//
// CÓMO LLEGAN AL NAVEGADOR. Sin bundler (§2 de la spec): el navegador resuelve
// `"react"` con el import map que inyecta la plataforma (`lib/apps/documento.ts`)
// y lo pide a `/openlen/vendor/<catálogo>/<fichero>`, DEL MISMO ORIGEN que la
// página. No a un CDN: un módulo de otro origen exige CORS, y `libs.openlen.com`
// no lo manda (`ORIGEN_MANDA_CORS` en lib/librerias.ts); y los ojos de Len
// navegan detrás de un proxy de salida que cortaría a un tercero.
//
// POR QUÉ `/openlen/` Y NO `/assets/`. En el host del lienzo, Caddy reparte
// `/assets/*` entre el disco y Next según el ORDEN de sus `handle`, que cambia
// con la versión (lo cuenta el Caddyfile en el bloque del lienzo). Una raíz sin
// `handle` propio va a Next en el lienzo y a la release en la publicada, con
// cualquier versión. Está reservada en `lib/agent/ficheros/folder.ts`.
//
// 🔴 CONGELADO SIGNIFICA CONGELADO, como en `librerias.ts`: un catálogo
// publicado NUNCA cambia de bytes. Las apps lo fijan (`ProjectData.app`) y sus
// páginas publicadas lo cachean como inmutable. Versión nueva = catálogo nuevo;
// añadir una entrada a uno existente sí vale (no cambia ningún byte de lo que
// ya hay). Lo construye `npm run apps:vendor` y lo vigila su manifiesto.
//
// Puro y sin imports: lo leen el cliente, el servidor y las pruebas.

/** El catálogo con el que nace una app nueva. Las de `2026-10` se quedan en
 *  el suyo: un catálogo no se sube nunca bajo una app que ya existe. */
export const CATALOGO_ACTUAL = "2026-11";

/** Dónde se sirven, en el origen de la página (lienzo, medidor y publicada). */
export const RAIZ_VENDOR = "/openlen/vendor";

export interface Dependencia {
  /** Lo que el código escribe en el `import`. */
  readonly especificador: string;
  /** El fichero, dentro del catálogo. */
  readonly fichero: string;
  /** Para qué sirve, en una línea. EN INGLÉS: lo lee Len en su manual
   *  (`lib/agent/modo-app.ts`), y todo lo que lee Len va en inglés. */
  readonly para: string;
  /** Fuera del manual de Len: los `@radix-ui/react-*` sueltos (el manual
   *  nombra `radix-ui`, y la lista entera serían 27 líneas). */
  readonly hiddenFromManual?: true;
}

export interface Catalogo {
  /** Las versiones exactas que lo construyen. Informativo: los bytes los fija
   *  el manifiesto (`public/app-vendor/<catálogo>/manifest.json`). */
  readonly versiones: Readonly<Record<string, string>>;
  /** Lo que se puede importar por su nombre. */
  readonly dependencias: readonly Dependencia[];
  /** Ficheros que las fachadas importan y nadie nombra: el bundle compartido
   *  de React, que es lo que garantiza UNA sola copia (dos rompen los hooks).
   *  En un catálogo por partes, también sus trozos compartidos (`chunk-*`). */
  readonly internos: readonly string[];
  /** Construido con `splitting` de esbuild (2026-11 en adelante): lo que
   *  comparten sus paquetes —Radix entre sus primitivos— va en trozos
   *  `chunk-<huella>.js`, una sola copia. Sus paquetes salen de
   *  `scripts/app-catalog/<catálogo>/`, no de las dependencias del producto. */
  readonly split?: true;
}

/** Lo de `2026-10`, que `2026-11` repite tal cual (otros bytes: es otro catálogo). */
const BASICOS_2026_10: readonly Dependencia[] = [
  { especificador: "react", fichero: "react.js", para: "components, state and effects (useState, useEffect, useMemo…)." },
  { especificador: "react/jsx-runtime", fichero: "react-jsx-runtime.js", para: "the JSX runtime; the compiler uses it, you never import it." },
  { especificador: "react-dom", fichero: "react-dom.js", para: "createPortal and flushSync." },
  { especificador: "react-dom/client", fichero: "react-dom-client.js", para: "createRoot, to mount the app." },
  {
    especificador: "@supabase/supabase-js",
    fichero: "supabase-js.js",
    para: "the project's backend: database, Auth, Storage and Realtime.",
  },
  // Los dos nombres, el MISMO fichero: un solo módulo en el navegador, así
  // que un `<Link>` de uno funciona dentro del `<HashRouter>` del otro.
  { especificador: "react-router", fichero: "react-router.js", para: "the screens: HashRouter, Routes, Route, Link, NavLink, Navigate, Outlet, useNavigate, useParams, useLocation, useSearchParams." },
  { especificador: "react-router-dom", fichero: "react-router.js", para: "the same as react-router, by its older name." },
  { especificador: "lucide-react", fichero: "lucide-react.js", para: "icons as components (<ShoppingCart className=\"h-5 w-5\" />): a selection, not all of lucide." },
];

/** Los primitivos de Radix que importa la plantilla de Lovable, uno a uno
 *  (plans/app-catalog-and-bundler/catalog-list.md). */
const PRIMITIVOS_RADIX = [
  "accordion", "alert-dialog", "aspect-ratio", "avatar", "checkbox", "collapsible", "context-menu", "dialog",
  "dropdown-menu", "hover-card", "label", "menubar", "navigation-menu", "popover", "progress", "radio-group",
  "scroll-area", "select", "separator", "slider", "slot", "switch", "tabs", "toast", "toggle", "toggle-group", "tooltip",
] as const;

export const CATALOGOS: Readonly<Record<string, Catalogo>> = {
  "2026-10": {
    versiones: {
      react: "19.2.6",
      "react-dom": "19.2.6",
      "@supabase/supabase-js": "2.117.2",
      // D3 (2026-10-07): añadidos al catálogo ya construido SIN cambiar un byte
      // de lo que había (ficheros nuevos). La 8 de react-router pide React
      // 19.2.7, y éste se quedó en 19.2.6.
      "react-router": "7.18.4",
      "lucide-react": "1.16.0",
    },
    dependencias: BASICOS_2026_10,
    internos: ["react-todo.js"],
  },
  // 2026-11 (2026-10-08): lo que el modelo ha visto millones de veces —shadcn/ui
  // sobre Radix, formularios, gráficas—, contrastado con la plantilla de
  // Lovable y el registro de shadcn. Cada versión, la última de la línea mayor
  // con más código visto sobre Tailwind 3 (tailwind-merge 2: la 3 es Tailwind 4).
  "2026-11": {
    split: true,
    versiones: {
      react: "19.2.6",
      "react-dom": "19.2.6",
      "@supabase/supabase-js": "2.117.2",
      "react-router": "7.18.4",
      "lucide-react": "1.16.0",
      "radix-ui": "1.7.0",
      "class-variance-authority": "0.7.1",
      clsx: "2.1.1",
      "tailwind-merge": "2.6.1",
      sonner: "2.0.8",
      cmdk: "1.1.1",
      vaul: "1.1.2",
      "input-otp": "1.5.0",
      "react-resizable-panels": "2.1.9",
      "react-day-picker": "9.14.0",
      "embla-carousel-react": "8.6.0",
      "next-themes": "0.4.6",
      "react-hook-form": "7.89.0",
      zod: "3.25.76",
      "@hookform/resolvers": "5.9.1",
      "@tanstack/react-query": "5.104.1",
      "@tanstack/react-table": "8.21.3",
      "date-fns": "4.4.0",
      recharts: "2.15.4",
      "framer-motion": "12.43.0",
      zustand: "5.0.15",
      "react-markdown": "10.1.0",
      "@dnd-kit/core": "6.3.1",
      "@dnd-kit/sortable": "10.0.0",
      "@dnd-kit/utilities": "3.2.2",
    },
    dependencias: [
      ...BASICOS_2026_10,
      { especificador: "radix-ui", fichero: "radix-ui.js", para: "shadcn/ui's primitives in one package: import { Dialog, Select, Tabs, Popover, … } from \"radix-ui\"." },
      ...PRIMITIVOS_RADIX.map((p) => ({
        especificador: `@radix-ui/react-${p}`,
        fichero: `radix-${p}.js`,
        para: `the ${p} primitive, by its own package name.`,
        hiddenFromManual: true as const,
      })),
      { especificador: "class-variance-authority", fichero: "cva.js", para: "cva(): a component's variants (shadcn's buttonVariants)." },
      { especificador: "clsx", fichero: "clsx.js", para: "joins class names conditionally." },
      { especificador: "tailwind-merge", fichero: "tailwind-merge.js", para: "twMerge(): joins Tailwind classes, the last one wins (shadcn's cn())." },
      { especificador: "sonner", fichero: "sonner.js", para: "toasts: <Toaster /> once and toast(\"Saved\")." },
      { especificador: "cmdk", fichero: "cmdk.js", para: "a command palette / searchable list (shadcn's Command)." },
      { especificador: "vaul", fichero: "vaul.js", para: "a drawer that slides from the edge (shadcn's Drawer)." },
      { especificador: "input-otp", fichero: "input-otp.js", para: "a one-time-code input (shadcn's InputOTP)." },
      { especificador: "react-resizable-panels", fichero: "react-resizable-panels.js", para: "resizable panels: PanelGroup, Panel, PanelResizeHandle (shadcn's Resizable)." },
      { especificador: "react-day-picker", fichero: "react-day-picker.js", para: "a calendar / date picker, v9 (shadcn's Calendar)." },
      { especificador: "embla-carousel-react", fichero: "embla-carousel-react.js", para: "a carousel (shadcn's Carousel)." },
      { especificador: "next-themes", fichero: "next-themes.js", para: "light/dark mode with a class on <html>: ThemeProvider and useTheme (works without Next)." },
      { especificador: "react-hook-form", fichero: "react-hook-form.js", para: "forms: useForm, register, handleSubmit, Controller (shadcn's Form)." },
      { especificador: "zod", fichero: "zod.js", para: "schemas and validation, zod 3: import { z } from \"zod\"." },
      { especificador: "@hookform/resolvers/zod", fichero: "hookform-resolvers-zod.js", para: "zodResolver(schema), to validate react-hook-form with zod." },
      { especificador: "@tanstack/react-query", fichero: "tanstack-react-query.js", para: "server data with cache: QueryClient, QueryClientProvider, useQuery, useMutation." },
      { especificador: "@tanstack/react-table", fichero: "tanstack-react-table.js", para: "tables with sorting, filters and pages, v8: useReactTable (shadcn's data table)." },
      { especificador: "date-fns", fichero: "date-fns.js", para: "dates: format, addDays, differenceInDays, parseISO…" },
      { especificador: "date-fns/locale", fichero: "date-fns-locale.js", para: "date-fns locales: es, enUS, ptBR, fr, de, it, ja, ko, zhCN, nl." },
      { especificador: "recharts", fichero: "recharts.js", para: "charts, v2: ResponsiveContainer, BarChart, LineChart, AreaChart, PieChart, XAxis, YAxis, Tooltip (shadcn's Chart)." },
      { especificador: "framer-motion", fichero: "framer-motion.js", para: "animation: motion.div, AnimatePresence." },
      { especificador: "zustand", fichero: "zustand.js", para: "global state: create(set => ({ … }))." },
      { especificador: "react-markdown", fichero: "react-markdown.js", para: "renders Markdown as React: <Markdown>{text}</Markdown>." },
      { especificador: "@dnd-kit/core", fichero: "dnd-kit-core.js", para: "drag and drop: DndContext, useDraggable, useDroppable." },
      { especificador: "@dnd-kit/sortable", fichero: "dnd-kit-sortable.js", para: "sortable lists on top of @dnd-kit/core: SortableContext, useSortable, arrayMove." },
      { especificador: "@dnd-kit/utilities", fichero: "dnd-kit-utilities.js", para: "CSS.Transform.toString, for @dnd-kit/sortable." },
    ],
    // Los dice `apps:vendor` (falla si no coinciden): el bundle de React y los
    // trozos compartidos que salieron al construirlo.
    internos: [
      "react-todo.js", "chunk-34F6DBIR.js", "chunk-372SMDUN.js", "chunk-3SWLJQJU.js", "chunk-3U6KGMQ3.js",
      "chunk-4RWUZAXU.js", "chunk-4UZBUVTH.js", "chunk-56ATAJMT.js", "chunk-62BKVWDL.js", "chunk-6UV7RJM4.js",
      "chunk-6VB42BGT.js", "chunk-7TYZLV3H.js", "chunk-7WAQKVZL.js", "chunk-ADNURAZ6.js", "chunk-AF46URUN.js",
      "chunk-B7DKVD32.js", "chunk-BRSDINYB.js", "chunk-BY62C6TK.js", "chunk-EQ5WK4W3.js", "chunk-EU4FRXIQ.js",
      "chunk-FQBL6EBJ.js", "chunk-GW7FABX2.js", "chunk-H7F5EZEA.js", "chunk-HRMGAXDS.js", "chunk-HVEXWA6H.js",
      "chunk-ID2WAJCC.js", "chunk-IW4ZT76V.js", "chunk-JMIOB7KE.js", "chunk-JWZ42F3N.js", "chunk-KBXGJHKC.js",
      "chunk-KEYDD4IU.js", "chunk-LG6XFFPA.js", "chunk-LR6LRASC.js", "chunk-M6DSNJTG.js", "chunk-MDCN73Y2.js",
      "chunk-NPBILFG2.js", "chunk-NW73SLYW.js", "chunk-NXGV4OTP.js", "chunk-O3SQTLKD.js", "chunk-O4BOIGYJ.js",
      "chunk-OT3EQYXC.js", "chunk-PGJ3BYH4.js", "chunk-QLLIVM2G.js", "chunk-QQJGMNCS.js", "chunk-QY3WWN2B.js",
      "chunk-ROESIPS6.js", "chunk-RSNQAWR7.js", "chunk-RYX3G3MH.js", "chunk-SELI3SGU.js", "chunk-TAAPSV2F.js",
      "chunk-TNEF6B7G.js", "chunk-UIMWJGGU.js", "chunk-UNUATLZ5.js", "chunk-VY4JO6HK.js", "chunk-VZGQ62C7.js",
      "chunk-WESLAXZS.js", "chunk-WH2ZUHAC.js", "chunk-YJARNXFB.js",
    ],
  },
};

/** Los modos en que se sirve un catálogo. La vista (lienzo y ojos de Len) usa
 *  React de desarrollo, con sus mensajes de error enteros para que Len los
 *  lea; la publicada, el de producción. */
export type ModoVendor = "desarrollo" | "produccion";

export function catalogo(nombre: string): Catalogo | null {
  return Object.hasOwn(CATALOGOS, nombre) ? CATALOGOS[nombre]! : null;
}

/** `react` → la dependencia, o `null` si el catálogo no la tiene. */
export function dependenciaDe(nombreCatalogo: string, especificador: string): Dependencia | null {
  return catalogo(nombreCatalogo)?.dependencias.find((d) => d.especificador === especificador) ?? null;
}

export function rutaDeVendor(nombreCatalogo: string, fichero: string): string {
  return `${RAIZ_VENDOR}/${nombreCatalogo}/${fichero}`;
}

/** Todos los ficheros de un catálogo: los que se nombran y los internos. */
export function ficherosDelCatalogo(nombreCatalogo: string): string[] {
  const c = catalogo(nombreCatalogo);
  // Sin repetir: dos nombres pueden ser el mismo fichero (react-router-dom).
  return c ? [...new Set([...c.dependencias.map((d) => d.fichero), ...c.internos])] : [];
}

/** El import map de un catálogo: especificador → ruta del mismo origen. */
export function importMapDe(nombreCatalogo: string): { imports: Record<string, string> } {
  const c = catalogo(nombreCatalogo);
  const imports: Record<string, string> = {};
  for (const d of c?.dependencias ?? []) imports[d.especificador] = rutaDeVendor(nombreCatalogo, d.fichero);
  return { imports };
}

/** `/openlen/vendor/2026-10/react.js` → `{ catalogo, fichero }`, sólo si es
 *  un fichero REAL de un catálogo que existe. Lo demás, `null`. */
export function rutaDeVendorValida(ruta: string): { catalogo: string; fichero: string } | null {
  // MAYÚSCULAS también: esbuild nombra los trozos compartidos con su huella
  // (`chunk-5XKFJ2QK.js`). Igual sólo valen los ficheros REALES del catálogo.
  const m = /^\/openlen\/vendor\/([0-9]{4}-[0-9]{2}[a-z]?)\/([A-Za-z0-9-]+\.js)$/.exec(ruta);
  if (!m) return null;
  const [, nombre, fichero] = m;
  return ficherosDelCatalogo(nombre!).includes(fichero!) ? { catalogo: nombre!, fichero: fichero! } : null;
}
