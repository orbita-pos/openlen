import { behaviorsBakeEnabled, carouselBakeEnabled } from "@/lib/publish/kill-switches";

// Kill-switches de runtimes horneados, para el preview del editor (hallazgo
// Fable, 2026-07-13): el inyector del preview es client component y no puede
// leer process.env, así que OPENLEN_BEHAVIORS=0 apagaba el bake de publish
// pero el preview seguía inyectando — editor y publicado divergían vía la
// propia palanca de rollback. Este endpoint sirve EL MISMO predicado que
// consume filesystem.ts (lib/publish/kill-switches.ts): una palanca, dos
// mitades, cero divergencia posible.
//
// Sin auth a propósito: solo revela el estado de dos flags operativas (nada
// de datos de usuario), y el preview lo consulta al montar el workspace.
// force-dynamic + no-store: una palanca de incidente que se sirviera cacheada
// no sería una palanca.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return new Response(
    JSON.stringify({ behaviors: behaviorsBakeEnabled(), carousel: carouselBakeEnabled() }),
    { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
}
