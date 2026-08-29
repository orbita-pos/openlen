"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// DICTADO POR VOZ — la Web Speech API del navegador.
//
// Por qué ésta y no una transcripción nuestra: no cuesta un crédito, no
// necesita clave y no la operamos nosotros. Una transcripción propia sería un
// modelo más que pagar por cada persona que prueba el héroe sin registrarse.
//
// ⚠️ PERO EL AUDIO SÍ SALE DE LA MÁQUINA, y esto lo escribí mal la primera vez.
// La implementación de Chrome NO es en el dispositivo: transmite el audio al
// servicio de voz de Google y devuelve el texto — por eso `onerror: "network"`
// existe y por eso sin conexión no reconoce nada. Safari usa el de Apple.
//
// Lo que cambia respecto a lo que quitamos hoy: ese audio va del NAVEGADOR del
// usuario a su proveedor de voz, no de nuestro servidor a un modelo nuestro.
// No pasa por OpenLen, no lo almacenamos y no aparece en la política de
// privacidad porque no somos parte del trayecto. Aun así se escribe aquí: lo
// contrario sería exactamente la clase de afirmación cómoda que este repo pasó
// el día entero borrando.
//
// DETECCIÓN DE VERDAD, no lista de navegadores. Firefox no la trae, y Chrome
// en Linux la trae pero sin backend de voz. Se comprueba el objeto y punto: si
// no está, `soportado` es false y quien llama NO PINTA EL BOTÓN. Un micrófono
// gris que no responde es exactamente lo que quitamos del héroe esta mañana.
//
// La detección va en un efecto, no en el primer render: en el servidor no hay
// `window`, y decidir ahí produciría una hidratación distinta a la del cliente.
// ─────────────────────────────────────────────────────────────────────────────

/** Lo mínimo de la Web Speech API que se usa aquí. No está en `lib.dom`. */
interface ResultadoReconocimiento {
  readonly isFinal: boolean;
  readonly length: number;
  item(i: number): { transcript: string };
  [i: number]: { transcript: string };
}
interface EventoResultado extends Event {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    item(i: number): ResultadoReconocimiento;
    [i: number]: ResultadoReconocimiento;
  };
}
interface EventoError extends Event {
  readonly error: string;
}
interface Reconocimiento extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: EventoResultado) => void) | null;
  onerror: ((e: EventoError) => void) | null;
  onend: (() => void) | null;
}
type ConstructorReconocimiento = new () => Reconocimiento;

/**
 * La etiqueta de idioma que se le pasa al motor.
 *
 * La pagina da "es"; el motor prefiere un BCP-47 con region ("es-MX"), porque
 * el acento y el vocabulario cambian el reconocimiento. Si el navegador del
 * usuario ya declara una variante de ESE mismo idioma, se usa la suya: quien
 * tiene el sistema en es-MX y esta leyendo la pagina en español quiere que le
 * entiendan a el, no a un locutor de Madrid.
 *
 * Si no coincide, se manda la base y el motor elige — mejor eso que imponerle
 * una region que no es la suya.
 *
 * 🔴 SOLO REGIONES DE PAIS. Chromium declara `es-419` —"español de
 * Latinoamerica", un codigo de MACRO-REGION de la ONU— y el motor de voz espera
 * paises (`es-MX`, `es-AR`, `es-ES`). Pasarle `es-419` puede devolver
 * `language-not-supported`, o sea que la "mejora" habria roto justo lo que
 * venia a arreglar. Se exige region de dos letras; lo demas cae a la base.
 */
const REGION_DE_PAIS = /^[a-z]{2,3}-[A-Za-z]{2}$/;

export function etiquetaDeIdioma(
  locale: string,
  idiomasDelNavegador: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages ?? [],
): string {
  const base = locale.split("-")[0].toLowerCase();
  const suya = idiomasDelNavegador.find(
    (l) => l.split("-")[0].toLowerCase() === base && REGION_DE_PAIS.test(l),
  );
  return suya ?? base;
}

function constructorDisponible(): ConstructorReconocimiento | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: ConstructorReconocimiento;
    webkitSpeechRecognition?: ConstructorReconocimiento;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface Dictado {
  /** ¿Existe la API? Falso en el servidor y en el primer render del cliente. */
  readonly soportado: boolean;
  /** ¿Está escuchando ahora mismo? */
  readonly escuchando: boolean;
  /** Lo que va reconociendo ANTES de darlo por bueno. Se pinta en gris tras el
   *  texto ya escrito: sin esto, hablar parece que no hace nada durante los
   *  segundos que el motor tarda en cerrar una frase. */
  readonly parcial: string;
  /** Le denegaron el micrófono. Se distingue de "no soportado" porque la
   *  respuesta del producto es distinta: aquí sí hay que decir algo. */
  readonly denegado: boolean;
  /** El motor abrio, se cerro varias veces y NO reconocio ni una palabra.
   *
   *  Es el estado que faltaba. Sin el, un fallo real —sin salida al servicio de
   *  voz, la entrada de audio equivocada— se ve igual que estar escuchando: el
   *  boton encendido y nada mas. Callarse cuando algo no funciona es la misma
   *  falta que un indicador que solo sabe ponerse en verde. */
  readonly mudo: boolean;
  alternar(): void;
  /** Corta la escucha sin avisar — para cuando el formulario se envía. */
  parar(): void;
}

