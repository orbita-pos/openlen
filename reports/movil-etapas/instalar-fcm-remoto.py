"""Instala sólo FCM por stdin; conserva el resto del entorno y no imprime secretos."""
import json
import os
from pathlib import Path
import stat
import sys
import tempfile

try:
    entrada = sys.stdin.read(64001)
    if len(entrada) > 64000:
        raise ValueError()
    cuenta = json.loads(entrada)
    if (cuenta.get("project_id") != "len-movil"
            or not cuenta.get("client_email", "").endswith("@len-movil.iam.gserviceaccount.com")
            or "PRIVATE KEY" not in cuenta.get("private_key", "")):
        raise ValueError()
    minimo = {k: cuenta[k] for k in ("project_id", "client_email", "private_key")}
    valor = json.dumps(minimo, separators=(",", ":"))
    if "'" in valor:
        raise ValueError()
    linea = "FCM_SERVICE_ACCOUNT_JSON='" + valor + "'"
    destino = Path("/etc/openlen/openlen.env")
    if destino.is_symlink() or not destino.is_file():
        raise ValueError()
    info = destino.stat()
    anterior = destino.read_text(encoding="utf-8")
    existentes = [x for x in anterior.splitlines() if x.startswith("FCM_SERVICE_ACCOUNT_JSON=")]
    if existentes:
        if existentes != [linea]:
            raise ValueError()
        print("FCM ya estaba configurado con esta credencial; entorno conservado.")
    else:
        nuevo = anterior + ("" if not anterior or anterior.endswith("\n") else "\n") + linea + "\n"
        descriptor, temporal = tempfile.mkstemp(prefix=".openlen-fcm-", dir=destino.parent)
        try:
            os.fchown(descriptor, info.st_uid, info.st_gid)
            os.fchmod(descriptor, stat.S_IMODE(info.st_mode) & 0o770)
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as archivo:
                archivo.write(nuevo)
                archivo.flush()
                os.fsync(archivo.fileno())
            os.replace(temporal, destino)
        finally:
            if os.path.exists(temporal):
                os.unlink(temporal)
        print("FCM configurado en el entorno privado del servidor. Resto de variables conservado.")
except Exception:
    print("No se pudo instalar FCM; no se muestran datos privados.", file=sys.stderr)
    sys.exit(1)
