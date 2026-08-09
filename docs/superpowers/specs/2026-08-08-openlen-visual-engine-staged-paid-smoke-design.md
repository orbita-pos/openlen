# OpenLen Visual Engine — piloto pagado por etapas

**Estado:** aprobado conceptualmente por Jesús el 2026-08-08.

## Objetivo

Validar cada etapa del Visual Engine con evidencia live suficiente para detectar fallos evidentes, sin consumir el presupuesto completo antes de construir 2B y 2C. El presupuesto disponible desde esta decisión es MXN 110 y se divide en MXN 30 para 2A, MXN 30 para 2B, MXN 30 para 2C y MXN 20 de reserva final.

Esta especificación implementa únicamente el límite y smoke pilot de 2A. No diseña 2B ni 2C, no modifica el flujo Quick de producción y no habilita `skeleton` globalmente.

## Decisión

El piloto completo de 75 adaptaciones se sustituye, por ahora, por un smoke pilot de 15 adaptaciones: una por cada caso base congelado y solo bajo el escenario `plain`. Antes de esas adaptaciones se conserva el live canary de 15 análisis de intención, uno por caso.

El smoke pilot sirve para decidir si se puede comenzar 2B. No satisface el gate estadístico original de 2A, no autoriza rollout de `skeleton` y no permite afirmar que 2A está validado para producción. La evaluación integrada final deberá volver a cubrir las variantes diferidas.

## Presupuesto

- Límite absoluto de 2A: `30_000_000` micro-MXN.
- El conteo incluye toda llamada Gemini iniciada por el proceso: análisis de intención, generación de copy/fill, dirección creativa, crítico visual y cualquier parche diagnóstico permitido.
- El límite se aplica solo al runner pagado 2A. No cambia costos, créditos ni comportamiento de solicitudes de usuarios.
- La rate card queda congelada en el artefacto con modelo, precios oficiales, moneda, fecha y tipo de cambio usados.
- Los MXN 30 son un techo, no un objetivo de gasto.

## Guard presupuestario

Un guard global del proceso envuelve todos los transportes Gemini usados por el piloto. Antes de iniciar cada request:

1. calcula una reserva conservadora usando el máximo de salida configurado, thinking budget, tamaño de entrada y límites conocidos de las imágenes normalizadas;
2. adquiere esa reserva de forma atómica frente a requests concurrentes;
3. rechaza el request antes de la red si la reserva pudiera superar `30_000_000` micro-MXN;
4. al terminar, reconcilia la reserva con usage tipado del proveedor;
5. si el usage falta, es inválido o es incompleto, conserva la reserva máxima completa;
6. nunca libera o reutiliza presupuesto basándose en una estimación no verificada.

La concurrencia no puede permitir que dos requests reserven el mismo saldo. No hay retry pagado. Un rechazo presupuestario impide nuevas llamadas y nuevas reservas DB del piloto.

## Flujo 2A reducido

1. Validar manifest de qualification, commit, catálogo publicado, hashes, cuota y rate card.
2. Ejecutar el canary de exactamente 15 análisis live bajo el guard de MXN 30.
3. Exigir `15/15` decisiones válidas `template_skeleton`, template permitido, versiones correctas y usage completo.
4. Revalidar commit, material, cuota y saldo antes de adaptar.
5. Construir exactamente 15 filas, una por caso, usando únicamente el escenario `plain` ya congelado.
6. Antes de cada fila, comprobar que el presupuesto permite completar conservadoramente su siguiente llamada; reservar DB únicamente cuando el trabajo puede comenzar.
7. Ejecutar el pipeline existente sin persistir candidatos ni debitar créditos de usuarios.
8. Detenerse si el guard rechaza una llamada; no reemplazar, reintentar ni reclamar cuota.
9. Escribir evidencia local redactada y telemetría escalar existente.

Las 60 unidades no consumidas de la cuota 2A permanecen sin usar. No se transfieren a 2B ni se presentan como adaptaciones ejecutadas.

## Gate para comenzar 2B

El smoke pilot permite comenzar el desarrollo de 2B únicamente si:

- se iniciaron exactamente 15 adaptaciones y el costo total verificado quedó dentro de MXN 30;
- al menos 14 terminaron técnicamente;
- todas las terminadas fueron revisadas visualmente;
- al menos 12 resultados transmiten correctamente dominio, audiencia y emoción y son preferidos sobre su baseline;
- hay cero cambios de estructura protegida, persistencias parciales, señales prohibidas, fugas de datos o débitos de usuario;
- el rollback vigente continúa verificado;
- cada request pagado tiene usage completo o una reserva máxima conservada.

Este gate indica que la arquitectura es suficientemente prometedora para construir 2B. No equivale al gate de lanzamiento del Visual Engine completo.

## Fallos

- Si el canary no alcanza `15/15`, se detiene con cero adaptaciones.
- Si no cabe la siguiente llamada, se registra `budget_exhausted` y se detienen nuevas llamadas y reservas.
- Si se iniciaron menos de 15 adaptaciones, el smoke pilot falla y no autoriza comenzar 2B automáticamente.
- Un fallo técnico conserva su costo en el denominador y no obtiene reemplazo.
- Usage ausente nunca se convierte en costo cero.
- Ningún error incluye prompt, HTML, respuesta cruda, key, correo, identidad o path absoluto.

## Evidencia

El artefacto ignorado añade un resumen allowlist:

- versión del esquema y dataset;
- commit, modelo, prompt, policy, taxonomy y rate card;
- límite, monto reservado, costo verificado y saldo conservador en micro-MXN;
- número de requests iniciados, completados, rechazados y con usage incompleto por rol;
- 15 resultados escalares con case ID, template ID, escenario, estado, reason code, usage, costo y hashes aprobados;
- self-hash canónico.

No almacena briefs, intents completos, HTML, copy, capturas, respuestas, errores crudos ni identidad del revisor en la base de datos.

## Verificación no-live previa

Las pruebas deben demostrar:

- reserva atómica bajo concurrencia y rechazo antes de red;
- reconciliación correcta y retención completa ante usage ausente/inválido;
- suma de todos los roles Gemini dentro del mismo techo;
- cero retries y corte terminal después de `budget_exhausted`;
- canary 15/15 antes de cualquier adaptación;
- expansión exacta a 15 filas `plain`, sin las otras cuatro variantes;
- cero reservas DB antes de pasar canary y barreras de frescura;
- evidencia allowlist y costo completo;
- invariantes estructurales, rollback, full test suite y typecheck;
- ningún cambio en rutas productivas o flags globales.

Después de estos gates se pedirá confirmación operativa final inmediatamente antes de una sola ejecución pagada. La autorización será específica para el envío ya descrito y el límite de MXN 30.

## Riesgos y certeza

- **Certeza alta:** el guard conservador puede impedir que el runner inicie una llamada que rebase el presupuesto.
- **Certeza alta:** 15 casos detectan incompatibilidades sistemáticas del pipeline y del proveedor.
- **Certeza media:** el gasto real cabrá holgadamente en MXN 30; depende del usage live y por eso el guard es obligatorio.
- **Certeza baja:** 15 casos estiman con precisión la tasa de éxito de producción. Esa conclusión queda diferida a la evaluación integrada final.
