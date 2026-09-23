// lib/agent/lista-de-tareas.ts — la lista de tareas del turno, con su estado,
// pasada por la evidencia.
//
// 🔴 EL FALLO QUE CIERRA (H02 de `plans/auditoria-len-vs-claude-code-2026-09-22.md`).
// `declarar_tareas` era una lista de frases que se casaba con las llamadas POR
// ORDEN: con tres tareas y dos cambios, faltaba «la tercera», fuera cual fuera.
// El modelo hacía A y C, y el reclamo le decía que faltaba C (G2). Y una tarea de
// COMPROBAR no podía tener evidencia jamás, porque sólo contaban las mutaciones:
// producción la declaró el 19/09 («Probar que añadir, sumar y quitar
// funcionan») y el reclamo le exigió un cambio. El prompt, mientras, prometía
// «las que no la tengan te las digo por su nombre» — que no era verdad.
//
// LA VARA ES CLAUDE CODE: la lista la mantiene el MODELO, con un estado por
// tarea (pendiente, en curso, hecha), y se le devuelve CON sus estados. No se
// adivina cuál falta: cada tarea lleva el suyo.
//
// Y AQUÍ LEN SUPERA A LA VARA, porque el servidor ve lo que allí sólo afirma el
// modelo: una llamada que cambia algo cuenta para la tarea que está EN CURSO en
// ese momento, y marcar una «hecha» sin nada detrás no se acepta. Una tarea de
// comprobar se da por hecha también con una lectura, y cualquier otra también
// cuando en el turno ya hubo un cambio (ver `anotarLectura`).
//
// SI EL MODELO NO USA ESTADOS, no se inventa nada: se cuenta, y si faltan
// cambios se le enseña la lista entera diciendo que no se sabe cuál es. Nombrar
// una por su posición sería afirmar un emparejamiento que nadie midió.
//
// Puro: el bucle le cuenta qué pasó, y ella contesta.

export type EstadoDeTarea = "pendiente" | "en_curso" | "hecha";

/** Una tarea tal y como la manda el modelo. `estado` ausente ⇒ la que ya
 *  tenía, o `pendiente` si es nueva. */
export interface TareaDeclarada {
  readonly texto: string;
  readonly estado?: EstadoDeTarea;
  readonly comprobar?: boolean;
}

interface Tarea {
  readonly texto: string;
  estado: EstadoDeTarea;
  readonly comprobar: boolean;
  /** Llamadas que cambiaron algo mientras esta tarea estaba en curso. */
  cambios: number;
  /** Lecturas que salieron bien mientras esta tarea estaba en curso y que
   *  cuentan: ver `anotarLectura`. */
  lecturas: number;
}

const clave = (t: string) => t.trim().toLowerCase();

export class ListaDeTareas {
  private tareas: Tarea[] = [];
  /** ¿El modelo marcó alguna vez una tarea como en curso o hecha? Una lista
   *  toda en `pendiente` es una lista sin estados, por mucho que los traiga. */
  private conEstados = false;
  /** Cambios hechos sin ninguna tarea en curso: no se sabe de cuál son. */
  private sueltos = 0;
  private cambiosTotales = 0;

  get vacia(): boolean {
    return this.tareas.length === 0;
  }

  get textos(): string[] {
    return this.tareas.map((t) => t.texto);
  }

