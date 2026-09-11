import createMDX from "@next/mdx";

const withMDX = createMDX({ extension: /\.mdx$/ });

/** @type {import('next').NextConfig} */
export default withMDX({
  // Hay dos package-lock.json por encima (éste y el de la app) y Next no sabe
  // cuál es la raíz. La raíz es ésta.
  outputFileTracingRoot: import.meta.dirname,
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  pageExtensions: ["ts", "tsx"],
  reactStrictMode: true,
});

// ⚠️ `next dev` no puede pintar el CUERPO de un artículo.
//
// La portada y el índice van bien (200): sólo leen el `meta` del MDX. La página
// que llama a <Cuerpo /> da 500 con «Cannot read properties of undefined
// (reading 'recentlyCreatedOwnerStacks')»: el módulo .mdx queda fuera de la capa
// "rsc" de webpack, así que su `react/jsx-runtime` se resuelve a la copia de
// cliente mientras `react` es la del servidor, y _jsx pide unos internals que
// ahí no existen.
//
// Se probaron y NO lo arreglan: `development: false` en el loader (el
// jsx-runtime normal también es la build de desarrollo bajo next dev),
// `experimental.mdxRs` (mismo error, misma línea) y forzar `issuerLayer` en la
// regla del .mdx. El build de producción no pasa por ese camino y sale verde.
//
// Para VER un artículo: `npm run preview` (construye y sirve out/ en :4321).
