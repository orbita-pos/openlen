export const es = {
  htmlLang: "es",
  meta: {
    title: "Len — tu propio desarrollador web",
    description:
      "Le dices lo que quieres y Len construye tu página, la publica y la cambia cuando se lo pides. Sin agencia y sin cotizaciones.",
  },
  nav: {
    research: "Research",
    principios: "Principios",
    openlen: "OpenLen",
    prueba: "Prueba Len",
    otroIdioma: "English",
    otroLang: "en",
  },
  pie: {
    marca: "Len, de OpenLen",
    abierto: "Código abierto (AGPLv3). Cada cifra de esta web enlaza a la prueba que la sostiene.",
    len: "Len",
    openlen: "OpenLen",
    idioma: "Idioma",
    status: "Status",
    github: "GitHub",
  },
  pruebaUrl: "https://openlen.com/es/new",
  principiosPagina: {
    titulo: "Principios",
    intro:
      "Lo que Len promete, por qué, cómo lo comprobamos y en qué estado está cada promesa hoy. Sin adornos: lo que aún no está garantizado lo decimos.",
  },
  research: {
    titulo: "Research",
    intro:
      "Lo que hemos aprendido construyendo Len: el problema, cómo lo medimos, lo que encontramos —incluidos nuestros errores— y lo que sigue abierto.",
    leer: "min de lectura",
    volver: "← Todo el research",
    otroIdioma: "Read in English",
  },
  portada: {
    antetitulo: "Len, de OpenLen",
    titular: ["Tu ", "propio", " desarrollador web."],
    parrafo:
      "Le dices lo que quieres, como se lo dirías a una persona, y Len construye tu página, la publica y la cambia cada vez que se lo pides. Sin agencia, sin cotizaciones, sin esperar semanas.",
    cta: "Prueba Len",
    ctaSecundario: "Qué sabe hacer",
    altCielo: "Un cielo pintado al amanecer con un anillo de luz coral entre las nubes.",
    cielo: {
      titulo: "Len 1.5",
      texto: "Lo que antes era contratar a alguien, ahora es escribirle un mensaje.",
      cta: "Cómo trabaja →",
    },
    oficio: {
      antetitulo: "Lo que hace por ti",
      titulo: "Lo que le pedirías a un desarrollador.",
      tarjetas: [
        {
          k: "construye",
          t: "Construye lo que pides",
          p: "Una sección, una página nueva o el sitio entero rediseñado. Y si pides cambiar una frase, cambia esa frase: no reescribe todo lo demás.",
          commit: "",
        },
        {
          k: "funciona",
          t: "Que funcione, no solo que se vea",
          p: "Formularios que te llegan, un carrito que guarda en una base de datos, un asistente que contesta a tus visitantes.",
          commit: "fa5443c7",
        },
        {
          k: "pruebas",
          t: "Deja pruebas de lo que construye",
          p: "Cuando algo de tu página se mueve —un carrito, unas pestañas, un menú— escribe una prueba y la corre en un navegador de verdad. En cada cambio siguiente la vuelve a correr: si algo que ya funcionaba se rompe, te avisa.",
          commit: "f3b10e53",
        },
        {
          k: "mira",
          t: "Mira antes de entregar",
          p: "Abre la página y la mide: contraste en el píxel, desbordes en el móvil y errores de JavaScript. En todas las páginas que tocó, no solo en la última.",
          commit: "10c1cdaa",
        },
        {
          k: "cuenta",
          t: "Te dice qué comprobó",
          p: "Qué hizo, qué comprobó y qué no. Si algo no salió, lo dice, y te dice qué faltó.",
          commit: "f8e9e8cd",
        },
        {
          k: "cobro",
          t: "No te cobra lo que no hizo",
          p: "Si un turno se atasca y no llega a ningún lado, no se cobra.",
          commit: "bfa5a400",
        },
      ],
    },
    cifras: {
      antetitulo: "Len 1.0 → Len 1.5",
      titulo: "Qué cambió desde el 1.0, medido.",
      leer: "Cómo lo medimos",
      items: [
        {
          valor: "64 → 67",
          texto: "encargos resueltos de 69, con la misma batería contra el código de las dos versiones y el mismo modelo",
          commit: "48a3b66b",
        },
        {
          valor: "3",
          texto: "fallos del 1.0 que el 1.5 ya no tiene: se quedaba sin pasos, avisaba de una edición que nadie hizo y, al topar, ni miraba la página ni decía que no la había mirado",
          commit: "48a3b66b",
        },
      ],
      nota: "Una corrida por caso: la diferencia es pequeña y está cerca del ruido. Hay 14 encargos más, escritos después del 1.0, que su banco de pruebas no sabe plantear; el 1.5 resuelve 13. Y un fallo que tienen los dos: inventan el prefijo de país de un teléfono que les das sin él.",
      notaCommit: "48a3b66b",
    },
    tarjeta: {
      antetitulo: "Len 1.5 · septiembre 2026",
      titulo: "Veintisiete herramientas, un solo desarrollador",
      texto:
        "Edita tu página nodo a nodo, busca en todo el sitio el dato que va a cambiar, elige fotos y publica. Y cada cambio lo verifica mirándolo: una captura que alguien describe y una medición que no depende de ningún modelo.",
      como: "Cómo trabaja →",
      grupos: {
        mirar: {
          titulo: "Mirar",
          nota: "1 herramienta · 2 modos",
          texto:
            "Medir, gratis, en un navegador real —contraste en el píxel, desbordes en móvil, errores de JS— o describir la captura con visión cuando hace falta. El modo es explícito, para que el coste no dependa de cómo se redactó la frase.",
        },
        leer: {
          titulo: "Leer",
          texto: "El estado real del proyecto, cualquier cosa en todo el sitio, y las páginas de internet que le das.",
        },
        editar: {
          titulo: "Editar",
          texto: "Texto, atributos, HTML y el JavaScript de la página, nodo a nodo; y deshacer su último cambio.",
        },
        disenar: {
          titulo: "Diseñar y crear",
          texto: "Tema, temática, rediseño completo, páginas nuevas del sitio y cambiar entre ellas.",
        },
        fotos: { titulo: "Fotos", texto: "Elegir y editar imágenes para tu rubro." },
        datos: {
          titulo: "Datos y módulos",
          texto: "Encender el chat, que es un módulo real de OpenLen y no un formulario pintado, y guardar, editar, quitar o conectar datos vivos.",
        },
        contigo: {
          titulo: "Contigo",
          texto:
            "Pregunta cuando duda, apunta sus tareas, recuerda tus preferencias, propone objetivos, prepara tu marketing y publica.",
        },
      },
    },
    como: {
      antetitulo: "Cómo trabaja",
      titulo: "Lee, actúa, mira, cuenta.",
      pasos: [
        {
          k: "uno",
          t: "Lee",
          p: "El estado real del proyecto —el documento, las páginas, los módulos, si está publicado—, no lo que recuerda de la conversación.",
        },
        { k: "dos", t: "Actúa", p: "Cambia el nodo exacto. Nunca reescribe el documento entero para cambiar una frase." },
        {
          k: "tres",
          t: "Mira",
          p: "Renderiza en un navegador real y mide: contraste en el píxel, desbordes en móvil, errores de JS.",
        },
        { k: "cuatro", t: "Cuenta", p: "Lo que pasó, con la evidencia. Si no pudo, lo dice — y qué faltó." },
      ],
    },
    ultimo: { antetitulo: "Research", titulo: "Lo último", todo: "Todo el research" },
    principios: {
      antetitulo: "Principios",
      titulo: "Lo que Len promete — y cómo lo comprobamos",
      leer: "Leer los principios",
      tres: [
        {
          k: "primero",
          t: "No mentir",
          p: "Toda afirmación descansa en un resultado observado. Si no lo miró, no dice que está bien.",
          estado: "vigilado",
          chip: "Vigilado por su batería y una guarda del turno",
        },
        {
          k: "segundo",
          t: "Terminar el encargo",
          p: "Lo que pediste es el entregable. Si no cabe, dice exactamente qué quedó pendiente.",
          estado: "medicion",
          chip: "Construido, en medición",
        },
        {
          k: "tercero",
          t: "Una condición que otro confirma",
          p: "El trabajo no termina hasta que un evaluador aparte lo comprueba. Con tope de gasto: ante la duda, para.",
          estado: "medicion",
          chip: "Construido, en medición",
        },
      ],
    },
    disponible: {
      antetitulo: "Disponible hoy",
      titulo: "Len trabaja dentro de OpenLen.",
      texto: "Es el chat del editor: abres tu página, le escribes lo que quieres y se pone a trabajar. En diez idiomas.",
      cta: "Prueba Len",
    },
    mision: {
      antetitulo: "Por qué",
      frase: ["Tener una buena web no debería depender de ", "poder pagarla", "."],
    },
  },
};
