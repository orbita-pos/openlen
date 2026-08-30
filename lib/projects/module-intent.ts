// ⚰️ EL PUENTE IA→MÓDULOS, RETIRADO el 2026-08-29.
//
// Qué hacía: cuando una página generada traía el marcador de un módulo, eso
// era la intención del creador dicha en lenguaje natural («un catálogo de
// productos»), así que encendíamos el módulo y el horneado de publicación
// metía el widget real en ese hueco.
//
// Por qué se va: al final sólo puenteaba UNO —`collections`— y las dos mitades
// que lo sostenían ya no existen. `lib/publish/collections-block.ts`, el
// horneado que este fichero citaba en su cabecera, se borró; y el prompt dejó
// de enseñarle el marcador al modelo (lo fija
// `lib/page-data/sin-vocabulario-colecciones.test.ts` sobre design-guidance).
// Encendía una bandera que nadie leía: publicar pasa `collections: false`
// PERMANENTE a `stripDisabledModuleBands`, así que la banda se limpiaba igual.
//
// NO HABÍA BUG VIVO, y merece decirse porque parecía haberlo: un puente que
// enciende un módulo sin horneador debería haber dejado el placeholder crudo
// en la página del usuario. No pasaba, porque el limpiador corre antes y con
// el interruptor en falso permanente.
//
// Lo que SIGUE en pie, y no es lo mismo:
//   · `strip-disabled-bands.ts` conserva a propósito los marcadores de los
//     módulos muertos, para que una banda heredada se borre sola al publicar.
//   · `module-placements.ts` sigue leyendo esos marcadores para el hub.
//
// Si algún día vuelve un módulo horneado, esto se reescribe: no es un patrón
// malo, es un patrón sin nada que puentear.
export {};
