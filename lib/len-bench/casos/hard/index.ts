// lib/len-bench/casos/hard/index.ts — el juego DIFÍCIL (plans/len-2/corridas/2026-10-03-dynamis).
//
// POR QUÉ EXISTE. Para comparar Len Dynamis con Len 2.5 como DeepSeek compara
// su Minimal con su Standard (`evaluation/README.md` de la ficha de V4.1): las
// mismas tareas, el mismo modelo, sólo cambia el modo, pruebas OCULTAS que dicen
// si lo pedido funciona y si lo que había sigue, y cada tarea repetida. Eso sólo
// discrimina con tareas donde el arnés de hoy FALLA: en dev, 2.5 ya saca 1,00 en
// 31 de 36 corridas de sus encargos grandes (techo).
//
// Tres encargos grandes, de varios mensajes y con JavaScript de verdad, sobre
// plantillas REALES de OpenLen: una tienda con filtro, buscador, carrito y
// pedido; un cotizador por pasos con descuento y un formulario que manda el
// presupuesto; y partir una página en un sitio de cinco. Escritos a mano y
// validados a $0 (`len-bench-validar.ts --juego=hard`); sin calibrar todavía con
// Len: si 2.5 también los saca siempre, no sirven y se dice.
//
// APARTE de dev, como `agente` y `resultados`, para que dev siga siendo
// comparable con todo lo medido antes.
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { crear as realStore } from "./real-store";
import { crear as quoteWizard } from "./quote-wizard";
import { crear as onePageToSite } from "./one-page-to-site";

const DEV = path.resolve("lib/len-bench/casos/dev/paginas");
const AGENTE = path.resolve("lib/len-bench/casos/agente/paginas");

export const ENCARGOS: Encargo[] = [realStore(DEV), quoteWizard(DEV), onePageToSite(AGENTE)];
