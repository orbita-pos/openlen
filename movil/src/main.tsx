import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import "./estilos/prototipo.css";
import "./estilos/app.css";
import { App } from "./app";
import { Textos } from "./textos";
import { idiomaDelTelefono } from "./config";
import { medidasDelLienzo } from "./lienzo";
import { PantallaPrincipal } from "./pantallas/principal";
import { clienteDeMuestra } from "./muestra";

// SÓLO DEV: `?muestra=1` pinta la principal con datos fijos, sin entrar ni
// servidor. En el build `import.meta.env.DEV` es false y Vite poda la muestra.
const muestra = import.meta.env.DEV && new URLSearchParams(location.search).has("muestra");

// El tema sigue al teléfono: el prototipo pinta el oscuro con :root[data-theme="dark"].
const oscuro = window.matchMedia("(prefers-color-scheme: dark)");
const tema = () => (document.documentElement.dataset.theme = oscuro.matches ? "dark" : "light");
tema();
oscuro.addEventListener("change", tema);

function Lienzo() {
  const [m, setM] = useState(() => medidasDelLienzo(innerWidth, innerHeight));
  useEffect(() => {
    const r = () => setM(medidasDelLienzo(innerWidth, innerHeight));
    addEventListener("resize", r);
    return () => removeEventListener("resize", r);
  }, []);
  return (
    <div className="app-lienzo" style={{ height: m.alto, transform: `scale(${m.escala})` }}>
      <div className="lm-screen">
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
