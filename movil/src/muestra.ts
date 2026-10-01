// SÓLO DEV: un cliente de mentira con datos fijos, para revisar las pantallas
// en el navegador sin entrar, sin servidor y sin gastar (`?muestra=1`). Nunca
// se empaqueta: main.tsx sólo lo usa con `import.meta.env.DEV`.
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";

const PROYECTOS = [{ id: "m1", title: "Panadería Luna", subdomain: "panaderia-luna", publishedAt: "2026-09-29T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" }];
const HISTORIAL = [{ id: "t1", userText: "¿Cómo va?", assistantReasoning: "Le puse tus panes, un formulario para encargar pasteles y cómo llegar.", status: "applied" }];
const VISITAS = { vistas: 312, personas: 241, hoy: 27, porDia: [31, 38, 44, 71, 52, 48, 27].map((v, i) => ({ dia: `2026-09-${23 + i}`, vistas: v })), origen: { origen: "Instagram", deCadaDiez: 6 } };

export const clienteDeMuestra: ClienteDeOpenLen = {
  async pedir(ruta) {
    if (ruta === "/api/projects") return Response.json({ projects: PROYECTOS });
    if (ruta.startsWith("/api/projects/m1/preview")) return Response.json({ enabled: true, token: "muestra" });
    if (ruta === "/api/projects/m1") return Response.json({ project: { ...PROYECTOS[0], chatHistory: HISTORIAL } });
    if (ruta.startsWith("/api/voz/visitas")) return Response.json(VISITAS);
    return new Response(null, { status: 404 });
  },
  avisarAlCerrar() {},
};
