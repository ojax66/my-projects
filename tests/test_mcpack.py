#!/usr/bin/env python3
"""Teste ponta a ponta do importador: gera um .mcworld e um .mcaddon
sinteticos, importa e verifica o resultado no diretorio /data.

Roda com `python3 tests/test_mcpack.py` — sem dependencias externas.
"""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MCPACK = REPO / "scripts" / "mcpack.py"

BP_UUID = "aaaaaaaa-1111-2222-3333-444444444444"
RP_UUID = "cccccccc-1111-2222-3333-444444444444"

# manifest com comentario e virgula sobrando, como muitos addons publicados
BP_MANIFEST = """{
  // pacote de comportamento
  "format_version": 2,
  "header": { "name": "Dragões BP", "uuid": "%s", "version": [1, 2, 3], },
  "modules": [ { "type": "data", "uuid": "bbbbbbbb-0000-0000-0000-000000000000", "version": [1,2,3] } ]
}""" % BP_UUID

RP_MANIFEST = json.dumps({
    "format_version": 2,
    "header": {"name": "Dragões RP", "uuid": RP_UUID, "version": "2.0.1"},
    "modules": [{"type": "resources", "uuid": "dddddddd-0000-0000-0000-000000000000",
                 "version": [2, 0, 1]}],
})


def zip_dir(src: Path, dest: Path) -> Path:
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(src.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(src).as_posix())
    return dest


class ImporterTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="mcpack-test-"))
        self.data = self.tmp / "data"
        self.env = self.tmp / ".env"
        self.env.write_text("LEVEL_NAME=world\n", encoding="utf-8")

        world = self.tmp / "src-world"
        (world / "db").mkdir(parents=True)
        (world / "level.dat").write_bytes(b"\x00fake level")
        (world / "db" / "000003.log").write_bytes(b"\x00")
        (world / "levelname.txt").write_text("Mundo do Dragão\n", encoding="utf-8")
        self.mcworld = zip_dir(world, self.tmp / "MeuMundo.mcworld")

        addon = self.tmp / "src-addon"
        (addon / "BP").mkdir(parents=True)
        (addon / "RP").mkdir(parents=True)
        (addon / "BP" / "manifest.json").write_text(BP_MANIFEST, encoding="utf-8")
        (addon / "RP" / "manifest.json").write_text(RP_MANIFEST, encoding="utf-8")
        self.mcaddon = zip_dir(addon, self.tmp / "pack.mcaddon")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_mcpack(self, *args, expect_success=True):
        proc = subprocess.run(
            [sys.executable, str(MCPACK), "--data", str(self.data), "--env-file", str(self.env), *args],
            capture_output=True, text=True,
        )
        if expect_success:
            self.assertEqual(proc.returncode, 0, f"falhou: {proc.stderr}\n{proc.stdout}")
        return proc

    def registry(self, world: str, kind: str):
        path = self.data / "worlds" / world / f"world_{kind}_packs.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []

    # -- mundos ------------------------------------------------------------ #
    def test_import_world_activates_and_preserves_name(self):
        self.run_mcpack("world", str(self.mcworld), "--activate")
        world = self.data / "worlds" / "mundo-do-dragao"
        self.assertTrue((world / "level.dat").is_file())
        self.assertTrue((world / "db" / "000003.log").is_file())
        self.assertEqual((world / "levelname.txt").read_text(encoding="utf-8").strip(), "Mundo do Dragão")
        self.assertIn("LEVEL_NAME=mundo-do-dragao", self.env.read_text(encoding="utf-8"))

    def test_reimport_world_keeps_previous_copy(self):
        self.run_mcpack("world", str(self.mcworld), "--activate")
        self.run_mcpack("world", str(self.mcworld), "--activate")
        self.assertTrue((self.data / "worlds" / "mundo-do-dragao.bak").is_dir())

    def test_world_without_level_dat_is_rejected(self):
        bogus = self.tmp / "vazio"
        bogus.mkdir()
        (bogus / "leia-me.txt").write_text("nada aqui", encoding="utf-8")
        proc = self.run_mcpack("world", str(zip_dir(bogus, self.tmp / "x.mcworld")), expect_success=False)
        self.assertEqual(proc.returncode, 1)
        self.assertIn("level.dat", proc.stderr)

    # -- addons ------------------------------------------------------------ #
    def test_import_addon_installs_and_registers(self):
        self.run_mcpack("world", str(self.mcworld), "--activate")
        self.run_mcpack("addon", str(self.mcaddon))

        bp = self.data / "behavior_packs" / f"dragoes-bp-{BP_UUID[:8]}"
        rp = self.data / "resource_packs" / f"dragoes-rp-{RP_UUID[:8]}"
        self.assertTrue((bp / "manifest.json").is_file(), "behavior pack nao instalado")
        self.assertTrue((rp / "manifest.json").is_file(), "resource pack nao instalado")

        self.assertEqual(self.registry("mundo-do-dragao", "behavior"),
                         [{"pack_id": BP_UUID, "version": [1, 2, 3]}])
        # versao em string vira lista de inteiros
        self.assertEqual(self.registry("mundo-do-dragao", "resource"),
                         [{"pack_id": RP_UUID, "version": [2, 0, 1]}])

    def test_reimport_addon_does_not_duplicate(self):
        self.run_mcpack("world", str(self.mcworld), "--activate")
        self.run_mcpack("addon", str(self.mcaddon))
        self.run_mcpack("addon", str(self.mcaddon))
        self.assertEqual(len(self.registry("mundo-do-dragao", "behavior")), 1)

    def test_addon_with_nested_mcpack(self):
        """.mcaddon que contem .mcpack em vez de pastas."""
        self.run_mcpack("world", str(self.mcworld), "--activate")
        nested = self.tmp / "nested"
        nested.mkdir()
        zip_dir(self.tmp / "src-addon" / "BP", nested / "bp.mcpack")
        zip_dir(self.tmp / "src-addon" / "RP", nested / "rp.mcpack")
        self.run_mcpack("addon", str(zip_dir(nested, self.tmp / "nested.mcaddon")))
        self.assertEqual(len(self.registry("mundo-do-dragao", "behavior")), 1)
        self.assertEqual(len(self.registry("mundo-do-dragao", "resource")), 1)

    def test_addon_without_world_fails_clearly(self):
        proc = self.run_mcpack("addon", str(self.mcaddon), expect_success=False)
        self.assertEqual(proc.returncode, 1)
        self.assertIn("nao existe", proc.stderr)

    def test_corrupt_archive_fails_clearly(self):
        bad = self.tmp / "bad.mcaddon"
        bad.write_text("isto nao e um zip", encoding="utf-8")
        self.run_mcpack("world", str(self.mcworld), "--activate")
        proc = self.run_mcpack("addon", str(bad), expect_success=False)
        self.assertIn("zip", proc.stderr)

    # -- auto / list / remove ---------------------------------------------- #
    def test_auto_imports_incoming_and_moves_files(self):
        incoming = self.tmp / "incoming"
        incoming.mkdir()
        shutil.copy(self.mcworld, incoming)
        shutil.copy(self.mcaddon, incoming)
        (incoming / "leia-me.txt").write_text("ignorar", encoding="utf-8")

        self.run_mcpack("auto", str(incoming), "--activate")
        self.assertEqual(len(self.registry("mundo-do-dragao", "behavior")), 1)
        self.assertTrue((incoming / "processados" / "pack.mcaddon").is_file())
        self.assertTrue((incoming / "leia-me.txt").is_file(), "arquivo ignorado nao deve ser movido")

    def test_list_and_remove(self):
        self.run_mcpack("world", str(self.mcworld), "--activate")
        self.run_mcpack("addon", str(self.mcaddon))

        listing = self.run_mcpack("list").stdout
        self.assertIn("mundo-do-dragao", listing)
        self.assertIn(BP_UUID, listing)

        self.run_mcpack("remove", RP_UUID)
        self.assertEqual(self.registry("mundo-do-dragao", "resource"), [])
        self.assertFalse((self.data / "resource_packs" / f"dragoes-rp-{RP_UUID[:8]}").exists())

    # -- seguranca ---------------------------------------------------------- #
    def test_zip_slip_is_blocked(self):
        evil = self.tmp / "evil.mcworld"
        with zipfile.ZipFile(evil, "w") as zf:
            zf.writestr("../../escapou.txt", "nao deveria sair do destino")
        proc = self.run_mcpack("world", str(evil), expect_success=False)
        self.assertEqual(proc.returncode, 1)
        self.assertIn("suspeita", proc.stderr)
        self.assertFalse((self.tmp.parent / "escapou.txt").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