  /**
   * El modelo manda la lista (entera, como en Claude Code). Se conserva lo que
   * ya se había medido de cada tarea —por su texto— y se comprueba cada «hecha»
   * nueva. Devuelve la lista como queda y las que se negaron.
   */
  declarar(lista: readonly TareaDeclarada[]): {
    readonly tareas: readonly { readonly tarea: string; readonly estado: EstadoDeTarea }[];
    readonly sinEvidencia: readonly string[];
  } {
    const previas = new Map(this.tareas.map((t) => [clave(t.texto), t]));
    const nuevas: Tarea[] = [];
    const porConfirmar: Tarea[] = [];
    for (const d of lista) {
      const previa = previas.get(clave(d.texto));
      const tarea: Tarea = {
        texto: d.texto,
        estado: previa?.estado ?? "pendiente",
        comprobar: d.comprobar ?? previa?.comprobar ?? false,
        cambios: previa?.cambios ?? 0,
        lecturas: previa?.lecturas ?? 0,
      };
      const pedido = d.estado ?? tarea.estado;
      if (pedido !== "pendiente") this.conEstados = true;
      if (pedido === "hecha" && tarea.estado !== "hecha") {
        if (tarea.cambios > 0 || tarea.lecturas > 0) tarea.estado = "hecha";
        else porConfirmar.push(tarea);
      } else {
        tarea.estado = pedido;
      }
      nuevas.push(tarea);
    }
    // LAS QUE SE MARCAN HECHAS SIN NADA DETRÁS. Si hay cambios sueltos —hechos
    // sin ninguna tarea en curso— para todas, se aceptan: la cuenta cuadra. Si
    // no hay para todas, no se acepta ninguna, porque no hay forma de saber
    // cuál es la que falta.
    const sinEvidencia: string[] = [];
    if (porConfirmar.length > 0) {
      if (this.sueltos >= porConfirmar.length) {
        this.sueltos -= porConfirmar.length;
        for (const t of porConfirmar) t.estado = "hecha";
      } else {
        for (const t of porConfirmar) sinEvidencia.push(t.texto);
      }
    }
    this.tareas = nuevas;
    return { tareas: nuevas.map((t) => ({ tarea: t.texto, estado: t.estado })), sinEvidencia };
  }

  /** Una llamada cambió algo de verdad. Cuenta para la tarea en curso. */
  anotarCambio(): void {
    this.cambiosTotales += 1;
    const enCurso = this.tareas.find((t) => t.estado === "en_curso");
    if (enCurso) enCurso.cambios += 1;
    else this.sueltos += 1;
  }

  /**
   * Una lectura salió bien. Cuenta para la tarea en curso si es de comprobar,
   * o si en el turno YA HUBO un cambio real.
   *
   * 🔴 LO SEGUNDO ES LA SALIDA DE UN CASO NORMAL (revisión pre-deploy del
   * 2026-09-22): una misma llamada hace a menudo el trabajo de dos tareas, y el
   * cambio sólo cuenta para la que estaba en curso. La otra no tenía cómo
   * probarse y se reclamaba como pendiente — con el riesgo de que el modelo la
   * repitiera. Ponerla en curso y mirarla en la página es comprobar que ya está.
   *
   * Sin ningún cambio en el turno, una lectura no confirma nada: no hubo trabajo
   * que pudiera cubrirla. Ahí nos apartamos de Claude Code, que se fía del
   * estado que declara el modelo; aquí la evidencia la pone el servidor, y una
   * lectura sólo vale cuando detrás hubo algo que leer.
   */
  anotarLectura(): void {
    const enCurso = this.tareas.find((t) => t.estado === "en_curso");
    if (enCurso && (enCurso.comprobar || this.cambiosTotales > 0)) enCurso.lecturas += 1;
  }

  /**
   * LO QUE FALTA AL CERRAR, y si se sabe cuál es.
   *
   * Con estados, las que no están hechas, por su nombre. Sin estados, sólo se
   * puede contar: si hay menos cambios que tareas que piden un cambio, falta
   * algo — y se dice que no se sabe qué.
   */
  pendientes(): { readonly faltan: boolean; readonly nombradas: readonly string[]; readonly todas: readonly string[] } {
    if (this.tareas.length === 0) return { faltan: false, nombradas: [], todas: [] };
    if (this.conEstados) {
      const nombradas = this.tareas.filter((t) => t.estado !== "hecha").map((t) => t.texto);
      return { faltan: nombradas.length > 0, nombradas, todas: this.textos };
    }
    const piden = this.tareas.filter((t) => !t.comprobar).length;
    return { faltan: this.cambiosTotales < piden, nombradas: [], todas: this.textos };
  }

  get cambios(): number {
    return this.cambiosTotales;
  }

  /** La lista, para devolvérsela al modelo. */
  lineas(): string[] {
    if (!this.conEstados) return this.tareas.map((t, i) => `${i + 1}. ${t.texto}`);
    return this.tareas.map((t, i) => {
      const estado = t.estado === "en_curso" ? "en curso" : t.estado;
      const medido =
        t.estado === "hecha"
          ? ""
          : t.cambios > 0
            ? ` (${t.cambios} cambio(s) medidos)`
            : t.lecturas > 0
              ? ` (${t.lecturas} lectura(s))`
              : "";
      return `${i + 1}. [${estado}] ${t.texto}${medido}`;
    });
  }

  get usaEstados(): boolean {
    return this.conEstados;
  }
}
