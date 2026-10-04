"use client";
// La llamada: micro → WebRTC con GPT-Live (vía /api/voz/sesion) → eventos al
// puente y a los subtítulos. Todo lo que tiene lógica vive en módulos probados
// (puente-a-len, topes, eventos-de-voz); aquí sólo se conectan.
import { useCallback, useEffect, useRef, useState } from "react";
import { crearLectorSse } from "@/lib/len-bench/sse";
import { clienteDeLaWeb, type ClienteDeOpenLen } from "./cliente";
import { despacharEventoDeVoz } from "./eventos-de-voz";
import { contextoDelEncargo, crearPuenteALen, type EncargoDeFuera, type EventoParaLaVoz, type TarjetaDeLlamada } from "./puente-a-len";
import { crearTopes, MAX_LLAMADA_MS, SILENCIO_MS } from "./topes";

export type AvisoDeLlamada = "sinMicro" | "sinVoz" | "sinCreditos" | "cortada" | "colgadaSilencio" | "colgadaDuracion";
type Fase = "lista" | "conectando" | "en_llamada" | "terminada";

/** Un hueco de más de 1,2 s entre fragmentos abre una frase nueva en el subtítulo. */
const HUECO_MS = 1200;

export function useLlamada(o: { projectId: string; idioma: string; cliente?: ClienteDeOpenLen }) {
  const cliente = o.cliente ?? clienteDeLaWeb;
  // El cliente va en una ref y no en las dependencias: si cambiara entre
  // renders, `cerrarTodo` cambiaría con él y la limpieza del efecto de abajo
  // colgaría la llamada en curso. Se lee al usarlo: siempre es el último.
  const clienteRef = useRef(cliente);
  useEffect(() => {
    clienteRef.current = cliente;
  }, [cliente]);
  const [fase, setFase] = useState<Fase>("lista");
  const [aviso, setAviso] = useState<AvisoDeLlamada | null>(null);
  const [lineaLen, setLineaLen] = useState("");
  const [lineaTu, setLineaTu] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [tarjetas, setTarjetas] = useState<TarjetaDeLlamada[]>([]);
  const [micro, setMicro] = useState(true);
  const [audio, setAudio] = useState(true);
  const [vozDeLen, setVozDeLen] = useState<MediaStream | null>(null);
  const [inicio, setInicio] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const r = useRef<{
    pc?: RTCPeerConnection;
    dc?: RTCDataChannel;
    stream?: MediaStream;
    topes?: ReturnType<typeof crearTopes>;
    sesionId?: string | null;
    segundos?: number | null;
    puente?: ReturnType<typeof crearPuenteALen>;
    /** Lo que Len hace fuera de la llamada (el chat de la app); ver `seguirEncargo`. */
    encargo: EncargoDeFuera | null;
    /** Len trabaja en algo que pidió ESTA llamada. */
    propio: boolean;
    /** La voz ya saludó: un encargo que aparece después se le cuenta aparte. */
    empezada: boolean;
    finLen: number;
    finTu: number;
    cerrada: boolean;
  }>({ encargo: null, propio: false, empezada: false, finLen: -1e9, finTu: -1e9, cerrada: true });

  const enviar = useCallback((e: object) => {
    const dc = r.current.dc;
    if (dc?.readyState === "open") dc.send(JSON.stringify(e));
  }, []);

  const cerrarTodo = useCallback((motivo: string) => {
    const s = r.current;
    if (s.cerrada) return;
    s.cerrada = true;
    s.topes?.parar();
    try {
      s.pc?.close();
    } catch {
      /* ya cerrada */
    }
    s.stream?.getTracks().forEach((p) => p.stop());
    const cuerpo = JSON.stringify({ sesionId: s.sesionId ?? null, segundos: s.segundos ?? null, motivo });
    clienteRef.current.avisarAlCerrar("/api/voz/uso", cuerpo);
    setVozDeLen(null);
    setInicio(null);
    setFase("terminada");
    setTrabajando(false);
  }, []);

  const colgar = useCallback(() => {
    if (r.current.dc?.readyState === "open") {
      enviar({ type: "session.close" });
      setTimeout(() => cerrarTodo("colgada"), 3000);
    } else cerrarTodo("colgada");
  }, [enviar, cerrarTodo]);

  const llamar = useCallback(async () => {
    setAviso(null);
    setTarjetas([]);
    setLineaLen("");
    setLineaTu("");
    setFase("conectando");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setAviso("sinMicro");
      setFase("lista");
      return;
    }
    const s = r.current;
    Object.assign(s, { stream, finLen: -1e9, finTu: -1e9, cerrada: false, segundos: null, sesionId: null, propio: false, empezada: false });
    const pc = new RTCPeerConnection();
    s.pc = pc;
    pc.ontrack = (ev) => {
      if (audioRef.current) audioRef.current.srcObject = ev.streams[0] ?? null;
      setVozDeLen(ev.streams[0] ?? null);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        setAviso("cortada");
        cerrarTodo("conexion_perdida");
      }
    };
    stream.getTracks().forEach((p) => pc.addTrack(p, stream));
    const dc = pc.createDataChannel("oai-events");
    s.dc = dc;

    const zonaHoraria = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const puente = crearPuenteALen({
      async pedirALen(prompt, alEvento) {
        const res = await clienteRef.current.pedir("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: o.projectId, prompt, zonaHoraria }),
        });
        if (!res.ok || !res.body) throw new Error(`/api/agent respondió ${res.status}`);
        const lector = crearLectorSse();
        const dec = new TextDecoder();
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const e of lector.empujar(dec.decode(value, { stream: true }))) alEvento(e);
        }
        for (const e of lector.empujar(dec.decode() + "\n\n")) alEvento(e);
      },
      async dirigir(turnoId, texto) {
        await clienteRef.current.pedir("/api/agent/dirigir", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ turnoId, texto }),
        });
      },
      enviarALaVoz: (e: EventoParaLaVoz) => enviar(e),
      mostrarTarjeta: (t) => setTarjetas((ts) => [...ts, t]),
      alCambiarEstado: (si) => {
        s.propio = si;
        const ocupado = si || s.encargo !== null;
        setTrabajando(ocupado);
        s.topes?.lenTrabajando(ocupado);
      },
    });
    s.puente = puente;
    puente.seguirEncargo(s.encargo);

    let saludo = "";
    dc.onmessage = (m) => {
      let e: unknown;
      try {
        e = JSON.parse(String(m.data));
      } catch {
        return;
      }
      despacharEventoDeVoz(e, {
        empezo: () => {
          // Si Len ya trabaja en algo del chat, la voz lo sabe desde el saludo.
          const contexto = s.encargo ? `\n\n${contextoDelEncargo(s.encargo)}` : "";
          enviar({ type: "session.instructions.append", delegation_id: null, content: saludo + contexto });
          s.empezada = true;
        },
        oyo: (delta, inicio) => {
          s.topes?.actividad();
          puente.oir(delta);
          setLineaTu((l) => (inicio - s.finTu > HUECO_MS ? delta : l + delta));
          s.finTu = inicio;
        },
        dijo: (delta, inicio) => {
          s.topes?.actividad();
          setLineaLen((l) => (inicio - s.finLen > HUECO_MS ? delta : l + delta));
          s.finLen = inicio;
        },
        delego: (id) => void puente.delegar(id),
        uso: (seg) => {
          s.segundos = seg;
        },
        cerro: (motivo, seg) => {
          if (seg !== null) s.segundos = seg;
          cerrarTodo(motivo ?? "cerrada");
        },
        error: () => {
          /* un error de un comando no cierra la sesión; se ve en el log del servidor */
        },
      });
    };

    try {
      const oferta = await pc.createOffer();
      await pc.setLocalDescription(oferta);
      const res = await clienteRef.current.pedir("/api/voz/sesion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: o.projectId, sdp: oferta.sdp, idioma: o.idioma }),
      });
      // 402: sin saldo para abrirla (la voz se cobra, `lib/voz/billing.ts`).
      if (res.status === 402) {
        setAviso("sinCreditos");
        cerrarTodo("no_abrio");
        setFase("lista");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { sdp: string; sesionId: string | null; saludo: string };
      saludo = j.saludo;
      s.sesionId = j.sesionId;
      await pc.setRemoteDescription({ type: "answer", sdp: j.sdp });
    } catch {
      setAviso("sinVoz");
      cerrarTodo("no_abrio");
      setFase("lista");
      return;
    }
    s.topes = crearTopes({
      silencioMs: SILENCIO_MS,
      maxMs: MAX_LLAMADA_MS,
      alColgar: (m) => {
        setAviso(m === "silencio" ? "colgadaSilencio" : "colgadaDuracion");
        colgar();
      },
    });
    // Esperar a que Len termine lo del chat no es silencio: no cuelga por eso.
    if (s.propio || s.encargo) s.topes.lenTrabajando(true);
    setFase("en_llamada");
    setInicio(Date.now());
  }, [o.projectId, o.idioma, enviar, cerrarTodo, colgar]);

  // Los efectos van FUERA del actualizador de estado: en modo estricto React lo
  // llama dos veces, y mandaría el evento dos veces.
  const alternarMicro = useCallback(() => {
    enviar({ type: micro ? "session.input_audio.mute" : "session.input_audio.unmute" });
    setMicro(!micro);
  }, [micro, enviar]);

  const alternarAudio = useCallback(() => {
    if (audioRef.current) audioRef.current.muted = audio;
    setAudio(!audio);
  }, [audio]);

  // LO QUE LEN HACE FUERA DE LA LLAMADA (el chat de la app; la web no lo usa).
  // Llamar con Len trabajando: la voz sabe en qué, lo que pides lo corrige en
  // vez de abrir otro trabajo, y al terminar te lo cuenta (Jesús, 01/10).
  const seguirEncargo = useCallback(
    (e: EncargoDeFuera | null) => {
      const s = r.current;
      const nuevo = e !== null && s.encargo === null;
      s.encargo = e;
      s.puente?.seguirEncargo(e);
      const ocupado = s.propio || e !== null;
      setTrabajando(ocupado);
      s.topes?.lenTrabajando(ocupado);
      if (nuevo && e && s.empezada) enviar({ type: "session.instructions.append", delegation_id: null, content: contextoDelEncargo(e) });
    },
    [enviar],
  );

  const terminoEncargo = useCallback((texto: string) => {
    const s = r.current;
    if (!s.encargo) return;
    s.encargo = null;
    s.puente?.terminoEncargo(texto);
    setTrabajando(s.propio);
    s.topes?.lenTrabajando(s.propio);
  }, []);

  useEffect(() => {
    const alSalir = () => enviar({ type: "session.close" });
    window.addEventListener("beforeunload", alSalir);
    return () => {
      window.removeEventListener("beforeunload", alSalir);
      cerrarTodo("desmontada");
    };
  }, [enviar, cerrarTodo]);

  return { fase, aviso, lineaLen, lineaTu, trabajando, tarjetas, micro, audio, vozDeLen, inicio, llamar: () => void llamar(), colgar, alternarMicro, alternarAudio, audioRef, seguirEncargo, terminoEncargo };
}
