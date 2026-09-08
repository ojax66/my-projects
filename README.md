# Dragon-forge-

Ferramentas do projeto.

## prisma3d_convert.py — deixa um modelo 3D importável no Prisma3D

O Prisma3D lê **OBJ + MTL com as texturas em arquivos de imagem soltos ao lado**.
Modelo em GLB/GLTF/DAE, textura embutida no arquivo, material PBR com vários
mapas, escala ou eixo errados, polígono demais pra celular, caminho de textura
apontando pra pasta do PC, nome com acento — qualquer um desses faz o modelo
não abrir, abrir branco ou travar o app. O script resolve tudo isso de uma vez.

### O que ele faz

- lê **GLB, GLTF, OBJ, DAE, PLY, STL, OFF, 3MF** (tudo que o `trimesh` abre);
- extrai a **textura embutida** e grava como PNG/JPG ao lado do OBJ;
- reduz o material ao **base color** (descarta normal, roughness, metallic, AO);
- **assa cor por vértice em textura** (via xatlas) quando o modelo não tem imagem —
  senão ele apareceria branco no app;
- **redimensiona texturas** grandes demais (4K/8K → 2K ou 1K);
- **decima a malha** até um orçamento de triângulos, **preservando as UVs**;
- corrige **eixo** (Z-up → Y-up), centraliza, apoia no chão, normaliza a escala;
- escreve **nomes ASCII** e **caminhos relativos** no `.mtl`;
- opcionalmente gera **um OBJ por objeto** (`--split`) e um **.zip** pronto pra
  mandar pro celular (`--zip`).

### Instalação

```bash
pip install -r requirements.txt
```

### Uso

```bash
# conversão padrão (até 150k triângulos, texturas em 2K)
python3 prisma3d_convert.py modelo.glb

# celular mais fraco / modelo travando ao importar
python3 prisma3d_convert.py modelo.glb --max-tris 60000 --tex-size 1024 --zip

# modelo gigante ou deitado (export de Blender costuma vir Z-up)
python3 prisma3d_convert.py modelo.dae --up z --scale-to 2 --center --floor

# modelo muito pesado: um arquivo por objeto, importar um de cada vez
python3 prisma3d_convert.py modelo.glb --split
```

Saída (pasta `<nome>_prisma3d/`):

```
modelo.obj
modelo.mtl
texturas/<material>.jpg|png
LEIA-ME.txt        # como importar, e o resumo do que foi feito
```

Copie a **pasta inteira** pro celular — o `.obj`, o `.mtl` e as imagens
precisam ficar juntos — e importe o `.obj` no Prisma3D.

### Opções

| opção | efeito |
|---|---|
| `--max-tris N` | orçamento de triângulos (padrão 150000; `0` desliga a decimação) |
| `--tex-size N` | lado máximo da textura (padrão 2048) |
| `--jpg` | força JPG mesmo com transparência (arquivo menor) |
| `--up auto\|y\|z` | eixo "para cima" do original (padrão `auto`) |
| `--scale-to N` | maior lado do modelo passa a medir N |
| `--center` / `--floor` | centraliza na origem / apoia a base em y=0 |
| `--split` | um OBJ por objeto |
| `--no-normals` | não grava normais (arquivo bem menor) |
| `--no-bake` | não assa cor por vértice em textura |
| `--zip` | também gera um `.zip` da pasta |

### Limites conhecidos

- **FBX não é lido** pelo `trimesh`. Converta antes pra GLB (Blender: importar o
  FBX e exportar em glTF/GLB) e passe o GLB pro script.
- Decimação forte desloca um pouco as UVs (~0,5% da textura ao cortar 80% dos
  triângulos) e pode abrir fresta em costura de UV. Se a textura "escorregar",
  suba o `--max-tris`.
- Animação, esqueleto e shape keys **não** são exportados: OBJ é malha estática.
