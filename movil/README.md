# Len para Android

React + Vite + Capacitor. Comparte React, traducciones y la llamada con el
repositorio raíz: hay que instalar las dependencias de **ambos** directorios.

## APK de pruebas (Windows)

Requisitos: Node.js compatible con Vite 8, JDK 21, Android SDK Platform 36 y
Build Tools 35.0.0. Gradle 8.14.3 se descarga mediante el wrapper versionado;
la primera compilación necesita acceso a los repositorios de Gradle y Android.

Desde la raíz del repositorio:

```powershell
npm ci
npm --prefix movil ci
npm --prefix movil run apk
```

El comando comprueba TypeScript, construye la web, sincroniza Capacitor y
compila `movil/android/app/build/outputs/apk/debug/app-debug.apk`.
Es un APK firmado con la clave de **depuración**, para pruebas, no para la tienda.

Se respetan `JAVA_HOME`, `ANDROID_HOME` y `GRADLE_USER_HOME`. Si no están
definidas, se busca el JDK incluido en Android Studio y el SDK en la ubicación
habitual de Windows o `D:\Android\Sdk`. Para elegir rutas explícitas:

```powershell
cd movil
npm run apk -- -SdkPath D:\Android\Sdk -JavaPath 'C:\Program Files\Android\Android Studio\jbr' -GradleHome D:\Android\gradle-home
```

El paquete usa `https://openlen.com` por defecto. Se puede elegir otro servidor
HTTPS con `VITE_OPENLEN_BASE` antes de compilar. El script elimina `LEN_DEV_URL`
durante el build para que el APK incluya los archivos y no dependa de una PC.
Las variables originales se restauran al terminar.

Para Linux/macOS: definir `JAVA_HOME` y `ANDROID_HOME`, ejecutar `npm run
typecheck`, `npm run build`, `npx cap sync android` (sin `LEN_DEV_URL`) y
`cd android && sh gradlew --no-daemon assembleDebug`.

## Desarrollo con el teléfono

OpenLen debe estar disponible en el puerto 3007. En `movil/`:

```powershell
npm run dev
```

En otra terminal, con el teléfono conectado y autorizado:

```powershell
adb reverse tcp:5173 tcp:5173
adb reverse tcp:3007 tcp:3007
$env:LEN_DEV_URL = 'http://localhost:5173'
npm run sync
npm run android
```

`http://localhost:5173/?muestra=1` permite revisar la interfaz sin una cuenta ni
llamadas a la IA. La muestra se excluye del build de producción.

## Comprobaciones

Desde la raíz:

```powershell
npx vitest run movil/src components/llamada lib/movil app/api/movil --exclude '**/*.pg.test.ts'
npm --prefix movil run typecheck
npm --prefix movil run build
```

Las pruebas de base de datos requieren su entorno local por separado. Antes de
distribuir el APK, probar en Android real: login y enlace `openlen://entrar`,
cerrar sesión, permiso de micrófono, llamada, foto, teclado, botón atrás,
suspender/reabrir y pérdida/recuperación de red. Compilar no verifica esos flujos.

## Etapas nuevas

La principal incluye el progreso real del turno, una entrega visual breve que
se puede saltar y «Antes / Ahora», basado en la última versión guardada distinta
del mismo documento. La comparación es estática y aislada; para interactuar con
la página se vuelve a su vista previa.

«Publicar y gestionar» ofrece publicar/actualizar, compartir la URL publicada,
«Tus números» y crear, reanudar, pausar o quitar encargos. Las confirmaciones
de publicación siguen siendo explícitas. Tocar la cara o «Tu Len» en «Tus
páginas» permite personalizarla y guardar el estilo en este teléfono.

Los avisos Android y el canal FCM del servidor están implementados. Falta crear
el proyecto Firebase y aportar su configuración para activarlos: ver
[configuración de avisos](src/avisos/README.md). Sin ella la app lo indica y no
solicita permisos. El servidor necesita desplegar la nueva API y su migración
antes de usar avisos o comparación con una cuenta real. Este trabajo no
despliega el servidor ni ejecuta migraciones sobre bases existentes.

La firma de publicación y la app iOS siguen pendientes. No se incluyen claves,
`local.properties`, cachés ni builds en Git.
