# Runbook — A/B testing en el borde (el sidecar de Caddy)

Operación del A/B testing de páginas (`lib/ab/`, `crates/edge/src/ab/`, `infra/caddy/Caddyfile`). El experimento vive en la release; Caddy sigue siendo el servidor web y le pasa a un proceso pequeño —el **sidecar**— sólo lo que un experimento necesita decidir por visitante.

Esto NO lo despliega `infra/scripts/deploy.ps1` (decisión del 19/11): mientras `OPENLEN_AB_TESTING` esté apagado nadie publica un experimento y nada necesita el sidecar. Se instala **a mano, antes de encender el flag** (§3–§6).

---

## 0. Cómo encaja

```
visitante ─▶ Cloudflare ─▶ Caddy (*.openlen.app)
                              │
   sitio SIN openlen/ab.json ─┴─▶ disco, como siempre            (~99 % de los sitios: el sidecar no se entera)
   sitio CON openlen/ab.json:
     una PÁGINA (sin extensión, .html/.htm) ─▶ sidecar 127.0.0.1:8085 ─▶ responde él, con sus cabeceras
     un FICHERO (css, js, imágenes…)         ─▶ sidecar decide ─▶ Caddy sirve (Range, 304, 404 de marca)
     /openlen/ab.json, /openlen/ab/*         ─▶ 404 de Caddy, sin llegar a nadie
```

- **La release** lleva `openlen/ab.json` (el manifiesto) y el árbol de la variante B en `openlen/ab/<id>/b/…`. `openlen/` es una raíz reservada: ningún fichero del dueño cae ahí.
- **Una página** la sirve el sidecar: reparte al visitante (override `?_ol_ab=a|b`, bot → A, cookie pegajosa, hash), pone la cookie y contesta A o B con `Cache-Control: private, no-store` + `Vary: Cookie`. Una página del sitio que el experimento no cubre sale con la misma política de siempre (`public, max-age=60, s-maxage=3600, stale-while-revalidate=86400`).
- **Un fichero** sólo se decide si el manifiesto lo lista en `overrides` (los ficheros cuyos bytes difieren entre B y el control). Para ellos el sidecar contesta `204` + `X-OpenLen-Serve: <ruta en la release>` (el de B si el visitante es B y B lo trae; el del control si no) y Caddy lo sirve él mismo con `Cache-Control: no-store` **para todos, el control también**: Cloudflare cachea por URL y los bytes de una variante guardados bajo la URL compartida llegarían a quien le toca la otra. Cualquier otro fichero lo sirve Caddy como en cualquier sitio.
- **Por qué decide el sidecar y no Caddy**: Caddy no puede leer el manifiesto, y medido con 2.11.4 `try_files` no admite globs, así que tampoco puede sondear `openlen/ab/*/b/<ruta>`.

## 1. Fallo abierto (lo que pasa cuando el sidecar no está)

🔴 Un sidecar caído, colgado o lento **cuesta el experimento, nunca el sitio**. Medido con Caddy 2.11.4 y el sidecar real:

| Situación | Qué ve el visitante |
|---|---|
| Sidecar parado o caído | Páginas y ficheros del sitio salen **del disco, como control** (`Cache-Control: private, no-store`, cabeceras de seguridad, tipos), con 200; nada da 5xx |
| Sidecar colgado (acepta y no contesta) | La primera petición espera 3 s (`response_header_timeout`) y sale control; las siguientes, **2 ms** (pasa 10 s fuera de rotación: `fail_duration`); a los 10 s se vuelve a probar |
| Sidecar contesta 5xx | Una página sale control (`handle_response`), un fichero se sirve normal |
| Puerto ocupado al arrancar | El proceso lo dice en el log (`failed to bind A/B sidecar on …`) y sale con código ≠ 0: la unidad queda `failed` |

Límites que se aceptan a propósito:
- Durante la caída, Caddy sirve el control **sin Range ni 304** (en un contexto de error `file_server` responde con el estado del error; se fuerza 200 y se quitan `Range`/`If-*`). Safari no reproduce vídeo sin Range: en un sitio con experimento, un vídeo no se verá en Safari **mientras el sidecar esté caído**.
- Durante la caída los ficheros de un sitio con experimento salen `no-store` (para que Cloudflare no guarde control bajo la URL de un fichero que B sobrescribe).
- Un error de Next detrás de `/c/*`, `/api/f/*`… **no** se contesta con una página: el failover sólo mira lo que se delegó.

## 2. Construir y subir el binario

El sidecar es el **mismo binario** que el borde completo (`openlen-edge`), con otro modo (`--ab-sidecar`, o `OPENLEN_EDGE_MODE=ab-sidecar`). Sin TLS, sin :80/:443, sin ACME, sin base de datos, sin certificados.

Desde el portátil:

```bash
bash infra/scripts/deploy-edge.sh        # compila x86_64-unknown-linux-gnu, comprueba el tope, sube a /usr/local/bin/openlen-edge
```

(`deploy-edge.sh` sólo reinicia la unidad `openlen-edge` si está habilitada; el sidecar se reinicia a mano: `systemctl restart openlen-ab-sidecar`.)

## 3. Instalar la unidad

```bash
scp infra/edge/openlen-ab-sidecar.service root@178.156.175.171:/etc/systemd/system/
ssh root@178.156.175.171 'systemctl daemon-reload && systemctl enable --now openlen-ab-sidecar'
```

La unidad usa `DynamicUser=yes` con `SupplementaryGroups=www-data` (lee `/var/www/openlen`, que es de `openlen-deploy:www-data`, y no escribe nada), `ReadOnlyPaths=/var/www/openlen`, `IPAddressAllow=localhost` y sin capacidades. No va ordenada detrás de Caddy ni de la app, y nada depende de ella.

