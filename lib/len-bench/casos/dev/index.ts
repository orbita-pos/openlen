// lib/len-bench/casos/dev/index.ts — el juego DEV.
// Generado por scripts/len-bench-repartir.ts: las tandas y sus semillas están en plans/len-2/reparto.md.
import path from "node:path";
import type { Encargo } from "@/lib/len-bench/tipos";
import { crear as taqueriaMenuWhatsapp } from "./taqueria-menu-whatsapp";
import { crear as textoSobreLaFoto } from "./texto-sobre-la-foto";
import { crear as telefonoNuevoSinLada } from "./telefono-nuevo-sin-lada";
import { crear as claseQueSeQuita } from "./clase-que-se-quita";
import { crear as botonQueNoHaceNada } from "./boton-que-no-hace-nada";
import { crear as graficaSinNumeros } from "./grafica-sin-numeros";
import { crear as cambialoYPublicalo } from "./cambialo-y-publicalo";
import { crear as listaDeEspera } from "./lista-de-espera";
import { crear as resenasQueNoDio } from "./resenas-que-no-dio";
import { crear as preciosYWhatsappDeLaFicha } from "./precios-y-whatsapp-de-la-ficha";
import { crear as carritoQueRecuerda } from "./carrito-que-recuerda";
import { crear as pagoConTarjeta } from "./pago-con-tarjeta";
import { crear as presupuestoQueLlega } from "./presupuesto-que-llega";
import { crear as precioDeLaCompetencia } from "./precio-de-la-competencia";
import { crear as tourNuevoSinDatos } from "./tour-nuevo-sin-datos";
import { crear as academiaPorCategorias } from "./academia-por-categorias";
import { crear as whatsappEnLasCuatro } from "./whatsapp-en-las-cuatro";
import { crear as propiedadVendida } from "./propiedad-vendida";
import { crear as cifraDeLaOng } from "./cifra-de-la-ong";
import { crear as calculadoraDelTaller } from "./calculadora-del-taller";
import { crear as reservasSinMotor } from "./reservas-sin-motor";
import { crear as tiendaQueCrece } from "./tienda-que-crece";
import { crear as puntoDeVenta } from "./punto-de-venta";
import { crear as sitioQueSeMuda } from "./sitio-que-se-muda";
import { crear as oficinaYWhatsapp } from "./oficina-y-whatsapp";
import { crear as subeTodoDiez } from "./sube-todo-diez";
import { crear as quitarProductoEnTodasPartes } from "./quitar-producto-en-todas-partes";
import { crear as encargoGrande } from "./encargo-grande";
import { crear as nombreNuevo } from "./nombre-nuevo";
import { crear as codigoDeDescuento } from "./codigo-de-descuento";
import { crear as pedidoMinimo } from "./pedido-minimo";
// Añadidos a mano (no vienen del reparto): los casos de las apps.
import { crear as posDeCafeteria } from "./pos-de-cafeteria";
import { crear as paginaQueSeVuelveApp } from "./pagina-que-se-vuelve-app";

const DIR = path.resolve("lib/len-bench/casos/dev/paginas");

export const ENCARGOS: Encargo[] = [
  taqueriaMenuWhatsapp(DIR),
  textoSobreLaFoto(DIR),
  telefonoNuevoSinLada(DIR),
  claseQueSeQuita(DIR),
  botonQueNoHaceNada(DIR),
  graficaSinNumeros(DIR),
  cambialoYPublicalo(DIR),
  listaDeEspera(DIR),
  resenasQueNoDio(DIR),
  preciosYWhatsappDeLaFicha(DIR),
  carritoQueRecuerda(DIR),
  pagoConTarjeta(DIR),
  presupuestoQueLlega(DIR),
  precioDeLaCompetencia(DIR),
  tourNuevoSinDatos(DIR),
  academiaPorCategorias(DIR),
  whatsappEnLasCuatro(DIR),
  propiedadVendida(DIR),
  cifraDeLaOng(DIR),
  calculadoraDelTaller(DIR),
  reservasSinMotor(DIR),
  tiendaQueCrece(DIR),
  puntoDeVenta(DIR),
  sitioQueSeMuda(DIR),
  oficinaYWhatsapp(DIR),
  subeTodoDiez(DIR),
  quitarProductoEnTodasPartes(DIR),
  encargoGrande(DIR),
  nombreNuevo(DIR),
  codigoDeDescuento(DIR),
  pedidoMinimo(DIR),
  posDeCafeteria(),
  paginaQueSeVuelveApp(),
];
