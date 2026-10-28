# Avisos Android de Len

Implementación local completa, sin enviar avisos ni contactar Firebase durante pruebas. Si falta configuración, la app muestra que los avisos no están disponibles y **no llama al registro nativo**. La compilación Android sigue siendo posible sin `google-services.json`.

## Integración

- `useAvisos({ cliente: ClienteDeOpenLen, onAbrirProyecto(id: string): void })` se monta dentro de la pantalla autenticada. Devuelve `{ estado, recibido, activar(), desactivar(), abrirRecibido() }`; las acciones devuelven promesas. `ControlAvisos({ avisos })` presenta el control y la recepción en primer plano.
- `textosAvisos[idioma]` se combina bajo `movil.avisos` en el proveedor de textos (10 idiomas).
- Esperar `cerrarAvisos(cliente)` **antes** de revocar la llave y borrarla del teléfono al salir. Aunque falle la limpieza de avisos, continuar revocando la llave: su FK con `ON DELETE CASCADE` elimina el registro del servidor. No bloquear la salida por una red caída.
- Ante un 401, llamar `abandonarAvisos(cliente)` antes de borrar la llave. Invalida callbacks, registro y navegación pendientes, y limpia el token y la bandeja nativos cuando están configurados.
- Desmontar el hook normalmente sólo libera listeners; conserva la suscripción para recibir en segundo plano. El siguiente montaje recupera el token sin pedir permisos de nuevo si había una suscripción activa.

## Configuración necesaria (no creada por este cambio)

1. Un proyecto Firebase existente, con Cloud Messaging HTTP v1 habilitado y una app Android cuyo package sea `app.openlen.len`.
2. Su archivo `google-services.json` en `movil/android/app/google-services.json`. No inventar ni sustituir sus identificadores. Vite deriva `import.meta.env.VITE_ANDROID_PUSH_CONFIGURED` como cadena `"true"` sólo si el archivo es válido para ese package; no basta con definir manualmente una variable de entorno.
3. En el servidor que ejecuta Next y el drenador de avisos: `FCM_SERVICE_ACCOUNT_JSON`, JSON de cuenta de servicio con `project_id`, `client_email` y `private_key` RSA válida, y permiso `cloudmessaging.messages.create` sobre el mismo proyecto. Mantener la clave únicamente en el gestor de secretos del servidor; nunca usar prefijo `VITE_`, incluirla en el APK ni guardarla en Git.
4. Ejecutar la migración aditiva e idempotente `scripts/movil-avisos-migrate.ts` después de `movil-migrate` en el entorno elegido, antes del código. Está incluida en `scripts/build-migrations.mjs`. No se ha ejecutado contra ninguna base en este trabajo.
5. Compilar/sincronizar Capacitor e instalar en un Android con servicios Google Play. Permitir avisos desde el control de la app. Confirmar en dispositivo real permisos denegados/concedidos, segundo plano, app cerrada, rotación de token, logout y cambio de cuenta. Esta comprobación requiere configuración real y no se presenta como realizada.

## Servidor y privacidad

`GET /api/movil/avisos` devuelve disponibilidad, suscripción e identidad autenticada. `POST {token}` registra o reemplaza el token de **esa llave**; `DELETE` borra sólo esa suscripción. Los tres exigen una llave Bearer válida (no cookies). El usuario del cuerpo se ignora; el token es único globalmente y no puede trasladarse a una sesión distinta con un upsert. La llave revocada elimina su suscripción mediante FK. Un nuevo registro tras una salida sin conexión puede recibir 409 si el token sigue ligado a una llave antigua: reintentar después de dar de baja el token nativo, sin apropiarse de la sesión anterior.

El canal `fcm` utiliza la misma cola duradera, preferencia `webPushEnabled`, ventana de silencio, reintentos y registro de entregas que web push. Se intenta en todos los dispositivos suscritos. Si algún push entrega, se evita el correo de respaldo; si cualquier canal entrega, no se repite el aviso completo. Como en el canal web existente, eso puede dejar un dispositivo fallido sin aviso cuando otro ya recibió. Los tokens `UNREGISTERED` se eliminan; `INVALID_ARGUMENT` se reintenta porque también puede significar un payload erróneo. Fallos OAuth/HTTP nunca se registran con credenciales ni respuesta completa.

El payload incluye `projectId` y `recipientUserId`. El teléfono rechaza destinos de otra cuenta y rutas arbitrarias, consulta el acceso actual al proyecto y sólo entonces navega. Capacitor retiene `pushNotificationActionPerformed` hasta conectar el listener; el controlador guarda el toque mientras obtiene la identidad, por lo que también cubre el arranque en frío. Las notificaciones de primer plano muestran una acción explícita, sin interrumpir automáticamente el proyecto abierto. El canal Android usa visibilidad privada en pantalla bloqueada y caducidad de una hora.

Referencias oficiales: [Capacitor Push Notifications](https://capacitorjs.com/docs/apis/push-notifications), [Firebase HTTP v1 authorization](https://firebase.google.com/docs/cloud-messaging/auth-server), [FCM error codes](https://firebase.google.com/docs/cloud-messaging/error-codes).
