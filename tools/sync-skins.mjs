#!/usr/bin/env node
// Gera o registro de skins da Operação Fênix.
//
// O Bedrock não deixa add-ons lerem a skin real do jogador, então o corpo no
// chão e o clone dentro da cápsula usam skins registradas aqui:
//   skins/<Gamertag>.png        -> modelo clássico (Steve, braços de 4px)
//   skins/<Gamertag>.slim.png   -> modelo slim (Alex, braços de 3px)
// Jogadores sem skin registrada usam o Steve padrão.
//
// Uso: node tools/sync-skins.mjs   (rode de novo sempre que mudar a pasta skins/)

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skinsDir = join(root, "skins");
const rp = join(root, "packs", "OperacaoFenix_RP");
const bp = join(root, "packs", "OperacaoFenix_BP");
const skinTexDir = join(rp, "textures", "entity", "fenix", "skins");

// Índices 0 e 1 são sempre as skins vanilla.
const skins = [
  { key: "skin_0", path: "textures/entity/steve", slim: false },
  { key: "skin_1", path: "textures/entity/alex", slim: true },
];
const players = {};

rmSync(skinTexDir, { recursive: true, force: true });
mkdirSync(skinTexDir, { recursive: true });
if (existsSync(skinsDir)) {
  for (const file of readdirSync(skinsDir).sort()) {
    const m = /^(.+?)(\.slim)?\.png$/i.exec(file);
    if (!m) continue;
    const index = skins.length;
    if (index > 255) throw new Error("Máximo de 256 skins registradas.");
    const name = m[1];
    const texName = `skin_${index}`;
    copyFileSync(join(skinsDir, file), join(skinTexDir, `${texName}.png`));
    skins.push({ key: texName, path: `textures/entity/fenix/skins/${texName}`, slim: !!m[2] });
    players[name.toLowerCase()] = { skin: index, slim: !!m[2] };
  }
}

const write = (file, data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n");
};

const skinTextures = Object.fromEntries(skins.map((s) => [s.key, s.path]));
const skinArray = skins.map((s) => `Texture.${s.key}`);
const bodies = { "Array.bodies": ["Geometry.body", "Geometry.body_slim"] };
const bodyGeometry = "Array.bodies[q.property('fenix:slim') ? 1 : 0]";
const skinTexture = "Array.skins[math.clamp(q.property('fenix:skin'), 0, " + (skins.length - 1) + ")]";

write(join(rp, "render_controllers", "fenix.render_controllers.json"), {
  format_version: "1.10.0",
  render_controllers: {
    "controller.render.fenix.capsule": {
      geometry: "Geometry.capsule",
      textures: ["Texture.capsule"],
      materials: [{ "*": "Material.default" }, { capsule: "Material.glass" }],
    },
    "controller.render.fenix.panel": {
      geometry: "Geometry.default",
      textures: ["Texture.default"],
      materials: [{ "*": "Material.default" }],
    },
    "controller.render.fenix.occupant": {
      arrays: { geometries: bodies, textures: { "Array.skins": skinArray } },
      geometry: bodyGeometry,
      textures: [skinTexture],
      materials: [{ "*": "Material.default" }],
      part_visibility: [{ "*": "q.property('fenix:clone') > 0" }],
    },
    "controller.render.fenix.corpse": {
      arrays: { geometries: bodies, textures: { "Array.skins": skinArray } },
      geometry: bodyGeometry,
      textures: [skinTexture],
      materials: [{ "*": "Material.default" }],
    },
  },
});

const bodyGeometries = { body: "geometry.fenix_body", body_slim: "geometry.fenix_body_slim" };

write(join(rp, "entity", "fenix_capsule.entity.json"), {
  format_version: "1.10.0",
  "minecraft:client_entity": {
    description: {
      identifier: "fenix:capsule",
      materials: { default: "entity_alphatest", glass: "entity_alphablend" },
      textures: { capsule: "textures/entity/fenix/capsule", ...skinTextures },
      geometry: { capsule: "geometry.fenix_capsule", ...bodyGeometries },
      animations: { occupant: "animation.fenix.capsule.occupant" },
      scripts: { animate: ["occupant"] },
      // O clone é desenhado antes do vidro para aparecer através dele.
      render_controllers: ["controller.render.fenix.occupant", "controller.render.fenix.capsule"],
    },
  },
});

write(join(rp, "entity", "fenix_corpse.entity.json"), {
  format_version: "1.10.0",
  "minecraft:client_entity": {
    description: {
      identifier: "fenix:corpse",
      materials: { default: "entity_alphatest" },
      textures: skinTextures,
      geometry: bodyGeometries,
      animations: { lie: "animation.fenix.corpse.lie" },
      scripts: { animate: ["lie"] },
      render_controllers: ["controller.render.fenix.corpse"],
    },
  },
});

write(join(rp, "entity", "fenix_panel.entity.json"), {
  format_version: "1.10.0",
  "minecraft:client_entity": {
    description: {
      identifier: "fenix:panel",
      materials: { default: "entity_alphatest" },
      textures: { default: "textures/entity/fenix/panel" },
      geometry: { default: "geometry.fenix_panel" },
      animations: { idle: "animation.fenix.panel.idle" },
      scripts: { animate: ["idle"] },
      render_controllers: ["controller.render.fenix.panel"],
    },
  },
});

write(
  join(bp, "scripts", "skins.js"),
  `// Arquivo gerado por tools/sync-skins.mjs — não edite à mão.
// Gamertag (minúsculo) -> índice da skin no resource pack.
export const SKINS = ${JSON.stringify(players, null, 2)};
`,
);

console.log(`${skins.length} skins registradas (${Object.keys(players).length} de jogadores).`);
