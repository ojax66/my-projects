#!/usr/bin/env python3
"""Serviço web mínimo para enviar mundos e addons ao servidor pelo celular.

Sobe uma página em http://<ip>:8080/?t=<token> com um seletor de arquivos.
Cada arquivo enviado vai para server/incoming/, passa pelo mcpack.py e o
servidor é reiniciado — sem SSH, sem scp.

Configuração por variáveis de ambiente:
    MCBE_UPLOAD_TOKEN   obrigatório; sem ele o serviço se recusa a subir
    MCBE_UPLOAD_PORT    porta HTTP (padrão 8080)
    MCBE_ROOT           raiz da instalação (padrão /opt/mcbe)

O tráfego é HTTP puro: o token viaja em claro. Mantenha a porta fechada na
security list quando não estiver enviando arquivos.

Sem dependências externas (stdlib apenas).
"""

from __future__ import annotations

import hmac
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(os.environ.get("MCBE_ROOT", "/opt/mcbe"))
TOKEN = os.environ.get("MCBE_UPLOAD_TOKEN", "").strip()
PORT = int(os.environ.get("MCBE_UPLOAD_PORT", "8080"))
INCOMING = ROOT / "server" / "incoming"
MAX_BYTES = int(os.environ.get("MCBE_UPLOAD_MAX_MB", "2048")) * 1024 * 1024
ALLOWED = {".mcworld", ".mcaddon", ".mcpack", ".mctemplate"}
CHUNK = 256 * 1024

PLACEHOLDER_TOKENS = {"", "troque-este-token", "mude-me", "changeme"}


# --------------------------------------------------------------------------- #
# multipart/form-data em streaming (mundos exportados passam de 1 GB)
# --------------------------------------------------------------------------- #
def parse_multipart(stream, boundary: bytes, total: int, dest_dir: Path) -> list:
    """Grava cada parte-arquivo em disco sem carregar nada na memória.

    Devolve [(nome_informado, caminho_temporario), ...].
    """
    sep = b"--" + boundary
    buf = b""
    remaining = total
    files: list = []

    def fill() -> bool:
        nonlocal buf, remaining
        if remaining <= 0:
            return False
        data = stream.read(min(CHUNK, remaining))
        if not data:
            remaining = 0
            return False
        remaining -= len(data)
        buf += data
        return True

    # posiciona no primeiro separador
    while sep not in buf and fill():
        pass
    if sep not in buf:
        return files
    buf = buf.split(sep, 1)[1]

    while True:
        if buf.startswith(b"--"):  # separador final
            break
        buf = buf.lstrip(b"\r\n")
        while b"\r\n\r\n" not in buf and fill():
            pass
        if b"\r\n\r\n" not in buf:
            break
        raw_headers, buf = buf.split(b"\r\n\r\n", 1)
        headers = raw_headers.decode("utf-8", "replace")
        match = re.search(r'filename="([^"]*)"', headers)
        filename = match.group(1) if match else ""

        fd, tmp_path = tempfile.mkstemp(dir=dest_dir, prefix=".upload-")
        tmp = Path(tmp_path)
        with os.fdopen(fd, "wb") as out:
            while True:
                idx = buf.find(b"\r\n" + sep)
                if idx >= 0:
                    out.write(buf[:idx])
                    buf = buf[idx + 2 + len(sep):]
                    break
                # segura uma cauda que possa conter um separador partido ao meio
                keep = len(sep) + 2
                if len(buf) > keep:
                    out.write(buf[:-keep])
                    buf = buf[-keep:]
                if not fill():
                    out.write(buf)
                    buf = b""
                    break

        if filename:
            files.append((filename, tmp))
        else:
            tmp.unlink(missing_ok=True)
        if not buf and remaining <= 0:
            break
    return files


def safe_name(filename: str) -> str:
    name = Path(filename.replace("\\", "/")).name
    name = re.sub(r"[^A-Za-z0-9._()-]+", "_", name).strip()
    return name[:120] or "arquivo"


# --------------------------------------------------------------------------- #
# ações no servidor
# --------------------------------------------------------------------------- #
def run(cmd: list, cwd: Path | None = None, timeout: int = 900) -> str:
    try:
        proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError:
        return f"$ {' '.join(cmd)}\ncomando nao encontrado\n"
    except subprocess.TimeoutExpired:
        return f"$ {' '.join(cmd)}\ntempo esgotado\n"
    return f"$ {' '.join(cmd)}\n{proc.stdout}{proc.stderr}"


def mcpack(*args: str) -> str:
    return run([sys.executable, str(ROOT / "scripts" / "mcpack.py"),
                "--data", str(ROOT / "server" / "data"),
                "--env-file", str(ROOT / "server" / ".env"), *args])


def restart_server() -> str:
    return run(["docker", "compose", "restart"], cwd=ROOT / "server", timeout=300)


