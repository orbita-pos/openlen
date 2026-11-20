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
- **Un fichero** sólo se decide si un experimento lo lista en su `overrides` (**dentro de cada experimento** de `ab.json`, no en la raíz: así lo escribe el publicador; son los ficheros cuyos bytes difieren entre B y el control, con barra inicial). Lo decide el experimento que lo lista: su cookie, su reparto, su `prefixB`. Para ellos el sidecar contesta `204` + `X-OpenLen-Serve: <ruta en la release>` (el de B si el visitante es B y B lo trae; el del control si no) y Caddy lo sirve él mismo con `Cache-Control: no-store` **para todos, el control también**: Cloudflare cachea por URL y los bytes de una variante guardados bajo la URL compartida llegarían a quien le toca la otra. Cualquier otro fichero lo sirve Caddy como en cualquier sitio.
- **Por qué decide el sidecar y no Caddy**: Caddy no puede leer el manifiesto, y medido con 2.11.4 `try_files` no admite globs, así que tampoco puede sondear `openlen/ab/*/b/<ruta>`.

## 1. Fallo abierto (lo que pasa cuando el sidecar no está)

🔴 Un sidecar caído, colgado o lento **cuesta el experimento, nunca el sitio**. Medido con Caddy 2.11.4 y el sidecar real:

| Situación | Qué ve el visitante |
|---|---|
| Sidecar parado o caído | Páginas y ficheros del sitio salen **del disco, como control** (`Cache-Control: private, no-store`, cabeceras de seguridad, tipos), con 200; nada da 5xx |
| Sidecar colgado (acepta y no contesta) | La primera petición espera 3 s (`response_header_timeout`) y sale control; las siguientes, **2 ms** (pasa 10 s fuera de rotación: `fail_duration`); a los 10 s se vuelve a probar |
| Sidecar contesta un error en una página (4xx o 5xx) | La página sale **control del disco** (`handle_response`, `no-store`, el mismo `try_files` que master). Un sidecar que no puede leer la release contesta 404 (o 400 si la ruta no es UTF-8): sin esto, cada página de cada sitio con experimento era un 404 de texto plano |
| Sidecar contesta 5xx en un fichero | Control, `private, no-store` (nunca con la caché normal de Caddy). Un 4xx en un fichero se sirve como en cualquier sitio |
| Puerto ocupado al arrancar | El proceso lo dice en el log (`failed to bind A/B sidecar on …`) y sale con código ≠ 0: la unidad queda `failed` |

Límites que se aceptan a propósito:
- Durante la caída, Caddy sirve el control **sin Range ni 304** (en un contexto de error `file_server` responde con el estado del error; se fuerza 200 y se quitan `Range`/`If-*`). Safari no reproduce vídeo sin Range: en un sitio con experimento, un vídeo no se verá en Safari **mientras el sidecar esté caído**.
- Durante la caída los ficheros de un sitio con experimento salen `no-store` (para que Cloudflare no guarde control bajo la URL de un fichero que B sobrescribe).
- Un error de Next detrás de `/c/*`, `/api/f/*`… **no** se contesta con una página: el failover sólo mira lo que se delegó.

## 2. Construir y subir el binario

El sidecar es el **mismo binario** que el borde completo (`openlen-edge`), con otro modo (`--ab-sidecar`, o `OPENLEN_EDGE_MODE=ab-sidecar`). Sin TLS, sin :80/:443, sin ACME, sin base de datos, sin certificados.

🔴 **No uses `infra/scripts/deploy-edge.sh` desde el portátil de Windows**: pide `rsync` y `cargo-zigbuild`, y no están. Se compila **en la caja**, como `deploy.ps1` (paso 6.5) recompila allí los crates de Rust: tarball del workspace, extraer, `cargo` de la caja (`build-crates-on-box.sh` instala `rustup` y `build-essential` si faltan; si la caja no tiene Rust, corre antes `bash /root/build-crates-on-box.sh` una vez o instala `rustup` a mano). Desde la raíz del repo, con el código del sidecar en la rama que se despliega (`openlen` es el alias de ssh que usa `deploy.ps1`; sin él, `root@178.156.175.171`):

```bash
# 1. el workspace, igual que el paso 6.5 de deploy.ps1 (sin node_modules ni target)
tar -czf openlen-workspace.tar.gz --exclude=node_modules --exclude=target Cargo.toml Cargo.lock crates
scp openlen-workspace.tar.gz openlen:/root/

# 2. compilar en la caja. Se conserva /root/ab-sidecar-build/target entre veces (la 2.ª es rápida).
#    La caja tiene 3,8 GB y la app puede ocupar 3,4: sin LTO y con un solo trabajo, para que el
#    kernel no mate a Postgres. La release de Cargo.toml lleva LTO y codegen-units=1: NO es para aquí.
ssh openlen 'set -e; mkdir -p /root/ab-sidecar-build; rm -rf /root/ab-sidecar-build/crates; \
  tar -xzf /root/openlen-workspace.tar.gz -C /root/ab-sidecar-build; rm /root/openlen-workspace.tar.gz; \
  source ~/.cargo/env; cd /root/ab-sidecar-build; \
  CARGO_BUILD_JOBS=1 CARGO_PROFILE_RELEASE_LTO=false CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 \
  cargo build --release --locked -p openlen-edge'

# 3. instalar el binario (mv atómico: el anterior se queda hasta que se reinicia la unidad)
ssh openlen 'install -m 0755 /root/ab-sidecar-build/target/release/openlen-edge /usr/local/bin/openlen-edge.new \
  && mv -f /usr/local/bin/openlen-edge.new /usr/local/bin/openlen-edge'
ssh openlen 'systemctl restart openlen-ab-sidecar'    # la primera vez la unidad aún no existe: §3
rm openlen-workspace.tar.gz
```

