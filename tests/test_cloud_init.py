#!/usr/bin/env python3
"""Verificações do arquivo deploy/oracle-cloud-init.yaml.

Não sobe uma VM — checa o que dá para checar sem uma: YAML válido, o
docker-compose embutido idêntico ao do repositório, formato aceito por
docker-compose/systemd nos arquivos de ambiente, sintaxe dos comandos de
runcmd, unidades systemd bem formadas e o tamanho dentro do limite de
metadata da OCI.

Roda com `python3 tests/test_cloud_init.py` — precisa de PyYAML.
"""

import base64
import configparser
import re
import shutil
import subprocess
import unittest
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
CLOUD_INIT = REPO / "deploy" / "oracle-cloud-init.yaml"

# A OCI limita o metadata da instância a ~32 KB e a console manda o script
# em base64; deixamos folga para a chave SSH e o resto do metadata.
MAX_BASE64_BYTES = 30000


class CloudInitTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = CLOUD_INIT.read_bytes()
        cls.doc = yaml.safe_load(cls.raw.decode("utf-8"))
        cls.files = {f["path"]: f["content"] for f in cls.doc["write_files"]}

    def test_starts_with_cloud_config_header(self):
        # sem esta primeira linha o cloud-init trata o arquivo como texto solto
        self.assertTrue(self.raw.decode("utf-8").startswith("#cloud-config\n"))

    def test_fits_in_instance_metadata(self):
        encoded = len(base64.b64encode(self.raw))
        self.assertLess(encoded, MAX_BASE64_BYTES,
                        f"cloud-init com {encoded} bytes em base64: perto do limite da OCI")

    def test_embedded_compose_matches_repo(self):
        self.assertEqual(self.files["/opt/mcbe/server/docker-compose.yml"],
                         (REPO / "server" / "docker-compose.yml").read_text(),
                         "o compose embutido divergiu de server/docker-compose.yml")

    def test_env_files_have_no_inline_comments(self):
        # docker-compose (env_file) e systemd (EnvironmentFile) nao removem
        # comentario no fim da linha: viraria parte do valor
        for path in ("/opt/mcbe/server/.env", "/opt/mcbe/upload.env"):
            for line in self.files[path].splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    self.assertNotIn("#", line, f"{path}: comentario inline em {line!r}")
                    self.assertRegex(line, r"^[A-Z_][A-Z0-9_]*=", f"{path}: linha invalida {line!r}")

    def test_upload_token_ships_as_placeholder(self):
        # o uploader se recusa a subir com este valor; e proposital
        self.assertIn("MCBE_UPLOAD_TOKEN=troque-este-token", self.files["/opt/mcbe/upload.env"])

    def test_systemd_units_are_parseable(self):
        for path, content in self.files.items():
            if not path.startswith("/etc/systemd/"):
                continue
            parser = configparser.ConfigParser(strict=False, interpolation=None)
            parser.optionxform = str
            parser.read_string(content)
            self.assertIn("Unit", parser.sections(), path)
            if path.endswith(".service"):
                self.assertTrue(parser.get("Service", "ExecStart").startswith("/"), path)

    def test_runcmd_shell_snippets_parse(self):
        sh = shutil.which("sh") or "/bin/sh"
        for entry in self.doc["runcmd"]:
            if isinstance(entry, list) and len(entry) == 3 and entry[1] == "-c":
                proc = subprocess.run([sh, "-n", "-c", "true"], capture_output=True)
                self.assertEqual(proc.returncode, 0)
                check = subprocess.run([sh, "-n"], input=entry[2], text=True, capture_output=True)
                self.assertEqual(check.returncode, 0,
                                 f"comando invalido: {entry[2][:80]}...\n{check.stderr}")

    def test_opens_game_and_upload_ports_in_os_firewall(self):
        commands = " ".join(e[2] if isinstance(e, list) else str(e) for e in self.doc["runcmd"])
        for port, proto in (("19132", "udp"), ("19133", "udp"), ("8080", "tcp")):
            self.assertIn(f"-p {proto} --dport {port}", commands,
                          f"porta {port}/{proto} nao liberada no firewall do SO")

    def test_download_falls_back_to_feature_branch(self):
        commands = " ".join(e[2] if isinstance(e, list) else str(e) for e in self.doc["runcmd"])
        urls = re.findall(r"https://github\.com/\S+?\.tar\.gz", commands)
        self.assertGreaterEqual(len(urls), 2, "sem URL alternativa para baixar os scripts")
        self.assertTrue(any("main" in u for u in urls))

    def test_starts_server_and_services(self):
        commands = " ".join(e[2] if isinstance(e, list) else str(e) for e in self.doc["runcmd"])
        self.assertIn("docker compose up -d", commands)
        self.assertIn("mcbe-upload.service", commands)
        self.assertIn("mcbe-backup.timer", commands)


if __name__ == "__main__":
    unittest.main(verbosity=2)
