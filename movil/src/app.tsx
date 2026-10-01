// La app: entrar → principal. La llave vive en `llave` (memoria) y en el
// almacén de la plataforma; un 401 de cualquier petición devuelve a «Entrar».
import { useEffect, useMemo, useRef, useState } from "react";
import { BASE, idiomaDelTelefono } from "./config";
import { crearClienteDeLaApp } from "./api/cliente";
import { crearEntrada } from "./sesion/entrada";
import { plataforma } from "./sesion/plataforma";
import { PantallaEntrar } from "./pantallas/entrar";
import { PantallaPrincipal } from "./pantallas/principal";

type Vista = "cargando" | "entrar" | "principal";

export function App() {
  const idioma = idiomaDelTelefono();
  const llave = useRef<string | null>(null);
  const [vista, setVista] = useState<Vista>("cargando");
  const [esperando, setEsperando] = useState(false);
  const [aviso, setAviso] = useState<"caducado" | null>(null);

  const cliente = useMemo(
    () =>
      crearClienteDeLaApp({
        base: BASE,
        llave: () => llave.current,
        alNoAutorizado: () => {
          llave.current = null;
          void plataforma.borrarLlave();
          setVista("entrar");
        },
      }),
    [],
  );

  const entrada = useMemo(
    () =>
      crearEntrada({
        base: BASE,
        idioma,
        enWeb: plataforma.enWeb,
        abrir: plataforma.abrirNavegador,
        aleatorio: () => {
          const b = new Uint8Array(24);
          crypto.getRandomValues(b);
          return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        },
        recordar: plataforma.recordarEstado,
        canjear: async (codigo, estado) => {
          const r = await cliente.pedir("/api/movil/llave", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ codigo, estado, nombre: plataforma.nombreDelTelefono() }),
          });
          return r.ok ? ((await r.json()) as { llave: string }).llave : null;
        },
        guardarLlave: async (v) => {
          llave.current = v;
          await plataforma.guardarLlave(v);
        },
      }),
    [cliente, idioma],
  );

  useEffect(() => {
    plataforma.alVolverALaApp((url) => {
      void entrada.alVolver(url).then((r) => {
        setEsperando(false);
        if (r === "ok") {
          if (plataforma.enWeb) window.history.replaceState(null, "", "/");
          setAviso(null);
          setVista("principal");
        } else if (r === "caducado") setAviso("caducado");
      });
    });
    void plataforma.leerLlave().then((v) => {
      llave.current = v;
      setVista((actual) => (actual === "cargando" ? (v ? "principal" : "entrar") : actual));
    });
  }, [entrada]);

  const salir = async () => {
    await cliente.pedir("/api/movil/llave", { method: "DELETE" }).catch(() => null);
    llave.current = null;
    await plataforma.borrarLlave();
    setVista("entrar");
  };

  if (vista === "cargando") return null;
  if (vista === "entrar")
    return (
      <PantallaEntrar
        esperando={esperando}
        aviso={aviso}
        onEntrar={() => {
          setEsperando(true);
          void entrada.empezar();
        }}
      />
    );
  return <PantallaPrincipal cliente={cliente} idioma={idioma} onSalir={() => void salir()} />;
}
