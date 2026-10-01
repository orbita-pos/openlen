import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import "./estilos/prototipo.css";
import "./estilos/app.css";
import { App } from "./app";
import { Textos } from "./textos";
import { idiomaDelTelefono } from "./config";
import { medidasDelLienzo } from "./lienzo";
import { aplicarTema, temaGuardado } from "./tema";
import { plataforma } from "./sesion/plataforma";
import { PantallaPrincipal } from "./pantallas/principal";
import { clienteDeMuestra } from "./muestra";

// SÓLO DEV: `?muestra=1` pinta la principal con datos fijos, sin entrar ni
// servidor. En el build `import.meta.env.DEV` es false y Vite poda la muestra.
const muestra = import.meta.env.DEV && new URLSearchParams(location.search).has("muestra");

// El tema: naranja por defecto; el oscuro, si se eligió en «Tus páginas» (ver tema.ts).
aplicarTema(temaGuardado());
plataforma.atrasEnElTelefono();

// Acostado lo dice la pantalla, no la ventana: con el teclado abierto la
// ventana queda más ancha que alta y la app se achicaba entera.
const acostado = () => (screen.orientation?.type ?? (innerWidth > innerHeight ? "landscape" : "portrait")).startsWith("landscape");

function Lienzo() {
  const [m, setM] = useState(() => medidasDelLienzo(innerWidth, innerHeight, acostado()));
  useEffect(() => {
    const r = () => setM(medidasDelLienzo(innerWidth, innerHeight, acostado()));
    addEventListener("resize", r);
    return () => removeEventListener("resize", r);
  }, []);
  return (
    <div className="app-lienzo" style={{ height: m.alto, left: m.izquierda, transform: `scale(${m.escala})` }}>
      {/* De pie y más bajo que 600: es el teclado (app.css encoge la cabecera del chat). */}
      <div className={`lm-screen${m.izquierda === 0 && m.alto < 600 ? " con-teclado" : ""}`}>
        {muestra ? <PantallaPrincipal cliente={clienteDeMuestra} idioma={idiomaDelTelefono()} onSalir={() => {}} /> : <App />}
      </div>
    </div>
  );
}

createRoot(document.getElementById("raiz")!).render(
  <Textos idioma={idiomaDelTelefono()}>
    <Lienzo />
  </Textos>,
);
