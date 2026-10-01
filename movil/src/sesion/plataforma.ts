// Lo único que cambia entre el teléfono y el navegador de la PC (dev).
// Teléfono: la llave en el almacén seguro (Keystore), el login en el
// navegador del sistema y el regreso por openlen://. PC: localStorage y
// la misma pestaña.
import { Capacitor } from "@capacitor/core";
import { App as AppNativa } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

const CLAVE = "len-llave";
const enWeb = !Capacitor.isNativePlatform();

export const plataforma = {
  enWeb,
  async leerLlave(): Promise<string | null> {
    if (enWeb) return localStorage.getItem(CLAVE);
    const v = await SecureStorage.get(CLAVE).catch(() => null);
    return typeof v === "string" ? v : null;
  },
  async guardarLlave(v: string): Promise<void> {
    if (enWeb) localStorage.setItem(CLAVE, v);
    else await SecureStorage.set(CLAVE, v);
  },
  async borrarLlave(): Promise<void> {
    if (enWeb) localStorage.removeItem(CLAVE);
    else await SecureStorage.remove(CLAVE).catch(() => {});
  },
  async abrirNavegador(url: string): Promise<void> {
    if (enWeb) window.location.href = url;
    else await Browser.open({ url });
  },
  alVolverALaApp(fn: (url: string) => void): void {
    if (enWeb) {
      if (new URLSearchParams(window.location.search).has("codigo")) fn(window.location.href);
      return;
    }
    void AppNativa.addListener("appUrlOpen", (e) => {
      void Browser.close().catch(() => {});
      fn(e.url);
    });
  },
  nombreDelTelefono(): string {
    return enWeb ? "Navegador de la PC" : `Android (${navigator.userAgent.match(/Android [\d.]+/)?.[0] ?? "?"})`;
  },
  recordarEstado: {
    leer: (): string | null => sessionStorage.getItem("len-estado"),
    guardar: (v: string | null): void => {
      if (v) sessionStorage.setItem("len-estado", v);
      else sessionStorage.removeItem("len-estado");
    },
  },
};