export function useDictado(opciones: {
  /** BCP-47. Se le pasa el locale de la página: dictar en español a un motor
   *  configurado en inglés produce basura fonética, no una traducción. */
  readonly idioma: string;
  /** Recibe cada trozo YA CERRADO por el motor. El llamador decide cómo
   *  añadirlo — aquí no se toca el texto del usuario. */
  onTexto(fragmento: string): void;
}): Dictado {
  const { idioma, onTexto } = opciones;
  const [soportado, setSoportado] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const [parcial, setParcial] = useState("");
  const [denegado, setDenegado] = useState(false);
  const [mudo, setMudo] = useState(false);
  const ref = useRef<Reconocimiento | null>(null);

  // 🔴 LA INTENCION DEL USUARIO, separada de si el motor esta abierto.
  //
  // Chrome cierra la sesion solo tras unos segundos de silencio AUNQUE
  // `continuous` este puesto — el diario del motor real lo enseña: `onstart`,
  // `onaudiostart`, y luego `onend` sin que nadie lo pida. La primera version de
  // esto trataba ese `onend` como "el usuario paro" y apagaba el boton: le
  // dabas, tardabas dos segundos en arrancar a hablar, y se apagaba solo.
  //
  // Reportado por Jesus el 2026-08-28 usandolo de verdad. Mi prueba no lo veia
  // porque el motor guionado solo se cerraba cuando yo se lo mandaba: probaba
  // MI cableado contra MI idea del motor, no contra el motor.
  const quiereEscuchar = useRef(false);
  // Cuantas veces seguidas se ha cerrado sin oir nada. Sin esto, un fallo real
  // —sin microfono, sin red— produce un bucle de reinicios invisible que gira
  // para siempre con el boton encendido.
  const reinicios = useRef(0);
  // 🔴 LO ULTIMO QUE SE OYO SIN CERRAR. Chrome DESCARTA los resultados
  // provisionales cuando la sesion termina: lo que dijiste y el motor aun no
  // habia dado por bueno se evapora. Antes se notaba —el boton se apagaba y
  // volvias a pulsar—; con el reinicio automatico desaparece en silencio, que
  // es peor. Reportado por Jesus: "le hablo y no me lo pone en el texto".
  //
  // Se guarda aqui y se da por bueno al cerrar. Puede meter alguna palabra que
  // el motor habria corregido, y ese cambio es deliberado: perder una frase
  // entera es peor que escribirla un poco peor, y el usuario la ve y la edita.
  const pendiente = useRef("");
  // ¿Ha reconocido ALGUNA VEZ una palabra en esta visita?
  //
  // 🔴 BRAVE (y todo Chromium que no sea Chrome) TRAE LA API Y NO EL SERVICIO.
  //
  // MEDIDO en la maquina de Jesus el 2026-08-28, en su Brave: 4 microfonos,
  // permiso concedido, senal a tope (128/128), y el motor devuelve
  // `onstart → onaudiostart → onerror: network → onend`. El microfono capta
  // perfectamente; lo que no contesta es el SERVICIO de reconocimiento, que en
  // Chrome vive en servidores de Google y va con las claves de API de Chrome.
  // Brave, Vivaldi, Arc y los Chromium a secas no las llevan.
  //
  // Por eso `soportado` NO PUEDE ser solo "existe el objeto": ahi existe y no
  // sirve. La deteccion de verdad es la primera respuesta del motor.
  //
  // Eso cambia el diseno. Un aviso ambar en la portada hablandole al visitante
  // de SU red es lo peor de los dos mundos: no puede arreglarlo y suena a
  // reproche. Si este navegador no puede dictar, el boton se RETIRA en silencio
  // —igual que en Firefox, que tampoco lo trae— y el compositor se queda como
  // si nunca hubiera existido.
  //
  // El aviso se guarda para el otro caso, que es distinto: dicto bien, y a
  // mitad deja de reconocer. Ahi el usuario SI tiene contexto para entenderlo.
  const reconocioAlgunaVez = useRef(false);

  // `onTexto` cambia en cada render del padre; guardarlo en una ref evita
  // recrear el reconocedor —y cortar la escucha— a media frase.
  const onTextoRef = useRef(onTexto);
  useEffect(() => {
    onTextoRef.current = onTexto;
  }, [onTexto]);

  useEffect(() => {
    setSoportado(constructorDisponible() !== null);
  }, []);

  const parar = useCallback(() => {
    // Parar a media frase no puede tirarla: la dijiste.
    const aMedias = pendiente.current.trim();
    pendiente.current = "";
    if (aMedias) onTextoRef.current(aMedias);
    quiereEscuchar.current = false;
    reinicios.current = 0;
    ref.current?.abort();
    ref.current = null;
    setEscuchando(false);
    setParcial("");
  }, []);

  // Si el componente se va con el micrófono abierto, el motor sigue escuchando.
  useEffect(() => () => void ref.current?.abort(), []);

  const arrancar = useCallback(() => {
    const Ctor = constructorDisponible();
    if (!Ctor) return;

    const r = new Ctor();
    r.lang = etiquetaDeIdioma(idioma);
    // `continuous`: sin esto el motor cierra al primer silencio y hay que
    // volver a pulsar cada frase. Un brief son dos o tres.
    r.continuous = true;
    r.interimResults = true;

    r.onresult = (e) => {
      // Se oyo algo: la sesion es sana y el contador de reinicios se limpia.
      reinicios.current = 0;
      reconocioAlgunaVez.current = true;
      setMudo(false);
      let cerrado = "";
      let enCurso = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const res = e.results[i];
        const texto = res[0]?.transcript ?? "";
        if (res.isFinal) cerrado += texto;
        else enCurso += texto;
      }
      setParcial(enCurso);
      pendiente.current = enCurso;
      if (cerrado.trim()) {
        // Lo cerrado ya viaja: lo pendiente deja de estar pendiente.
        pendiente.current = "";
        onTextoRef.current(cerrado);
      }
    };

    r.onerror = (e) => {
      // `no-speech` y `aborted` son ruido normal: el usuario calló, o paramos
      // nosotros. Ninguno de los dos apaga nada — el reinicio de `onend` los
      // absorbe.
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setDenegado(true);
        parar();
        return;
      }
      // `network` = el navegador no llega al servicio de voz. Si NUNCA ha
      // reconocido nada, este navegador sencillamente no puede dictar: se
      // retira el boton sin decir nada, que es lo que ya hacemos con los
      // navegadores que no traen la API.
      if (e.error === "network" && !reconocioAlgunaVez.current) {
        quiereEscuchar.current = false;
        setSoportado(false);
        parar();
        return;
      }
      // Lo demas (`audio-capture`, `service-not-available`) tampoco se apaga
      // aqui: `onend` viene detras y decide, contando los reintentos.
    };

    // EL MOTOR SE CIERRA SOLO, y eso NO significa que el usuario haya parado.
    // Mientras siga queriendo escuchar, se vuelve a abrir.
    r.onend = () => {
      ref.current = null;
      // ANTES DE NADA: rescatar lo que quedo a medias.
      const aMedias = pendiente.current.trim();
      pendiente.current = "";
      if (aMedias) {
        reinicios.current = 0;
        onTextoRef.current(aMedias);
      }
      setParcial("");
      if (!quiereEscuchar.current) return;
      reinicios.current += 1;
      // Seis cierres seguidos sin oir una palabra no es silencio: es que algo
      // no funciona (sin microfono, sin red — Chrome manda el audio fuera para
      // reconocerlo). Se rinde con el boton apagado en vez de girar en vacio.
      if (reinicios.current > 6) {
        // Mismo criterio que arriba: sin una sola palabra reconocida en toda la
        // visita, el problema es el navegador, no el turno. Se retira.
        if (!reconocioAlgunaVez.current) {
          quiereEscuchar.current = false;
          setSoportado(false);
        } else {
          setMudo(true);
        }
        parar();
        return;
      }
      arrancarRef.current();
    };

    ref.current = r;
    setParcial("");
    try {
      r.start();
    } catch {
      // `start()` lanza si ya había una sesión abierta (doble clic rápido).
      parar();
    }
  }, [idioma, parar]);

  // `arrancar` se llama a si mismo desde `onend`. Una ref rompe el ciclo sin
  // volver a crear el callback en cada render.
  const arrancarRef = useRef(arrancar);
  useEffect(() => {
    arrancarRef.current = arrancar;
  }, [arrancar]);

  const alternar = useCallback(() => {
    if (quiereEscuchar.current) {
      parar();
      return;
    }
    if (!constructorDisponible()) return;
    quiereEscuchar.current = true;
    reinicios.current = 0;
    setDenegado(false);
    setMudo(false);
    setEscuchando(true);
    arrancar();
  }, [arrancar, parar]);

  return { soportado, escuchando, parcial, denegado, mudo, alternar, parar };
}
