#!/usr/bin/env python3
"""Testes do serviço de upload (scripts/uploader.py).

Sobe o serviço em uma porta livre, com MCBE_ROOT apontando para um diretório
temporário, e exercita o fluxo real: token, envio multipart de arquivos
grandes, importação e rejeição de extensões.

Roda com `python3 tests/test_uploader.py` — sem dependências externas.
"""

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
UPLOADER = REPO / "scripts" / "uploader.py"
TOKEN = "token-de-teste-1234"

BP_UUID = "aaaaaaaa-1111-2222-3333-444444444444"


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def multipart(fields: list) -> tuple:
    """fields: [(nome_do_arquivo, bytes)] -> (content_type, corpo)."""
    boundary = "----mcbeTestBoundary9f2a"
    body = b""
    for filename, content in fields:
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="arquivo"; filename="{filename}"\r\n'.encode()
        body += b"Content-Type: application/octet-stream\r\n\r\n"
        body += content + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return f"multipart/form-data; boundary={boundary}", body


class UploaderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="uploader-test-"))
        (cls.tmp / "scripts").mkdir()
        shutil.copy(REPO / "scripts" / "mcpack.py", cls.tmp / "scripts" / "mcpack.py")
        (cls.tmp / "server").mkdir()
        (cls.tmp / "server" / ".env").write_text("LEVEL_NAME=world\n", encoding="utf-8")

        cls.port = free_port()
        env = dict(os.environ, MCBE_ROOT=str(cls.tmp), MCBE_UPLOAD_TOKEN=TOKEN,
                   MCBE_UPLOAD_PORT=str(cls.port))
        cls.proc = subprocess.Popen([sys.executable, str(UPLOADER)], env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                with socket.create_connection(("127.0.0.1", cls.port), timeout=0.5):
                    break
            except OSError:
                if cls.proc.poll() is not None:
                    raise AssertionError(f"servico morreu: {cls.proc.stderr.read().decode()}")
                time.sleep(0.2)
        else:
            raise AssertionError("servico nao subiu a tempo")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    # -- fixtures ----------------------------------------------------------- #
    @staticmethod
    def make_world(payload_size: int = 0) -> bytes:
        import io
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("level.dat", b"\x00fake level")
            zf.writestr("levelname.txt", "Mundo do Dragão\n")
            if payload_size:
                # incompressivel, para o arquivo realmente cruzar varios chunks
                zf.writestr("db/000003.log", os.urandom(payload_size))
        return buf.getvalue()

    @staticmethod
    def make_addon() -> bytes:
        import io
        manifest = json.dumps({
            "format_version": 2,
            "header": {"name": "Dragões BP", "uuid": BP_UUID, "version": [1, 2, 3]},
            "modules": [{"type": "data", "uuid": "bbbbbbbb-0000-0000-0000-000000000000",
                         "version": [1, 2, 3]}],
        })
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("BP/manifest.json", manifest)
        return buf.getvalue()

    def url(self, path: str, token: str = TOKEN) -> str:
        return f"http://127.0.0.1:{self.port}{path}?t={token}"

    def post(self, path: str, fields: list, token: str = TOKEN):
        ctype, body = multipart(fields)
        req = urllib.request.Request(self.url(path, token), data=body,
                                     headers={"Content-Type": ctype})
        return urllib.request.urlopen(req, timeout=120)

    # -- testes -------------------------------------------------------------- #
    def test_01_requires_token(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(self.url("/", token="errado"), timeout=10)
        self.assertEqual(ctx.exception.code, 403)

    def test_02_page_renders(self):
        body = urllib.request.urlopen(self.url("/"), timeout=10).read().decode()
        self.assertIn("Servidor Minecraft Bedrock", body)
        self.assertIn("Enviar e instalar", body)

    def test_03_upload_world_and_addon_imports(self):
        # 3 MB de dados aleatorios: exercita o parser em streaming
        resp = self.post("/upload", [("MeuMundo.mcworld", self.make_world(3 * 1024 * 1024)),
                                     ("pack.mcaddon", self.make_addon())])
        body = resp.read().decode()
        self.assertEqual(resp.status, 200)
        self.assertIn("recebidos", body)

        world = self.tmp / "server" / "data" / "worlds" / "mundo-do-dragao"
        self.assertTrue((world / "level.dat").is_file(), body)
        self.assertEqual((world / "db" / "000003.log").stat().st_size, 3 * 1024 * 1024)

        registry = json.loads((world / "world_behavior_packs.json").read_text())
        self.assertEqual(registry, [{"pack_id": BP_UUID, "version": [1, 2, 3]}])

        # arquivos originais saem de incoming/ apos a importacao
        self.assertTrue((self.tmp / "server" / "incoming" / "processados" / "pack.mcaddon").is_file())
        # sem docker no ambiente de teste, o reinicio falha de forma legivel
        self.assertIn("reinicio", body)

    def test_04_rejects_unknown_extension(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.post("/upload", [("virus.sh", b"#!/bin/sh\necho oi\n")])
        body = ctx.exception.read().decode()
        self.assertEqual(ctx.exception.code, 400)
        self.assertIn("ignorados", body)
        self.assertFalse((self.tmp / "server" / "incoming" / "virus.sh").exists())

    def test_05_sanitizes_path_traversal_in_filename(self):
        self.post("/upload", [("../../../etc/mundo.mcworld", self.make_world())])
        self.assertFalse(Path("/etc/mundo.mcworld").exists())
        self.assertFalse((self.tmp.parent / "mundo.mcworld").exists())

    def test_06_packs_page(self):
        body = urllib.request.urlopen(self.url("/packs"), timeout=30).read().decode()
        self.assertIn("mundo-do-dragao", body)

    def test_07_no_temp_files_left_behind(self):
        leftovers = list((self.tmp / "server" / "incoming").glob(".upload-*"))
        self.assertEqual(leftovers, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
