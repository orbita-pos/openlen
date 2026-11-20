"use client";

// THE CODE LENS'S LABELS, one object for every place that opens it: the page workshop (`preview-area.tsx`) and the person's
// space (spec local 2026-11-19-agentes-para-todos, §6.2). Moved here word for word from preview-area.tsx; only the title
// knows where it is.
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";

import { MAX_SUBIDA } from "@/lib/workspace-v2/subir-ficheros";

import type { CodeView } from "./code-view";

/** Las frases de CodeMirror que se ven en la lente «Código» (buscar y
 *  reemplazar, ir a la línea, plegar), por su texto en inglés; su traducción
 *  está en `preview.ide.editor`, con `_` en vez de espacios. */
const FRASES_DEL_EDITOR = [
  "Find",
  "Replace",
  "next",
  "previous",
  "all",
  "match case",
  "regexp",
  "by word",
  "replace",
  "replace all",
  "close",
  "Go to line",
  "go",
  "Fold line",
  "Unfold line",
] as const;

export type CodeViewLabels = ComponentProps<typeof CodeView>["labels"];

/** `page` and `app`: the workshop's lens; `space`: the person's space, titled «Ficheros». */
export function useCodeViewLabels(kind: "page" | "app" | "space"): CodeViewLabels {
  const t = useTranslations("wsChrome");
  return {
    comentar: {
      comentarLinea: (n: number) => t("preview.comentar.linea", { n }),
      placeholder: t("preview.comentar.placeholder"),
      anadir: t("preview.comentar.anadir"),
      cancelar: t("preview.comentar.cancelar"),
      quitar: t("preview.comentar.quitar"),
      enElMensaje: t("preview.comentar.enElMensaje"),
      tope: t("preview.comentar.tope"),
    },
    editar: {
      guardar: t("preview.editar.guardar"),
      guardando: t("preview.editar.guardando"),
      cargando: t("preview.editar.cargando"),
      cambio: t("preview.editar.cambio"),
      cargarAhora: t("preview.editar.cargarAhora"),
      rechazado: t("preview.editar.rechazado"),
      error: t("preview.editar.error"),
      nota: t("preview.editar.nota"),
    },
    ide: {
      nuevoArchivo: t("preview.ide.nuevoArchivo"),
      nuevaCarpeta: t("preview.ide.nuevaCarpeta"),
      contraer: t("preview.ide.contraer"),
      actualizar: t("preview.ide.actualizar"),
      acciones: t("preview.ide.acciones"),
      renombrar: t("preview.ide.renombrar"),
      borrar: t("preview.ide.borrar"),
      copiarRuta: t("preview.ide.copiarRuta"),
      nombre: t("preview.ide.nombre"),
      nombreInvalido: t("preview.ide.nombreInvalido"),
      existe: (ruta: string) => t("preview.ide.existe", { ruta }),
      pagina: t("preview.ide.pagina"),
      portada: t("preview.ide.portada"),
      confirmarBorrar: (ruta: string) => t("preview.ide.confirmarBorrar", { ruta }),
      confirmarBorrarCarpeta: (ruta: string) => t("preview.ide.confirmarBorrarCarpeta", { ruta }),
      confirmarCerrar: (nombre: string) => t("preview.ide.confirmarCerrar", { nombre }),
      cerrarPestana: t("preview.ide.cerrarPestana"),
      sinGuardar: t("preview.ide.sinGuardar"),
      vacio: t("preview.ide.vacio"),
      comentarAyuda: t("preview.ide.comentarAyuda"),
      carpetaVacia: t("preview.ide.carpetaVacia"),
      cerrarAviso: t("preview.ide.cerrarAviso"),
      noSeHizo: t("preview.ide.noSeHizo"),
      dividir: t("preview.ide.dividir"),
      abrirAlLado: t("preview.ide.abrirAlLado"),
      subidos: (count: number) => t("preview.ide.subidos", { count }),
      noSubidos: t("preview.ide.noSubidos"),
      motivo: {
        grande: t("preview.ide.motivoGrande"),
        nombre: t("preview.ide.motivoNombre"),
        demasiados: t("preview.ide.motivoDemasiados", { max: MAX_SUBIDA }),
      },
      reemplazar: (count: number, lista: string) => t("preview.ide.reemplazar", { count, lista }),
      subiendo: t("preview.ide.subiendo"),
      binario: (size: string) => t("preview.ide.binario", { size }),
      descargar: t("preview.ide.descargar"),
      hilos: {
        placeholder: t("preview.ide.hilos.placeholder"),
        comentar: t("preview.ide.hilos.comentar"),
        responder: t("preview.ide.hilos.responder"),
        placeholderRespuesta: t("preview.ide.hilos.placeholderRespuesta"),
        resolver: t("preview.ide.hilos.resolver"),
        reabrir: t("preview.ide.hilos.reabrir"),
        resuelto: t("preview.ide.hilos.resuelto"),
        len: t("preview.ide.hilos.len"),
        trabajando: t("preview.ide.hilos.trabajando"),
        soloEditoresLen: t("preview.ide.hilos.soloEditoresLen"),
        error: t("preview.ide.hilos.error"),
      },
      mencionado: t("preview.ide.hilos.mencionado"),
      frasesDelEditor: Object.fromEntries(
        FRASES_DEL_EDITOR.map((f) => [f, t(`preview.ide.editor.${f.replace(/ /g, "_")}`)]),
      ),
    },
    noEsta: t("preview.code.noEsta"),
    buscar: t("preview.code.buscar"),
    limpiar: t("preview.code.limpiar"),
    porNombre: t("preview.code.porNombre"),
    enFicheros: t("preview.code.enFicheros"),
    sinResultados: (q: string) => t("preview.code.sinResultados", { q }),
    masCoincidencias: (count: number) => t("preview.code.masCoincidencias", { count }),
    sinContenido: (count: number) => t("preview.code.sinContenido", { count }),
    marcaNuevo: t("preview.code.marcaNuevo"),
    marcaCambiado: t("preview.code.marcaCambiado"),
    title: kind === "space" ? t("space.files") : kind === "app" ? t("preview.code.titleApp") : t("preview.code.title"),
    envVars: t("preview.code.envVars"),
    close: t("preview.code.close"),
    copy: t("preview.code.copy"),
    copied: t("preview.code.copied"),
    document: t("preview.code.document"),
    lines: t("preview.code.lines"),
    files: t("preview.code.files"),
    loading: t("preview.code.loading"),
    loadError: t("preview.code.loadError"),
    readOnly: t("preview.code.readOnly"),
  };
}
