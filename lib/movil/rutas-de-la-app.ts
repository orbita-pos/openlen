// LA lista de rutas que aceptan la llave del teléfono (pieza 1). Una ruta que
// no está aquí sigue sólo con la sesión de la web. La prueba de al lado
// comprueba que cada una usa `usuarioDeLaPeticion` y exporta OPTIONS.
export const RUTAS_DE_LA_APP: readonly { fichero: string; metodos: readonly string[] }[] = [
  { fichero: "app/api/projects/route.ts", metodos: ["GET"] },
  { fichero: "app/api/projects/[id]/route.ts", metodos: ["GET"] },
  { fichero: "app/api/projects/[id]/preview/route.ts", metodos: ["GET", "POST"] },
  { fichero: "app/api/agent/route.ts", metodos: ["POST"] },
  { fichero: "app/api/agent/dirigir/route.ts", metodos: ["POST"] },
  { fichero: "app/api/agent/cancelar/route.ts", metodos: ["POST"] },
  { fichero: "app/api/agent/turno/[fila]/route.ts", metodos: ["GET"] },
  { fichero: "app/api/voz/sesion/route.ts", metodos: ["POST"] },
  { fichero: "app/api/voz/uso/route.ts", metodos: ["POST"] },
  { fichero: "app/api/voz/visitas/route.ts", metodos: ["GET"] },
  { fichero: "app/api/inbox/[conversationId]/reply/route.ts", metodos: ["POST"] },
  { fichero: "app/api/projects/[id]/publish/route.ts", metodos: ["POST"] },
  { fichero: "app/api/subdomains/check/route.ts", metodos: ["POST"] },
  { fichero: "app/api/movil/llave/route.ts", metodos: ["POST", "DELETE"] },
  { fichero: "app/api/movil/avisos/route.ts", metodos: ["GET", "POST", "DELETE"] },
  { fichero: "app/api/movil/entrega/route.ts", metodos: ["GET"] },
  { fichero: "app/api/movil/equipo/route.ts", metodos: ["GET", "POST"] },
  { fichero: "app/api/agent/encargo/route.ts", metodos: ["POST"] },
  // Pieza 2: la foto que le mandas a Len en el chat.
  { fichero: "app/api/upload/route.ts", metodos: ["POST"] },
  { fichero: "app/api/voz/nota/route.ts", metodos: ["POST"] },
  // Entregado y Tareas (spec local 2026-10-31-len-movil): lo que entregó Len y las tareas programadas.
  { fichero: "app/api/projects/[id]/deliveries/[turn]/[file]/route.ts", metodos: ["GET"] },
  { fichero: "app/api/projects/[id]/deliveries/[turn]/[file]/view/route.ts", metodos: ["POST"] },
  { fichero: "app/api/projects/[id]/scheduled-tasks/route.ts", metodos: ["GET"] },
  { fichero: "app/api/projects/[id]/scheduled-tasks/[taskId]/route.ts", metodos: ["PATCH", "DELETE"] },
  { fichero: "app/api/projects/[id]/scheduled-tasks/[taskId]/pause/route.ts", metodos: ["POST"] },
  { fichero: "app/api/movil/delivered/route.ts", metodos: ["GET"] },
  { fichero: "app/api/movil/tasks/route.ts", metodos: ["GET"] },
];
