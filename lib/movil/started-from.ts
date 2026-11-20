// De dónde viene una petición que empieza un inicio de sesión de un conector (spec local
// 2026-11-17-oauth-de-conectores-mcp, revisión final F5): con «Authorization» es la llave del teléfono —`usuarioDeLaPeticion`
// no cae a la cookie si la trae—, y sin ella, la sesión de la web. La vuelta trata distinto a cada una.
export function startedFromOf(req: Request): "web" | "phone" {
  return req.headers.get("authorization") !== null ? "phone" : "web";
}
