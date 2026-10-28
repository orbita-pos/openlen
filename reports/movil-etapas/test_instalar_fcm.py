import contextlib
import io
import json
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("instalar-fcm-remoto.py")

class InstalacionFcm(unittest.TestCase):
    def setUp(self):
        self.temporal = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporal.cleanup)
        self.entorno = Path(self.temporal.name) / "openlen.env"
        self.anterior = "DATABASE_URL=valor-previo\nOTRA_VARIABLE=conservar\n"
        self.entorno.write_text(self.anterior, encoding="utf-8")
        self.cuenta = {"project_id": "len-movil", "client_email": "prueba@len-movil.iam.gserviceaccount.com", "private_key": "-----BEGIN PRIVATE KEY-----\nSECRETO_DE_PRUEBA\n-----END PRIVATE KEY-----\n"}

    def ejecutar(self, cuenta=None, falla=False):
        salida, errores = io.StringIO(), io.StringIO()
        real_path = Path
        with contextlib.ExitStack() as pila:
            pila.enter_context(patch("pathlib.Path", lambda p: self.entorno if str(p) == "/etc/openlen/openlen.env" else real_path(p)))
            pila.enter_context(patch("sys.stdin", io.StringIO(json.dumps(cuenta or self.cuenta))))
            pila.enter_context(patch("os.fchown", create=True))
            pila.enter_context(patch("os.fchmod", create=True))
            pila.enter_context(contextlib.redirect_stdout(salida))
            pila.enter_context(contextlib.redirect_stderr(errores))
            if falla:
                pila.enter_context(patch("os.replace", side_effect=OSError("fallo de prueba")))
            try:
                runpy.run_path(str(SCRIPT), run_name="__main__")
                codigo = 0
            except SystemExit as e:
                codigo = e.code
        return codigo, salida.getvalue() + errores.getvalue()

    def test_conserva_entorno_y_guarda_json_valido_sin_imprimir_clave(self):
        codigo, salida = self.ejecutar()
        self.assertEqual(codigo, 0)
        nuevo = self.entorno.read_text(encoding="utf-8")
        self.assertTrue(nuevo.startswith(self.anterior))
        linea = nuevo.splitlines()[-1]
        self.assertEqual(json.loads(linea.split("=", 1)[1][1:-1]), self.cuenta)
        self.assertNotIn("SECRETO_DE_PRUEBA", salida)

    def test_repetir_es_idempotente(self):
        self.ejecutar()
        anterior = self.entorno.read_bytes()
        self.assertEqual(self.ejecutar()[0], 0)
        self.assertEqual(self.entorno.read_bytes(), anterior)

    def test_rechaza_otro_proyecto_sin_modificar_entorno(self):
        self.assertEqual(self.ejecutar({**self.cuenta, "project_id": "ajeno"})[0], 1)
        self.assertEqual(self.entorno.read_text(), self.anterior)

    def test_error_atomico_conserva_original_y_limpia_temporal(self):
        self.assertEqual(self.ejecutar(falla=True)[0], 1)
        self.assertEqual(self.entorno.read_text(), self.anterior)
        self.assertEqual(len(list(self.entorno.parent.iterdir())), 1)

if __name__ == "__main__":
    unittest.main()
