import { PushNotifications } from "@capacitor/push-notifications";
import type { PluginListenerHandle } from "@capacitor/core";
import type { NativoAvisos } from "./controlador";

const normalizar = (s: string) => s === "granted" ? "granted" as const : s === "denied" ? "denied" as const : "prompt" as const;
export const nativoAvisos: NativoAvisos = {
  async escuchar(e) {
    const handles: PluginListenerHandle[] = [];
    try {
      // Capacitor retiene esta acción hasta añadir el listener, también en arranque frío.
      handles.push(await PushNotifications.addListener("pushNotificationActionPerformed", a => { void e.abrir(a.notification.data); }));
      handles.push(await PushNotifications.addListener("registration", t => { void e.token(t.value); }));
      handles.push(await PushNotifications.addListener("registrationError", () => e.error()));
      handles.push(await PushNotifications.addListener("pushNotificationReceived", n => e.recibir(n.data, n.title ?? "Len", n.body ?? "")));
    } catch (error) { for (const h of handles) void h.remove(); throw error; }
    return () => { for (const h of handles) void h.remove(); };
  },
  permiso: async () => normalizar((await PushNotifications.checkPermissions()).receive),
  pedirPermiso: async () => normalizar((await PushNotifications.requestPermissions()).receive),
  async registrar() {
    await PushNotifications.createChannel({ id: "len-avisos", name: "Len", importance: 3, visibility: 0 });
    await PushNotifications.register();
  },
  desregistrar: () => PushNotifications.unregister(),
  limpiar: () => PushNotifications.removeAllDeliveredNotifications(),
};
