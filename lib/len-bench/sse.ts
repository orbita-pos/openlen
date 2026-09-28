// lib/len-bench/sse.ts — el stream de /api/agent, leído como lo lee el panel.
//
// La ruta emite `event: <nombre>\ndata: <json>\n\n` (ver el kill-switch de
// app/api/agent/route.ts). Los trozos de red no respetan los límites de un
// evento, así que se acumula hasta el separador.

export interface EventoSse {
  readonly nombre: string;
  readonly datos: unknown;
}

export function crearLectorSse(): { empujar(trozo: string): EventoSse[] } {
  let buffer = "";
  return {
    empujar(trozo) {
      buffer += trozo.replace(/\r\n/g, "\n");
      const salida: EventoSse[] = [];
      let corte = buffer.indexOf("\n\n");
      while (corte !== -1) {
        const bloque = buffer.slice(0, corte);
        buffer = buffer.slice(corte + 2);
        let nombre = "message";
        const lineas: string[] = [];
        for (const l of bloque.split("\n")) {
          if (l.startsWith("event:")) nombre = l.slice(6).trim();
          else if (l.startsWith("data:")) lineas.push(l.slice(5).trimStart());
        }
        if (lineas.length > 0) {
          const crudo = lineas.join("\n");
          let datos: unknown = crudo;
          try {
            datos = JSON.parse(crudo);
          } catch {
            // no era JSON: se entrega el texto tal cual
          }
          salida.push({ nombre, datos });
        }
        corte = buffer.indexOf("\n\n");
      }
      return salida;
    },
  };
}
