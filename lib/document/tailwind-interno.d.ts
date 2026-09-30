// El módulo interno de Tailwind v3 que crea el contexto del compilador. No trae
// tipos propios; esto declara SÓLO lo que usa `clases-de-tailwind.ts`. Es la
// misma entrada que usa el plugin oficial de Prettier para ordenar clases.
declare module "tailwindcss/lib/lib/setupContextUtils" {
  export interface ContextoTailwind {
    /** Cada clase con su orden en la hoja; `null` si Tailwind no genera nada para ella. */
    getClassOrder(clases: string[]): [string, bigint | null][];
  }
  export function createContext(configResuelta: unknown): ContextoTailwind;
}

// El `resolveConfig` de dentro del paquete. Se usa éste y no la entrada pública
// `tailwindcss/resolveConfig` porque es el que el propio Tailwind carga, así
// que viaja al build de producción con él: medido el 2026-09-29, el standalone
// trae `lib/public/resolve-config.js` y NO `resolveConfig.js`.
declare module "tailwindcss/lib/public/resolve-config" {
  const resolveConfig: (config: unknown) => unknown;
  export default resolveConfig;
}
