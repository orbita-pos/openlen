// lib/apps/enrutador.ts — lo que una app web puede importar de `react-router`
// (y de `react-router-dom`, que en la v7 es el mismo paquete con otro nombre).
// D3 de la spec local docs/superpowers/specs/2026-10-07-apps-design.md.
//
// POR QUÉ UNA LISTA. Sin bundler, lo que el módulo exporta lo descarga entero
// cada visitante: la v7 trae también el modo «framework» (cookies, sesiones,
// render en servidor), que en una app estática sólo pesaría.
//
// 🔴 SIN `BrowserRouter`. Las pantallas de una app van por HASH (`#/ventas`),
// porque una ruta de camino (`/ventas`) recargada da 404 en el lienzo y en un
// dominio propio, y en el subdominio sirve la home con caché (H6 de la spec).
// Dejarlo fuera del módulo no basta para Len: el compilador lo nombra con
// `PISTAS_DEL_ENRUTADOR` y le dice qué usar en su lugar.
//
// 🔴 CONGELADO como `iconos.ts`: cambiar la lista cambia los bytes del módulo.
//
// Puro: lo leen el script del vendor, el compilador y las pruebas.

export const EXPORTS_DEL_ENRUTADOR = [
  // Componentes
  "HashRouter", "MemoryRouter", "Router", "Routes", "Route", "Link", "NavLink", "Navigate", "Outlet",
  // Hooks
  "useNavigate", "useParams", "useLocation", "useSearchParams", "useMatch", "useNavigationType", "useOutlet",
  "useOutletContext", "useResolvedPath", "useHref", "useInRouterContext", "useLinkClickHandler", "useRoutes",
  "useBeforeUnload",
  // Utilidades
  "NavigationType", "createSearchParams", "createPath", "parsePath", "generatePath", "matchPath", "matchRoutes",
  "resolvePath", "renderMatches", "createRoutesFromElements", "createRoutesFromChildren",
] as const;

const SIN_ROUTER_DE_DATOS =
  "data routers (loaders, actions, <Form>) are not available here: use <HashRouter> with <Routes>, and load data in the component (useEffect + supabase).";

/** Lo que el modelo escribe por reflejo y aquí no hay, con lo que va en su lugar.
 *  Lo dice el compilador en el error del import. */
export const PISTAS_DEL_ENRUTADOR: Readonly<Record<string, string>> = {
  BrowserRouter:
    "an app's screens are hash routes here (#/sales): use HashRouter. A path route (/sales) breaks when the published app is reloaded.",
  createBrowserRouter:
    "an app's screens are hash routes here (#/sales): use <HashRouter> with <Routes>. A path route (/sales) breaks when the published app is reloaded.",
  StaticRouter: "there is no server rendering here: use HashRouter.",
  ServerRouter: "there is no server rendering here: use HashRouter.",
  // ⚖️ LOS ROUTERS DE DATOS SE QUEDARON FUERA, medido el 2026-10-07: con ellos
  // el módulo pesa 34,5 KB comprimido; sin ellos, 16,7. Los modelos escriben
  // casi siempre el router declarativo, y una forma de hacer las pantallas es
  // mejor que dos.
  ...Object.fromEntries(
    [
      "createHashRouter", "createMemoryRouter", "RouterProvider", "useLoaderData", "useActionData", "useRouteLoaderData",
      "useRouteError", "useNavigation", "useFetcher", "useFetchers", "useSubmit", "useFormAction", "useRevalidator",
      "useAsyncValue", "useAsyncError", "useBlocker", "useMatches", "useViewTransitionState", "Form", "Await",
      "ScrollRestoration", "redirect", "redirectDocument", "data", "isRouteErrorResponse",
    ].map((n) => [n, SIN_ROUTER_DE_DATOS]),
  ),
};
