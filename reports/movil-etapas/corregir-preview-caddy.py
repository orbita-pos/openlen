"""Añade sólo la política del marco móvil al Caddyfile activo, conservando drift."""
import datetime
import os
from pathlib import Path
import shutil
import subprocess

config = Path('/etc/caddy/Caddyfile')
anchor = b'\t# Next.js build-time static'
block = (
    b'\t# Token-gated previews may be framed by the packaged Len app.\n'
    b'\t# Append CSP: keep the upstream sandbox and all other security headers.\n'
    b'\theader /p/* {\n'
    b'\t\t-X-Frame-Options\n'
    b'\t\t+Content-Security-Policy "frame-ancestors \'self\' https://localhost capacitor://localhost http://localhost:5173"\n'
    b'\t}\n\n'
)
original = config.read_bytes()
if b'header /p/* {' in original:
    raise SystemExit('La política de preview ya existe; revisar antes de repetir.')
if original.count(anchor) != 1:
    raise SystemExit('Ancla inesperada: no se modifica el servidor.')
candidate = config.with_name('Caddyfile.len-preview-candidate')
backup = config.with_name('Caddyfile.before-len-preview-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S'))
try:
    shutil.copy2(config, candidate)
    candidate.write_bytes(original.replace(anchor, block + anchor, 1))
    subprocess.run(['caddy', 'validate', '--config', str(candidate), '--adapter', 'caddyfile'], check=True)
    if config.read_bytes() != original:
        raise RuntimeError('La configuración cambió durante la validación.')
    shutil.copy2(config, backup)
    os.replace(candidate, config)
    try:
        subprocess.run(['systemctl', 'reload', 'caddy'], check=True)
        subprocess.run(['systemctl', 'is-active', '--quiet', 'caddy'], check=True)
    except BaseException:
        shutil.copy2(backup, config)
        subprocess.run(['systemctl', 'reload', 'caddy'], check=True)
        raise
    print('Política de vista previa aplicada; copia anterior:', backup)
finally:
    candidate.unlink(missing_ok=True)
