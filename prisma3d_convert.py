#!/usr/bin/env python3
"""
Converte modelos 3D para um pacote que o Prisma3D consegue importar.

O Prisma3D le OBJ (+MTL) com as texturas em arquivos de imagem soltos ao lado.
Modelos em GLB/GLTF/DAE/PLY/STL/OFF, com textura embutida, com material PBR de
varios mapas, com escala/eixo errados ou com poligonos demais nao abrem (ou
abrem sem cor). Este script resolve isso:

  - le GLB, GLTF, OBJ, DAE, PLY, STL, OFF, 3MF (tudo que o trimesh abre);
  - extrai a textura embutida para PNG/JPG ao lado do OBJ;
  - reduz o material ao base color (descarta normal/roughness/metallic/AO);
  - assa cor por vertice em textura quando o modelo nao tem imagem (xatlas);
  - redimensiona texturas grandes demais para celular;
  - decima a malha ate um orcamento de triangulos, preservando as UVs;
  - corrige eixo (Z-up -> Y-up), centraliza, apoia no chao e normaliza escala;
  - escreve nomes de arquivo sem acento/espaco e caminhos relativos no .mtl.

Uso:
    python3 prisma3d_convert.py modelo.glb
    python3 prisma3d_convert.py modelo.glb -o saida --max-tris 80000 --tex-size 1024
    python3 prisma3d_convert.py modelo.glb --up z --scale-to 2 --floor --zip
    python3 prisma3d_convert.py modelo.glb --split      # um OBJ por objeto
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

# Metas que costumam rodar liso em celular.
DEFAULT_MAX_TRIS = 150_000
DEFAULT_TEX_SIZE = 2048
JPEG_QUALITY = 92
MIN_TRIS_TO_DECIMATE = 1000  # abaixo disso a peca nao pesa e so perde forma


# --------------------------------------------------------------------------- #
# utilidades
# --------------------------------------------------------------------------- #
def slug(name: str, fallback: str = "objeto") -> str:
    """Nome de arquivo ASCII, sem espaco/acento: o parser de OBJ do app engasga."""
    name = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode()
    name = re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("._-")
    return name or fallback


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} GB"


def log(msg: str = "") -> None:
    print(msg, flush=True)


# --------------------------------------------------------------------------- #
# modelo em memoria
# --------------------------------------------------------------------------- #
@dataclass
class Part:
    """Um objeto do modelo, ja com material resolvido em base color."""

    name: str
    mesh: trimesh.Trimesh
    uv: np.ndarray | None = None
    image: Image.Image | None = None
    color: tuple[int, int, int] = (204, 204, 204)
    opacity: float = 1.0
    material: str = field(default="", init=False)

    @property
    def tris(self) -> int:
        return len(self.mesh.faces)


def _base_color(material) -> tuple[tuple[int, int, int], float]:
    """Cor difusa do material, seja ele PBR (glTF) ou simples (OBJ/MTL)."""
    raw = None
    for attr in ("baseColorFactor", "diffuse", "main_color"):
        raw = getattr(material, attr, None)
        if raw is not None:
            break
    if raw is None:
        return (204, 204, 204), 1.0
    arr = np.asarray(raw, dtype=float).ravel()
    if arr.size < 3:
        return (204, 204, 204), 1.0
    if arr.max() <= 1.0:  # glTF usa 0-1, MTL/trimesh as vezes 0-255
        arr = arr * 255.0
    rgb = tuple(int(np.clip(v, 0, 255)) for v in arr[:3])
    opacity = float(np.clip(arr[3] / 255.0, 0.0, 1.0)) if arr.size > 3 else 1.0
    return rgb, opacity  # type: ignore[return-value]


def _base_texture(material) -> Image.Image | None:
    """So o base color: normal/roughness/metallic/AO o Prisma3D ignora."""
    for attr in ("baseColorTexture", "image", "emissiveTexture"):
        img = getattr(material, attr, None)
        if isinstance(img, Image.Image):
            return img
    return None


def _vertex_color_array(mesh: trimesh.Trimesh) -> np.ndarray | None:
    """Cores por vertice (RGB 0-255) quando o modelo pinta assim em vez de textura."""
    visual = getattr(mesh, "visual", None)
    if getattr(visual, "kind", None) not in ("vertex", "face"):
        return None
    try:
        colors = np.asarray(visual.vertex_colors, dtype=np.float32)
    except Exception:
        return None
    if colors.ndim != 2 or len(colors) != len(mesh.vertices):
        return None
    return colors[:, :3]


def _make_part(name: str, mesh: trimesh.Trimesh) -> Part:
    part = Part(name=name, mesh=mesh)
    visual = getattr(mesh, "visual", None)

    uv = getattr(visual, "uv", None)
    if uv is not None and len(uv) == len(mesh.vertices):
        part.uv = np.asarray(uv, dtype=np.float32)

    material = getattr(visual, "material", None)
    if material is not None:
        part.color, part.opacity = _base_color(material)
        img = _base_texture(material)
        if img is not None and part.uv is not None:
            part.image = img  # textura sem UV nao pinta nada
    else:  # sem material: usa a media das cores por vertice como Kd
        colors = _vertex_color_array(mesh)
        if colors is not None:
            part.color = tuple(int(v) for v in colors.mean(axis=0))  # type: ignore[assignment]
    return part


def load_parts(path: Path) -> list[Part]:
    """Le o arquivo e devolve os objetos ja no espaco do mundo."""
    scene = trimesh.load(path, process=False, force=None)

    if isinstance(scene, trimesh.Scene):
        parts = []
        # dump aplica as transformacoes da cena em cada geometria
        for geom in scene.dump(concatenate=False):
            if not isinstance(geom, trimesh.Trimesh) or len(geom.faces) == 0:
                continue
            parts.append(_make_part(getattr(geom, "metadata", {}).get("name", "") or
                                    getattr(geom, "name", "") or f"parte{len(parts) + 1}", geom))
        return parts

    if isinstance(scene, trimesh.Trimesh):
        return [_make_part(path.stem, scene)]

    raise SystemExit(f"nao consegui interpretar '{path.name}' como malha 3D")


# --------------------------------------------------------------------------- #
# geometria
# --------------------------------------------------------------------------- #
def decimate(part: Part, target_faces: int) -> bool:
    """Reduz triangulos preservando UV. Devolve True se decimou."""
    import fast_simplification as fs

    faces = part.mesh.faces
    if len(faces) < MIN_TRIS_TO_DECIMATE or target_faces >= len(faces) or target_faces < 4:
        return False

    verts = np.asarray(part.mesh.vertices, dtype=np.float32)
    idx = np.asarray(faces, dtype=np.int32)
    reduction = float(np.clip(1.0 - target_faces / len(faces), 0.0, 0.99))

    points, new_faces, collapses = fs.simplify(verts, idx, reduction, return_collapses=True)
    new_uv = None
    if part.uv is not None:
        _, _, mapping = fs.replay_simplification(verts, idx, collapses)
        mapping = np.asarray(mapping)
        new_uv = np.zeros((len(points), 2), dtype=np.float32)
        new_uv[mapping] = part.uv  # vertice sobrevivente herda a UV do original

    part.mesh = trimesh.Trimesh(vertices=points, faces=new_faces, process=False)
    part.uv = new_uv
    return True


def apply_transform(parts: list[Part], matrix: np.ndarray) -> None:
    for part in parts:
        part.mesh.apply_transform(matrix)


def fix_orientation(parts: list[Part], up: str) -> str:
    """Z-up (Blender/DAE/FBX) vira Y-up, que e o que o Prisma3D espera."""
    if up == "y":
        return "ja estava Y-up"
    if up == "auto":
        bounds = np.vstack([p.mesh.bounds for p in parts])
        size = bounds.max(axis=0) - bounds.min(axis=0)
        # heuristica: personagem/objeto em pe costuma ser mais alto que fundo
        if not (size[2] > size[1] * 1.25):
            return "mantido Y-up (nada indicou Z-up)"
    matrix = trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])
    apply_transform(parts, matrix)
    return "girado Z-up -> Y-up"


def fit(parts: list[Part], scale_to: float | None, center: bool, floor: bool) -> str:
    def bounds() -> tuple[np.ndarray, np.ndarray]:
        stacked = np.vstack([p.mesh.bounds for p in parts])
        return stacked.min(axis=0), stacked.max(axis=0)

    lo, hi = bounds()
    size = hi - lo
    notes = [f"tamanho original {size[0]:.2f} x {size[1]:.2f} x {size[2]:.2f}"]

    if scale_to and float(size.max()) > 0:
        factor = scale_to / float(size.max())
        apply_transform(parts, trimesh.transformations.scale_matrix(factor))
        lo, hi = bounds()
        notes.append(f"escala x{factor:.4g} (maior lado = {scale_to})")

    offset = np.zeros(3)
    if center:
        offset = -(lo + hi) / 2.0
        notes.append("centralizado")
    if floor:
        offset[1] = -lo[1]  # base encosta em y=0 (depois de centralizar em x/z)
        notes.append("apoiado no chao (y=0)")
    if np.any(offset):
        apply_transform(parts, trimesh.transformations.translation_matrix(offset))
    return "; ".join(notes)


# --------------------------------------------------------------------------- #
# texturas
# --------------------------------------------------------------------------- #
def bake_vertex_colors(part: Part, size: int) -> bool:
    """Modelo colorido por vertice (sem imagem) fica branco no app: assa em textura."""
    if part.image is not None:
        return False
    colors = _vertex_color_array(part.mesh)
    if colors is None:
        return False
    try:
        import xatlas
    except ImportError:
        return False

    verts = np.asarray(part.mesh.vertices, dtype=np.float32)
    faces = np.asarray(part.mesh.faces, dtype=np.uint32)

    vmap, indices, uvs = xatlas.parametrize(verts, faces)
    part.mesh = trimesh.Trimesh(vertices=verts[vmap], faces=indices.astype(np.int64), process=False)
    part.uv = uvs.astype(np.float32)
    colors = colors[vmap]

    canvas = np.zeros((size, size, 3), dtype=np.float32)
    filled = np.zeros((size, size), dtype=bool)
    pix = np.column_stack([uvs[:, 0] * (size - 1), (1.0 - uvs[:, 1]) * (size - 1)])

    for tri in indices:
        p = pix[tri]
        c = colors[tri]
        x0, y0 = np.floor(p.min(axis=0)).astype(int)
        x1, y1 = np.ceil(p.max(axis=0)).astype(int)
        x0, y0 = max(x0 - 1, 0), max(y0 - 1, 0)
        x1, y1 = min(x1 + 1, size - 1), min(y1 + 1, size - 1)
        if x1 <= x0 or y1 <= y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        v0, v1 = p[1] - p[0], p[2] - p[0]
        denom = v0[0] * v1[1] - v1[0] * v0[1]
        if abs(denom) < 1e-9:
            continue
        v2x, v2y = xs - p[0][0], ys - p[0][1]
        b = (v2x * v1[1] - v1[0] * v2y) / denom
        g = (v0[0] * v2y - v2x * v0[1]) / denom
        a = 1.0 - b - g
        inside = (a >= -0.002) & (b >= -0.002) & (g >= -0.002)
        if not inside.any():
            continue
        rgb = (a[..., None] * c[0] + b[..., None] * c[1] + g[..., None] * c[2])
        canvas[ys[inside], xs[inside]] = rgb[inside]
        filled[ys[inside], xs[inside]] = True

    # dilata algumas vezes para o filtro bilinear nao puxar preto das bordas
    for _ in range(4):
        holes = ~filled
        if not holes.any():
            break
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            shifted = np.roll(np.roll(canvas, dy, axis=0), dx, axis=1)
            shifted_f = np.roll(np.roll(filled, dy, axis=0), dx, axis=1)
            take = holes & shifted_f
            canvas[take] = shifted[take]
            filled |= take

    part.image = Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8), "RGB")
    return True


def prepare_texture(img: Image.Image, max_size: int, force_jpg: bool) -> tuple[Image.Image, str]:
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    img = img.convert("RGBA" if has_alpha and not force_jpg else "RGB")
    if max(img.size) > max_size:
        ratio = max_size / max(img.size)
        img = img.resize((max(1, int(img.width * ratio)), max(1, int(img.height * ratio))),
                         Image.LANCZOS)
    return img, ("png" if img.mode == "RGBA" else "jpg")


# --------------------------------------------------------------------------- #
# escrita OBJ / MTL
# --------------------------------------------------------------------------- #
def assign_materials(parts: list[Part]) -> dict[str, Part]:
    """Junta partes que compartilham a mesma imagem/cor num material so."""
    materials: dict[str, Part] = {}
    seen: dict[tuple, str] = {}
    for part in parts:
        key = (id(part.image), part.color, round(part.opacity, 3)) if part.image else \
              ("cor", part.color, round(part.opacity, 3))
        if key not in seen:
            name = slug(part.name, "material")
            candidate, n = name, 2
            while candidate in materials:
                candidate, n = f"{name}_{n}", n + 1
            seen[key] = candidate
            materials[candidate] = part
        part.material = seen[key]
    return materials


def write_mtl(path: Path, materials: dict[str, Part], textures: dict[str, str]) -> None:
    lines = ["# gerado por prisma3d_convert.py", ""]
    for name, part in materials.items():
        r, g, b = (c / 255.0 for c in part.color)
        lines += [
            f"newmtl {name}",
            "Ka 0.000000 0.000000 0.000000",
            f"Kd {r:.6f} {g:.6f} {b:.6f}",
            "Ks 0.000000 0.000000 0.000000",
            "Ns 1.000000",
            f"d {part.opacity:.6f}",
            "illum 1",
        ]
        if name in textures:
            lines.append(f"map_Kd {textures[name]}")  # caminho relativo, sempre
        lines.append("")
    path.write_text("\n".join(lines), encoding="ascii")


def write_obj(path: Path, parts: list[Part], mtl_name: str, normals: bool) -> None:
    v_off = vt_off = vn_off = 1
    with path.open("w", encoding="ascii", newline="\n") as fh:
        fh.write("# gerado por prisma3d_convert.py\n")
        fh.write(f"mtllib {mtl_name}\n")
        for part in parts:
            mesh = part.mesh
            fh.write(f"o {slug(part.name)}\n")
            np.savetxt(fh, np.asarray(mesh.vertices, dtype=np.float64), fmt="v %.6f %.6f %.6f")

            has_uv = part.uv is not None and len(part.uv) == len(mesh.vertices)
            if has_uv:
                np.savetxt(fh, np.asarray(part.uv, dtype=np.float64), fmt="vt %.6f %.6f")
            if normals:
                np.savetxt(fh, np.asarray(mesh.vertex_normals, dtype=np.float64),
                           fmt="vn %.4f %.4f %.4f")

            fh.write(f"usemtl {part.material}\n")
            faces = np.asarray(mesh.faces, dtype=np.int64)
            v = faces + v_off
            if has_uv and normals:
                block = np.column_stack([v[:, 0], faces[:, 0] + vt_off, faces[:, 0] + vn_off,
                                         v[:, 1], faces[:, 1] + vt_off, faces[:, 1] + vn_off,
                                         v[:, 2], faces[:, 2] + vt_off, faces[:, 2] + vn_off])
                fmt = "f %d/%d/%d %d/%d/%d %d/%d/%d"
            elif has_uv:
                block = np.column_stack([v[:, 0], faces[:, 0] + vt_off,
                                         v[:, 1], faces[:, 1] + vt_off,
                                         v[:, 2], faces[:, 2] + vt_off])
                fmt = "f %d/%d %d/%d %d/%d"
            elif normals:
                block = np.column_stack([v[:, 0], faces[:, 0] + vn_off,
                                         v[:, 1], faces[:, 1] + vn_off,
                                         v[:, 2], faces[:, 2] + vn_off])
                fmt = "f %d//%d %d//%d %d//%d"
            else:
                block, fmt = v, "f %d %d %d"
            np.savetxt(fh, block, fmt=fmt)

            v_off += len(mesh.vertices)
            if has_uv:
                vt_off += len(part.uv)
            if normals:
                vn_off += len(mesh.vertices)


LEIA_ME = """COMO IMPORTAR NO PRISMA3D