Si la caja no aguanta la compilación (el kernel mata a `cargo`), se puede compilar en otro Linux x86_64 —WSL, por ejemplo— con el mismo `cargo build --release --locked -p openlen-edge` y subir `target/release/openlen-edge` con el `scp` + `install` del paso 3.

Sin comprobar en esta máquina: los pasos 1–3 son el patrón del paso 6.5 de `deploy.ps1` aplicado a un solo crate; el primer uso en la caja es su ensayo. `deploy-edge.sh` (el camino de la unidad `openlen-edge` completa) no es el de este sidecar.

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
# un fichero: 204 y, si un experimento lo lista, X-OpenLen-Serve
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

## 8. Límites conocidos

Lo que se sabe y se acepta, para que nadie lo descubra en producción:

1. **Con el sidecar caído se pierden Range y 304 en los sitios con experimento.** En un contexto de error `file_server` responde con el estado del error; se fuerza 200 y se quitan `Range`/`If-*`, así que sale el fichero entero. Safari no reproduce un vídeo sin Range: en esos sitios no se verá **mientras el sidecar esté caído**. Además, durante la caída los ficheros salen `no-store`. Los demás sitios no se enteran.
2. **Un fichero de clase inmutable que B sobrescribe puede seguir, en el navegador de quien vuelve, con los bytes del control.** Caddy sirve `png jpg jpeg gif webp ico woff woff2 avif` con `public, immutable, max-age=2592000`: un visitante que ya los tiene (hasta 30 días), o una copia que Cloudflare guardó antes del lanzamiento, no los vuelve a pedir, y el `no-store` sólo vale para las respuestas que se den **a partir de ahora**. Un experimento que cambia una imagen o una fuente **in situ** sólo llega a esos visitantes cuando caduca su copia. Lo que lo evita: que B cambie el **nombre** del fichero que modifica (otro nombre, otra URL, sin copia previa) o que se purgue al lanzar (la purga actual de `lib/publish/cache-purge.ts` sólo cubre `/` y `/index.html`).
3. **Una página que ya estaba en Cloudflare antes del lanzamiento** (que no sea `/`) puede seguir saliendo del borde hasta que caduque (`s-maxage=3600` y `stale-while-revalidate=86400`): el `private, no-store` del sidecar protege a las respuestas que da desde que existe el experimento.
4. **La ventana de un cambio de release (≈ una petición por publicación).** El sidecar decide contra la release que `<sub>/current` nombra en ese instante, pero Caddy sirve el fichero a través de `<sub>/current` un momento después (su `root` es `current`, no la ruta resuelta, y desde el Caddyfile no se puede cambiar). Una publicación que cambia `current` justo en medio puede darle UNA petición a un visitante de B con la ruta de B contra la release siguiente (un 404 si esa release no trae el fichero) o con el fichero de la siguiente. La petición que viene está bien. (`app/served`, el servidor de los dominios propios, sí lo cierra: lee control, manifiesto y B de una misma release resuelta.)
5. **Una petición espera 3 s la primera vez que el sidecar se cuelga** (`response_header_timeout`); luego, 10 s de caída inmediata (`fail_duration`) y se vuelve a probar.
6. **El sidecar no se reinicia con el deploy** (§2): tras una publicación de binario nuevo, `systemctl restart openlen-ab-sidecar` a mano.

## 9. Cómo se midió (para repetirlo)

- `cargo test` en `crates/edge` (los tests de `tests/ab.rs`, `tests/ab_sidecar.rs` y los unitarios de `src/ab/`), `npx vitest run lib/ab app/served`.
- **Paridad Rust/TS**: las dos suites leen los mismos JSON (`crates/edge/tests/fixtures/ab/hash-vectors.json` y `evaluate.json`; `gen-evaluate.cjs` los regenera). Un caso que pasa en una y falla en la otra es una divergencia entre el borde y el servidor de dominios propios.
- **Caddy de verdad**: `lib/ab/caddy-ab.test.ts` fija el texto del Caddyfile (y, si hay `caddy`, comprueba que adapta); el comportamiento se midió levantando Caddy 2.11.4 con el bloque `*.openlen.app` del Caddyfile contra un árbol `www/<sub>/current` y el binario real `--ab-sidecar`: cabeceras únicas, 206 y 304 en ficheros, el 404 de lo interno escrito de 10 maneras, y los tres fallos de §1.
