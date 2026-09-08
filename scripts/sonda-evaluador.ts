// scripts/sonda-evaluador.ts — ¿puede un evaluador APARTE juzgar una condición
// leyendo sólo el transcript de un turno de Len?
//
// SONDA, no producto. Su salida es una respuesta, no código que se queda.
//
//   npm run sonda:evaluador
//
// Gasta unos céntimos: son llamadas cortas en el papel barato (reasoner), NO en
// el de Len. Que sean dos modelos distintos es el punto entero.

import { evaluarCondicion } from "@/lib/agent/objetivo/evaluar-condicion";

interface Caso {
  readonly id: string;
  readonly condicion: string;
  readonly transcript: string;
  /** Lo que el ARTEFACTO demuestra. La única verdad. */
  readonly esperado: "cumplida" | "no_cumplida" | "imposible";
  readonly porque: string;
}

// El bloque que el modelo ve de verdad tras editar (lib/agent/aviso-medido.ts).
const medido = (lineas: string[]) =>
  [
    "<medido-tras-editar>",
    "El navegador midió la página que acabas de guardar. Esto es lo que salió NUEVO en esta medición:",
    ...lineas.map((l) => "- " + l),
    "</medido-tras-editar>",
  ].join("$NL$");

const CASOS: readonly Caso[] = [
  {
    id: "evidencia-concuerda",
    condicion: "el titular de la página dice «Vitalvet»",
    transcript: [
      "USUARIO: cambiame el titular a Vitalvet",
      'HERRAMIENTA editar_texto → {"ok":true,"cambio":"cambio","texto_nuevo":"Vitalvet"}',
      "DOCUMENTO GUARDADO: <h1>Vitalvet</h1>",
      "AGENTE: Listo, el titular ya dice Vitalvet.",
    ].join("$NL$"),
    esperado: "cumplida",
    porque: "la herramienta movió bytes y el documento lo enseña",
  },
  {
    id: "solo-el-relato",
    condicion: "el titular de la página dice «Vitalvet»",
    transcript: [
      "USUARIO: cambiame el titular a Vitalvet",
      "AGENTE: Listo, el titular ya dice Vitalvet.",
    ].join("$NL$"),
    esperado: "no_cumplida",
    porque: "🔴 EL BRAZO DE CONTROL: no hay una sola evidencia, sólo el relato",
  },
  {
    id: "la-medicion-lo-desmiente",
    condicion: "la página no desborda en móvil",
    transcript: [
      "USUARIO: arregla que se sale en el móvil",
      'HERRAMIENTA editar_pagina → {"ok":true,"cambio":"cambio"}',
      medido(["Una caja se sale de la pantalla en móvil [data-op-id=n7]"]),
      "AGENTE: Listo, ya no se sale en móvil.",
    ].join("$NL$"),
    esperado: "no_cumplida",
    porque: "🔴 la medición contradice al agente EN EL MISMO transcript",
  },
  {
    id: "el-silencio-no-es-evidencia",
    condicion: "la página no desborda en móvil",
    transcript: [
      "USUARIO: arregla que se sale en el móvil",
      'HERRAMIENTA editar_pagina → {"ok":true,"cambio":"cambio"}',
      "AGENTE: Listo, ya no se sale en móvil.",
    ].join("$NL$"),
    esperado: "no_cumplida",
    porque: "editó algo, pero NADA dice que el desborde se fuera — nuestras mediciones sólo hablan de defectos",
  },
  // ── LA OTRA DIRECCIÓN ────────────────────────────────────────────────────
  // Un evaluador demasiado estricto deja a Len trabajando para siempre sobre
  // algo ya cumplido. Estos tres tienen que salir "cumplida".
  {
    id: "medicion-limpia",
    condicion: "la página no desborda en móvil (la medición del navegador no lo reporta)",
    transcript: [
      "USUARIO: arregla que se sale en el movil",
      'HERRAMIENTA editar_pagina → {"ok":true,"cambio":"cambio"}',
      "<medido-tras-editar>",
      "El navegador midió la página que acabas de guardar: 0 desbordes en móvil, 0 textos ilegibles, 0 enlaces rotos.",
      "</medido-tras-editar>",
      "AGENTE: Listo.",
    ].join("\n"),
    esperado: "cumplida",
    porque: "hay una medición POSITIVA y explícita",
  },
  {
    id: "evidencia-en-turno-anterior",
    condicion: "existe una página /servicios en el sitio",
    transcript: [
      "USUARIO: creame una pagina de servicios",
      'HERRAMIENTA crear_pagina → {"ok":true,"slug":"servicios","cambio":"cambio"}',
      "AGENTE: Hecha.",
      "USUARIO: gracias, y ponle el telefono al pie",
      'HERRAMIENTA editar_texto → {"ok":true,"cambio":"cambio"}',
      "AGENTE: Puesto.",
    ].join("\n"),
    esperado: "cumplida",
    porque: "la evidencia está dos turnos atrás, no en el último",
  },
  {
    id: "evidencia-sin-que-el-agente-la-cante",
    condicion: "el pie de la página lleva el teléfono 33 1234 5678",
    transcript: [
      "USUARIO: pon mi telefono 33 1234 5678 abajo",
      'HERRAMIENTA editar_texto → {"ok":true,"cambio":"cambio"}',
      "DOCUMENTO GUARDADO: <footer><p>Tel. 33 1234 5678</p></footer>",
      "AGENTE: ¿Algo más?",
    ].join("\n"),
    esperado: "cumplida",
    porque: "el agente NO lo presume, pero el documento lo demuestra",
  },
  {
    id: "imposible",
    condicion: "la página cobra con tarjeta desde el propio sitio",
    transcript: [
      "USUARIO: quiero cobrar las consultas con tarjeta",
      "AGENTE: Para cobrar de verdad necesito tu enlace de pago de Stripe. OpenLen no tiene pasarela propia.",
    ].join("$NL$"),
    esperado: "imposible",
    porque: "el producto no lo hace, y el transcript lo dice",
  },
];

async function main() {
  let aciertos = 0;
  for (const c of CASOS) {
    const r = await evaluarCondicion({ condicion: c.condicion, transcript: c.transcript });
    if (!r.ok) {
      console.log(`FALLO  ${c.id.padEnd(26)} el evaluador no contestó: ${r.motivo}`);
      continue;
    }
    const bien = r.resultado.veredicto === c.esperado;
    if (bien) aciertos += 1;
    console.log(
      `${bien ? "OK   " : "MAL  "} ${c.id.padEnd(26)} dijo=${r.resultado.veredicto.padEnd(12)} esperado=${c.esperado}`,
    );
    console.log(`       razón: ${r.resultado.razon}`);
    if (!bien) console.log(`       ↳ ${c.porque}`);
  }
  console.log(`${"".padEnd(2)}${aciertos}/${CASOS.length} aciertos`);
}

main().then(() => process.exit(0));