def server_status() -> str:
    return run(["docker", "ps", "--filter", "name=mcbe", "--format", "{{.Status}}"]).splitlines()[-1].strip()


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
PAGE = """<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Servidor Bedrock</title>
<style>
  :root {{ color-scheme: dark; }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; padding:20px; background:#14161a; color:#e8eaed;
         font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }}
  main {{ max-width:640px; margin:0 auto; }}
  h1 {{ font-size:20px; margin:0 0 4px; }}
  .sub {{ color:#9aa0a6; font-size:14px; margin-bottom:20px; }}
  .card {{ background:#1e2126; border:1px solid #2c3036; border-radius:12px;
           padding:16px; margin-bottom:16px; }}
  input[type=file] {{ width:100%; padding:12px; background:#14161a; color:#e8eaed;
                      border:1px dashed #3c4148; border-radius:8px; }}
  button {{ width:100%; margin-top:12px; padding:14px; font-size:16px; font-weight:600;
            border:0; border-radius:8px; background:#3d8b40; color:#fff; }}
  button.alt {{ background:#2c3036; color:#e8eaed; margin-top:0; }}
  button:active {{ opacity:.8; }}
  pre {{ background:#0e1013; border:1px solid #2c3036; border-radius:8px; padding:12px;
         overflow-x:auto; font-size:13px; white-space:pre-wrap; word-break:break-word; }}
  .ok {{ color:#7bc47f; }} .warn {{ color:#e0a458; }}
  .row {{ display:flex; gap:8px; margin-bottom:16px; }} .row form {{ flex:1; margin:0; }}
</style></head><body><main>
<h1>Servidor Minecraft Bedrock</h1>
<div class="sub">{status}</div>
<div class="card">
  <form method="post" action="/upload?t={token}" enctype="multipart/form-data">
    <input type="file" name="arquivo" accept=".mcworld,.mcaddon,.mcpack,.mctemplate" multiple required>
    <button type="submit">Enviar e instalar</button>
  </form>
  <div class="sub" style="margin:12px 0 0">
    Aceita .mcworld, .mcaddon, .mcpack e .mctemplate. Mundos entram primeiro,
    depois os addons. O servidor reinicia sozinho ao final.
  </div>
</div>
<div class="row">
  <form method="get" action="/packs"><input type="hidden" name="t" value="{token}">
    <button class="alt" type="submit">Ver mundos e addons</button></form>
  <form method="post" action="/restart?t={token}">
    <button class="alt" type="submit">Reiniciar servidor</button></form>
</div>
{output}
</main></body></html>
"""


class Handler(BaseHTTPRequestHandler):
    server_version = "mcbe-uploader"
    protocol_version = "HTTP/1.1"

    # --- infraestrutura ---------------------------------------------------- #
    def authorized(self, query: dict) -> bool:
        given = (query.get("t") or [""])[0]
        return hmac.compare_digest(given, TOKEN)

    def page(self, output: str = "", code: int = 200) -> None:
        status = server_status() or "container mcbe nao esta rodando"
        body = PAGE.format(status=html.escape(status), token=html.escape(TOKEN), output=output)
        self.reply(code, body)

    def reply(self, code: int, body: str) -> None:
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    @staticmethod
    def block(title: str, text: str, cls: str = "") -> str:
        return (f'<div class="card"><strong class="{cls}">{html.escape(title)}</strong>'
                f"<pre>{html.escape(text)}</pre></div>")

    def deny(self) -> None:
        self.reply(403, "<h1>403</h1><p>token invalido ou ausente</p>")

    def log_message(self, fmt, *args):  # o journald ja carimba a hora
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # --- rotas -------------------------------------------------------------- #
    def do_GET(self):
        url = urlparse(self.path)
        query = parse_qs(url.query)
        if not self.authorized(query):
            return self.deny()
        if url.path == "/packs":
            return self.page(self.block("mundos e addons", mcpack("list")))
        if url.path in ("/", "/index.html"):
            return self.page()
        self.reply(404, "<h1>404</h1>")

    def do_POST(self):
        url = urlparse(self.path)
        query = parse_qs(url.query)
        if not self.authorized(query):
            return self.deny()

        if url.path == "/restart":
            return self.page(self.block("reinicio", restart_server(), "ok"))
        if url.path != "/upload":
            return self.reply(404, "<h1>404</h1>")

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return self.page(self.block("erro", "requisicao sem corpo", "warn"), 400)
        if length > MAX_BYTES:
            return self.page(self.block(
                "erro", f"envio de {length // 1048576} MB acima do limite de "
                        f"{MAX_BYTES // 1048576} MB", "warn"), 413)

        ctype = self.headers.get("Content-Type", "")
        match = re.search(r'boundary="?([^";]+)"?', ctype)
        if not match:
            return self.page(self.block("erro", "formulario invalido", "warn"), 400)

        INCOMING.mkdir(parents=True, exist_ok=True)
        parts = parse_multipart(self.rfile, match.group(1).encode(), length, INCOMING)

        saved, rejected = [], []
        for filename, tmp in parts:
            name = safe_name(filename)
            if Path(name).suffix.lower() not in ALLOWED:
                tmp.unlink(missing_ok=True)
                rejected.append(name)
                continue
            shutil.move(str(tmp), str(INCOMING / name))
            saved.append(name)

        out = ""
        if rejected:
            out += self.block("ignorados (extensao nao suportada)", "\n".join(rejected), "warn")
        if not saved:
            return self.page(out + self.block("nada importado", "nenhum arquivo valido enviado", "warn"), 400)

        out += self.block("recebidos", "\n".join(saved), "ok")
        out += self.block("importacao", mcpack("auto", "--activate"))
        out += self.block("reinicio", restart_server())
        self.page(out)


def main() -> int:
    if TOKEN in PLACEHOLDER_TOKENS or len(TOKEN) < 12:
        print("MCBE_UPLOAD_TOKEN ausente, ainda no valor de exemplo ou com menos de "
              "12 caracteres; o servico de upload nao vai subir", file=sys.stderr)
        return 1
    INCOMING.mkdir(parents=True, exist_ok=True)
    print(f"upload ouvindo em http://0.0.0.0:{PORT}/?t=<token>  (raiz: {ROOT})", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
