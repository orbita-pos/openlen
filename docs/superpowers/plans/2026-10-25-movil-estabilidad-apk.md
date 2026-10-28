# Len Móvil: estabilidad y APK reproducible

> Implementación directa con superpowers:executing-plans. Alcance aprobado en el chat: corregir los fallos encontrados y preparar el APK; sin publicación ni cambios de diseño.

**Objetivo:** recuperar errores de carga, reconocer las preguntas actuales de Len y construir un APK Android desde este checkout.
**Arquitectura:** conservar React/Vite/Capacitor y la interfaz existente; reutilizar la pantalla de reintento y el contrato compartido de preguntas. Versionar la configuración nativa, no sus cachés ni credenciales.
**Referencia:** revisión del chat y docs/superpowers/specs/2026-10-01-len-movil-pieza-1-design.md.

- [x] 1. Añadir regresiones de pantalla para HTTP 500, JSON inválido y fallo al abrir proyecto, comprobando que Reintentar recupera el contenido. Corregir principal.tsx sin ocultar los errores de autenticación que ya gestiona el cliente.
- [x] 2. Añadir regresiones de preguntas modernas/antiguas, fallidas y ya contestadas; corregir hilo.ts usando el contrato compartido.
- [x] 3. Normalizar el error unknown de Worker en terminal.ts; comprobar TypeScript.
- [x] 4. Recuperar configuración Android existente o generar plantilla oficial, registrar openlen://entrar y permisos necesarios. Configurar URL de producción, script de build reproducible y README; compilar APK de depuración empaquetado.
- [x] 5. Ejecutar pruebas móvil/llamada/autenticación, TypeScript, build y revisión independiente. Documentar límites de validación en dispositivo.

## Decisiones y resultados

- Se reutiliza el checkout actual, rama len-3.0, inicialmente sin modificaciones de archivos versionados. Las notas históricas de len-movil no describen el checkout actual.
- No se crean commits ni se publica: se dejan cambios revisables en el espacio compartido.
- APK de depuración para pruebas; firma de tienda y pruebas físicas quedan diferenciadas del build local.
- Regresiones observadas en rojo antes del arreglo: 7 casos de carga/preguntas, 1 de URL de producción y 2 de preguntas descartadas.
- Revisión independiente: detectó preguntas descartadas marcadas como pendientes. Corregidas y cubiertas tanto en historial como en stream; sin otros hallazgos concretos.
- Verificación final: 179 pruebas / 29 archivos pasan (sin pruebas PostgreSQL); TypeScript, Vite y comando completo de APK pasan. `apksigner verify --verbose` confirma firma v2.
- APK: `movil/android/app/build/outputs/apk/debug/app-debug.apk`; SHA256 `b81cc67f2e46b3ff04a65f9d13d3795e5365bb76af8f1cd1a897293e9a12a16b`.
- El SDK y Gradle existen en D:. La compilación requirió acceso fuera del aislamiento para escribir en sus cachés. No se instalaron ni ejecutaron llamadas de IA en un teléfono.
- Se verificaron el contenido empaquetado, el destino HTTPS de OpenLen, la ausencia de servidor Vite, los permisos y el enlace `openlen://entrar`. Los flujos nativos requieren validación física posterior.