1. Copie esta pasta inteira para o celular (Downloads, por exemplo).
   O .obj, o .mtl e as imagens de textura precisam ficar JUNTOS, na mesma pasta.
2. No Prisma3D: menu -> Import -> escolha o arquivo {obj}.
3. Se o modelo aparecer sem cor, entre no material do objeto e aponte a
   textura manualmente para o arquivo em texturas/.

Resumo desta conversao:
{resumo}

Se travar ao importar, rode de novo com metas menores, por exemplo:
    python3 prisma3d_convert.py <modelo> --max-tris 60000 --tex-size 1024
ou gere um arquivo por objeto e importe um de cada vez:
    python3 prisma3d_convert.py <modelo> --split
"""


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Converte um modelo 3D para OBJ+MTL+texturas que o Prisma3D importa.")
    p.add_argument("entrada", type=Path, help="modelo de entrada (glb, gltf, obj, dae, ply, stl...)")
    p.add_argument("-o", "--saida", type=Path, default=None, help="pasta de saida")
    p.add_argument("--max-tris", type=int, default=DEFAULT_MAX_TRIS,
                   help=f"orcamento de triangulos (padrao {DEFAULT_MAX_TRIS}); 0 desliga")
    p.add_argument("--tex-size", type=int, default=DEFAULT_TEX_SIZE,
                   help=f"lado maximo da textura (padrao {DEFAULT_TEX_SIZE})")
    p.add_argument("--jpg", action="store_true", help="forca JPG mesmo com transparencia")
    p.add_argument("--up", choices=("auto", "y", "z"), default="auto",
                   help="eixo para cima do modelo original (padrao auto)")
    p.add_argument("--scale-to", type=float, default=None,
                   help="redimensiona para o maior lado ter este tamanho")
    p.add_argument("--center", action="store_true", help="centraliza no origem")
    p.add_argument("--floor", action="store_true", help="apoia a base em y=0")
    p.add_argument("--split", action="store_true", help="um OBJ por objeto do modelo")
    p.add_argument("--no-normals", action="store_true", help="nao grava normais (arquivo menor)")
    p.add_argument("--no-bake", action="store_true", help="nao assa cor de vertice em textura")
    p.add_argument("--zip", action="store_true", help="tambem gera um .zip da pasta de saida")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    src: Path = args.entrada
    if not src.exists():
        log(f"arquivo nao encontrado: {src}")
        return 1

    outdir: Path = args.saida or src.parent / f"{slug(src.stem)}_prisma3d"
    outdir.mkdir(parents=True, exist_ok=True)
    texdir = outdir / "texturas"

    log(f"lendo {src.name} ({human(src.stat().st_size)}) ...")
    parts = load_parts(src)
    if not parts:
        log("nenhuma malha encontrada no arquivo")
        return 1

    tris_before = sum(p.tris for p in parts)
    log(f"  {len(parts)} objeto(s), {tris_before} triangulos")
    resumo = [f"entrada: {src.name} ({human(src.stat().st_size)})",
              f"objetos: {len(parts)}", f"triangulos originais: {tris_before}"]

    # --- geometria e texturas ----------------------------------------------
    resumo.append("orientacao: " + fix_orientation(parts, args.up))
    resumo.append("ajuste: " + fit(parts, args.scale_to, args.center, args.floor))

    # --- texturas ----------------------------------------------------------
    if not args.no_bake:
        for part in parts:
            if bake_vertex_colors(part, min(args.tex_size, 1024)):
                log(f"  cor de vertice de '{part.name}' assada em textura")
                resumo.append(f"cor por vertice assada em textura: {part.name}")

    if args.max_tris and tris_before > args.max_tris:
        log(f"decimando para ~{args.max_tris} triangulos ...")
        small = sum(p.tris for p in parts if p.tris < MIN_TRIS_TO_DECIMATE)
        big = max(1, tris_before - small)
        ratio = max(0.05, (args.max_tris - small) / big)
        for part in parts:
            decimate(part, max(MIN_TRIS_TO_DECIMATE, int(part.tris * ratio)))
        tris_after = sum(p.tris for p in parts)
        log(f"  {tris_before} -> {tris_after} triangulos")
        resumo.append(f"triangulos finais: {tris_after} (decimado)")
    else:
        resumo.append(f"triangulos finais: {tris_before}")

    materials = assign_materials(parts)
    textures: dict[str, str] = {}
    for name, part in materials.items():
        if part.image is None:
            continue
        img, ext = prepare_texture(part.image, args.tex_size, args.jpg)
        texdir.mkdir(exist_ok=True)
        filename = f"{name}.{ext}"
        target = texdir / filename
        if ext == "jpg":
            img.save(target, quality=JPEG_QUALITY, optimize=True)
        else:
            img.save(target, optimize=True)
        textures[name] = f"texturas/{filename}"
        log(f"  textura {filename}: {img.width}x{img.height} ({human(target.stat().st_size)})")
    resumo.append(f"materiais: {len(materials)} | texturas: {len(textures)}")

    # --- escrita -----------------------------------------------------------
    base = slug(src.stem, "modelo")
    normals = not args.no_normals
    written: list[Path] = []

    if args.split:
        for i, part in enumerate(parts, 1):
            name = f"{base}_{i:02d}_{slug(part.name)}"
            mtl = outdir / f"{name}.mtl"
            write_mtl(mtl, {part.material: materials[part.material]},
                      {k: v for k, v in textures.items() if k == part.material})
            obj = outdir / f"{name}.obj"
            write_obj(obj, [part], mtl.name, normals)
            written += [obj, mtl]
    else:
        mtl = outdir / f"{base}.mtl"
        write_mtl(mtl, materials, textures)
        obj = outdir / f"{base}.obj"
        write_obj(obj, parts, mtl.name, normals)
        written += [obj, mtl]

    (outdir / "LEIA-ME.txt").write_text(
        LEIA_ME.format(obj=written[0].name, resumo="\n".join(f"  - {r}" for r in resumo)),
        encoding="utf-8")

    total = sum(f.stat().st_size for f in outdir.rglob("*") if f.is_file())
    log(f"\npronto: {outdir}  ({human(total)})")
    for f in sorted(outdir.rglob("*")):
        if f.is_file():
            log(f"  {f.relative_to(outdir)}  {human(f.stat().st_size)}")

    if args.zip:
        archive = outdir.with_suffix(".zip")
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in sorted(outdir.rglob("*")):
                if f.is_file():
                    zf.write(f, f.relative_to(outdir.parent))
        log(f"  zip: {archive.name} ({human(archive.stat().st_size)})")

    return 0


if __name__ == "__main__":
    sys.exit(main())
