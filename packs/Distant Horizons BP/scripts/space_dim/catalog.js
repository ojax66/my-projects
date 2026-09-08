/* =========================================================================
 * Catálogo de sistemas estelares e corpos celestes.
 *
 * O rastreador não é uma lista fixa dos quatro corpos de hoje. Ele é uma
 * consulta a este catálogo, e o catálogo é feito pra crescer: cada sistema
 * novo é uma entrada aqui, e nada mais no código precisa saber que ele existe.
 *
 * Um corpo pode vir de dois lugares:
 *
 *   ref: "earth"    — é um corpo construído de blocos, declarado em BODIES.
 *                     A posição e o raio vêm de lá; aqui só se diz que ele é
 *                     rastreável.
 *   center/radius   — é um corpo que só existe como ponto no rastreador, sem
 *                     blocos gerados. É assim que uma estrela distante entra
 *                     antes de haver o que visitar nela.
 *
 * Sistemas nascem TRANCADOS, tirando o de casa. Quem os abre é o mapa estelar
 * que o jogador acha — ou, no futuro, um upgrade de nave, que chama a mesma
 * `unlockSystem` daqui.
 * ========================================================================= */

import { BODIES } from "./config.js";

export const SYSTEMS = [
  {
    id: "sol",
    name: "§eSistema Solar",
    // O sistema de casa: já vem aberto, senão o jogador chegaria ao espaço
    // sem nada no rastreador e sem ideia de pra onde ir.
    unlockedByDefault: true,
    bodies: [
      { ref: "sun" },
      { ref: "earth" },
      { ref: "moon" },
      { ref: "mars" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Resolução
// ---------------------------------------------------------------------------

const byId = new Map(BODIES.map((b) => [b.id, b]));

/**
 * Junta o que o catálogo diz com o que BODIES sabe.
 * @returns {{id, name, center, radius, systemId, generated}|null}
 */
function resolve(entry, system) {
  if (entry.ref) {
    const body = byId.get(entry.ref);
    if (!body) return null;                 // referência morta: some da lista
    return {
      id: body.id,
      name: entry.name ?? body.name,
      center: body.center,
      radius: body.radius,
      systemId: system.id,
      generated: true,                      // tem blocos de verdade
    };
  }
  if (!entry.id || !entry.center) return null;
  return {
    id: entry.id,
    name: entry.name ?? entry.id,
    center: entry.center,
    radius: entry.radius ?? 1,
    systemId: system.id,
    generated: false,                       // só um ponto no rastreador
  };
}

/** Todos os corpos rastreáveis de um sistema. */
export function bodiesOf(systemId) {
  const system = SYSTEMS.find((s) => s.id === systemId);
  if (!system) return [];
  return system.bodies.map((e) => resolve(e, system)).filter(Boolean);
}

/** Todos os corpos rastreáveis de todos os sistemas. */
export function allTrackable() {
  const out = [];
  for (const system of SYSTEMS) {
    for (const entry of system.bodies) {
      const body = resolve(entry, system);
      if (body) out.push(body);
    }
  }
  return out;
}

export function systemById(id) {
  return SYSTEMS.find((s) => s.id === id) ?? null;
}

/** Sistemas que já nascem abertos. */
export function defaultSystems() {
  return SYSTEMS.filter((s) => s.unlockedByDefault).map((s) => s.id);
}
