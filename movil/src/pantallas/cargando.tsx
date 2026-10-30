import { Cara } from "../cara";
/** También sirve mientras aún se cargan las traducciones o la sesión. */
export function Cargando({ mensaje = "Len" }: { mensaje?: string }) {
  return <section className="lm-layer lm-chat is-on app-cargando" role="status">
    <Cara estado="pensando" className="app-cargando-cara" /><p>{mensaje}</p>
  </section>;
}