Variables (todas con valor por defecto; opcionales en `/etc/openlen/ab-sidecar.env`):

| Variable | Defecto | Qué hace |
|---|---|---|
| `OPENLEN_EDGE_AB_LOOPBACK_BIND` | `127.0.0.1:8085` | Dónde escucha. Sólo loopback: otra dirección se rechaza al arrancar |
| `OPENLEN_EDGE_PUBLISH_ROOT` | `/var/www/openlen` | Raíz de las releases |
| `OPENLEN_EDGE_PUBLISH_HOSTS` | `openlen.app,openlen.com` | Zonas bajo las que vive `<sub>.<zona>` (cuando Caddy no manda `X-OpenLen-Sub`) |
| `OPENLEN_EDGE_AB_MANIFEST_CACHE_MAX` | `10000` | Entradas máximas de la caché del manifiesto (además hay un presupuesto de 16 MiB) |
| `OPENLEN_EDGE_METRICS_BIND` | sin definir | Sólo si se pide por nombre se levanta el exportador de Prometheus |
| `RUST_LOG` | `info` | Nivel del log |

## 4. Comprobar el sidecar solo

```bash
systemctl is-active openlen-ab-sidecar                 # active
ss -ltnp | grep 8085                                    # SÓLO 127.0.0.1:8085, nada en :80/:443/:9090
journalctl -u openlen-ab-sidecar -n 20 --no-pager       # "A/B loopback sidecar listening"
# un sitio con experimento (cambia <sub> y una ruta real):
curl -si -H 'X-OpenLen-Sub: <sub>' -H 'User-Agent: Mozilla/5.0 Chrome/131' http://127.0.0.1:8085/
# un fichero: 204 y, si el manifiesto lo lista, X-OpenLen-Serve
curl -si -H 'X-OpenLen-Sub: <sub>' http://127.0.0.1:8085/css/site.css
```

## 5. Recargar Caddy y probar el fallo abierto

El Caddyfile lo sube `deploy.ps1` (paso 8: lo valida con `caddy validate` y recarga). **Viaja en el próximo deploy aunque el sidecar todavía no exista, y es seguro**: ningún sitio tiene `openlen/ab.json` mientras el flag esté apagado, así que nada se delega; y si lo tuviera, Caddy falla abierto (§1). Lo único que cambia hoy para todos los sitios es que `/openlen/ab.json` y `/openlen/ab/*` dan el 404 de marca (antes la ruta caía en la portada con un 200). Para ensayarlo antes, con la caja fuera del tráfico o en un sitio de prueba:

```bash
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy
```

Ensayo del fallo (en un sitio de prueba con un experimento publicado):

```bash
systemctl stop openlen-ab-sidecar
curl -si https://<sub>.openlen.app/ | head -12     # 200, Cache-Control: private, no-store, SIN 502
systemctl start openlen-ab-sidecar
curl -si https://<sub>.openlen.app/ | head -12     # Set-Cookie ol_ab_…, X-OpenLen-AB: <id>:<a|b>
```

Y comprobar que lo interno no se sirve, escrito como se escriba:

```bash
for p in /openlen/ab.json /openlen/ab.json/ /openlen/%61b.json /openlen/./ab.json /openlen/ab/ /openlen/ab/<id>/b/index.html; do
  printf '%s ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' --path-as-is https://<sub>.openlen.app$p
done                                                  # todo 404
```

## 6. Encender el flag

Sólo con §3–§5 hechos:

1. `OPENLEN_AB_TESTING=1` en `/etc/openlen/openlen.env`.
2. `systemctl restart openlen-app` (systemd lee el fichero al arrancar).
3. Publicar un experimento de prueba en un sitio propio y mirar: la cookie `ol_ab_<id>`, `X-OpenLen-AB`, `Cache-Control: private, no-store` en la página, y `no-store` en un fichero que B sobrescribe **también sin cookie**.

## 7. Apagar / volver atrás

- **Parar un experimento**: el dueño lo cancela o decide (la publicación siguiente quita `openlen/ab.json` y el árbol de B); el sitio vuelve a Caddy a secas.
- **Apagar todo**: quitar `OPENLEN_AB_TESTING` y reiniciar la app (nada publica experimentos nuevos; los vivos se terminan republicando). Sin hacer nada más, con el sidecar parado el sitio sigue sirviendo control (§1).
- **Quitar el sidecar**: `systemctl disable --now openlen-ab-sidecar`. Caddy sigue sirviendo control; los experimentos vivos quedan en pausa (sin reparto) hasta que se vuelva a levantar.
- **Volver al Caddyfile anterior**: `git revert` del commit y el despliegue normal.

## 8. Cómo se midió (para repetirlo)

- `cargo test` en `crates/edge` (los tests de `tests/ab.rs`, `tests/ab_sidecar.rs` y los unitarios de `src/ab/`), `npx vitest run lib/ab app/served`.
- **Paridad Rust/TS**: las dos suites leen los mismos JSON (`crates/edge/tests/fixtures/ab/hash-vectors.json` y `evaluate.json`; `gen-evaluate.cjs` los regenera). Un caso que pasa en una y falla en la otra es una divergencia entre el borde y el servidor de dominios propios.
- **Caddy de verdad**: `lib/ab/caddy-ab.test.ts` fija el texto del Caddyfile (y, si hay `caddy`, comprueba que adapta); el comportamiento se midió levantando Caddy 2.11.4 con el bloque `*.openlen.app` del Caddyfile contra un árbol `www/<sub>/current` y el binario real `--ab-sidecar`: cabeceras únicas, 206 y 304 en ficheros, el 404 de lo interno escrito de 10 maneras, y los tres fallos de §1.
