// lib/projects/cambios-para-el-agente.ts — el registro de cambios que ve el
// Agente, sacado de las versiones del proyecto.
//
// La etiqueta de cada versión, de qué página es y cuándo, del más nuevo al más
// viejo. Sobrevive a la ventana de la conversación, a recargar y a volver un mes
// después. Lo usan la ruta del Agente y el arnés de evals: una lista filtrada de
// dos formas dejaría a la batería leyendo un registro que el modelo no recibe.
//
// Puro a propósito: quien llama trae las versiones (`listVersions`) y decide qué
// hacer si la base falla.

export function cambiosParaElAgente(
  versiones: readonly { label: string; page: string | null; createdAt: Date }[],
): { label: string; page: string | null; createdAt: Date }[] {
  return (
    versiones
      // El «Before AI edit» es el respaldo que se guarda ANTES de cada cambio;
      // contarlo como cambio duplicaría el registro entero.
      .filter((v) => v.label && !/^Before AI edit/i.test(v.label))
      .map((v) => ({ label: v.label, page: v.page, createdAt: v.createdAt }))
  );
}
