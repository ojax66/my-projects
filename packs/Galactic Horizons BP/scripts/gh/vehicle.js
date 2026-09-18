/* =========================================================================
 * Levar o veículo junto na troca de dimensão.
 *
 * A primeira versão simplesmente teleportava a entidade com
 * `entity.teleport(loc, { dimension })` antes do jogador — e o OVNI sumia.
 * O motivo: no destino a chunk ainda não estava carregada (nenhum jogador
 * tinha chegado lá), e entidade teleportada pra chunk descarregada em outra
 * dimensão se perde. Teleportar depois do jogador também não salva: o
 * handle da entidade não sobrevive de forma confiável à troca.
 *
 * O caminho que funciona é o que o próprio Spacecraft usa pra levar mobs
 * dentro do foguete (launch.js / racoTriggers.js): salvar a entidade numa
 * ESTRUTURA, apagar a original, e recolocar a estrutura no destino depois
 * que o jogador chegou e a chunk está carregada. A estrutura leva a entidade
 * inteira — cor, variante, vida, nome, propriedades — não uma cópia pela
 * metade.
 *
 * Um detalhe que morde: o jogador entra no espaço a Y 800, muito acima do
 * teto do Overworld (320), e não dá pra salvar estrutura fora dos limites da
 * dimensão. Por isso o veículo desce pra um Y válido ANTES de ser salvo —
 * teleporte dentro da mesma dimensão, que é confiável.
 *
 * E aí vem a parte que o OVNI do Vehicles impõe. O `minecraft:entity_spawned`
 * dele (entities/ufo.json) tem duas regras que disparam quando o jogador mais
 * próximo está a MAIS de 6 blocos:
 *
 *   1. `tp @s ~ ~19 ~` — o OVNI se joga 19 blocos pra cima;
 *   2. adiciona um timer de 0,1 s que aplica `minecraft:instant_despawn`.
 *
 * A regra 2 só vale sem a tag `dlb_van_ufo_captured`, que a gente põe. A regra
 * 1 dispara de qualquer jeito: o teste de tag dela compara com o literal
 * "add dlb_van_ufo_captured", que entidade nenhuma tem — então a condição é
 * sempre verdadeira. Ou seja: não existe tag que proteja o OVNI de ser
 * arremessado 19 blocos se ele estiver longe do jogador na hora em que nasce.
 *
 * Daí as duas regras aqui:
 *
 *   - o jogador nunca se separa do veículo. Descer o OVNI de Y 800 pro teto do
 *     mundo e deixar o jogador lá em cima abria 480 blocos de distância; agora
 *     os dois descem juntos, com a tela já escura.
 *   - a captura lê a posição do veículo NA HORA de salvar e salva uma caixa
 *     3x3x3 em volta dele, não um ponto anotado ticks antes. Ponto fixo erra
 *     se a entidade se mexeu um bloco que seja — e a estrutura sai vazia sem
 *     erro nenhum, que é o jeito mais silencioso de perder o OVNI.
 * ========================================================================= */

import * as mc from "@minecraft/server";
import { MOUNT_BLOCKLIST_MATCHES, VEHICLE_KEEP_ALIVE_TAGS } from "./config.js";

const world = mc.world;
const system = mc.system;

// Ticks entre o começo da viagem e a cápsula ficar pronta. Precisa ser >= 2
// pro teleporte do veículo pra um Y válido propagar antes do salvamento, e o
// fade de tela de quem chama é dimensionado por este número.
const CAPTURE_TICKS = 4;

// Ticks entre salvar a estrutura e apagar a entidade original. O Spacecraft usa
// 5 no mesmo lugar (launch.js / racoTriggers.js) e é a ordem que funciona no
// jogo dele: apagar no mesmo tick do createFromWorld arrisca a estrutura sair
// sem a entidade.
const REMOVE_TICKS = 5;

// Meia-aresta da caixa salva, em blocos. 1 = caixa 3x3x3 em volta do veículo.
const SAVE_HALF = 1;

// Folga até o teto da dimensão. O OVNI tem collision_box de 3 de altura, e o
// Spacecraft desce os passageiros dele pra `max - 30` pelo mesmo motivo.
const CEILING_MARGIN = 30;

// ---------------------------------------------------------------------------
// Um veículo, vários passageiros
// ---------------------------------------------------------------------------
//
// Isto era tudo por JOGADOR: cada um salvava a própria estrutura, removia o
// veículo e recolocava um. Com uma nave de três lugares o resultado era três
// naves no destino, e os três a pé do lado delas, tendo que clicar pra entrar.
//
// Agora a viagem é do VEÍCULO. O primeiro passageiro a pedir vira o portador:
// ele desmonta todo mundo, salva uma vez e remove uma vez. Os outros entram na
// carona — recebem a mesma cápsula e não recolocam nada. No destino, o portador
// põe o veículo e monta todos de volta, na ordem em que estavam.
//
// A janela importa: ao serem desmontados os passageiros caem juntos, então cada
// um dispara a própria entrada no espaço poucos ticks depois. Por isso os
// passageiros são registrados JÁ na captura — quem chegar atrasado encontra o
// grupo em vez de viajar sozinho e sem nave.

/** vehicleId → estado da viagem daquele veículo. */
const flights = new Map();
/** playerId → vehicleId, pra quem foi desmontado achar o grupo depois. */
const flightOf = new Map();

function ridersOf(mount) {
  try {
    return (mount.getComponent("rideable")?.getRiders?.() ?? []).filter((r) => r?.isValid);
  } catch {
    return [];
  }
}

function finishFlight(vid) {
  const flight = flights.get(vid);
  if (!flight) return;
  for (const pid of flight.riders) flightOf.delete(pid);
  flights.delete(vid);
}

export function getMount(player) {
  try {
    return player.getComponent("riding")?.entityRidingOn;
  } catch {
    return undefined;
  }
}

// O OVNI vai junto; o foguete do Spacecraft não — ele tem coreografia própria
// de lançamento e pouso, e interromper no meio quebra a viagem dele.
export function mountTravels(mount) {
  if (!mount) return false;
  const id = mount.typeId ?? "";
  for (const frag of MOUNT_BLOCKLIST_MATCHES) {
    if (id.includes(frag)) return false;
  }
  return true;
}

function ejectFrom(mount, player) {
  try {
    mount?.getComponent("rideable")?.ejectRider?.(player);
  } catch { }
}

function structureNameFor(player) {
  return "gh:veh_" + String(player.id).replace(/[^a-zA-Z0-9]/g, "_");
}

function dropStructure(name) {
  try { world.structureManager.delete(name); } catch { }
}

/**
 * Impede o veículo de sumir enquanto ninguém está montado.
 *
 * O OVNI do Vehicles tem `minecraft:despawn` com filtro
 * "é dia E não tem a tag dlb_van_ufo_captured E o jogador mais próximo está a
 * 6+ blocos". O addon dele põe essa tag sozinho assim que alguém monta, então
 * um OVNI já pilotado não some — mas marcar de novo não custa nada e cobre
 * o caso de a entidade ter acabado de ser recriada pela estrutura.
 */
function keepAlive(entity) {
  if (!entity?.isValid) return;
  for (const tag of VEHICLE_KEEP_ALIVE_TAGS) {
    try { entity.addTag(tag); } catch { }
  }
}

/**
 * Desce o jogador do veículo e DEIXA o veículo onde está, vivo.
 *
 * É o caminho de quem desce pra Lua ou pra Marte: a nave não vai junto. Ela
 * fica boiando no espaço, marcada pra não sumir, esperando o jogador voltar.
 *
 * O motivo é o corpo celeste ser atravessável pelo modelo: a nave recolocada no
 * destino ou aparecia DENTRO do planeta, ou a recolocação falhava. Nenhum dos
 * dois é aceitável, e nenhum dos dois é consertável sem dar colisão de verdade
 * ao modelo — que é justamente o que faz o planeta ser um cubo gigante.
 *
 * @returns o veículo que ficou pra trás, ou null se não havia nenhum
 */
export function leaveBehind(player) {
  const mount = getMount(player);
  if (!mount) return null;
  ejectFrom(mount, player);
  keepAlive(mount);
  return mount;
}

/**
 * Tira o jogador do veículo, guarda o veículo numa estrutura e remove o
 * original do mundo.
 *
 * @returns {{name: string, typeId: string} | null} o que `restore` precisa,
 *          ou null se não havia veículo pra levar.
 */
export function capture(player, onReady) {
  // Já desmontado pelo portador do grupo: entra na carona da mesma cápsula.
  const grupo = flightOf.get(player.id);
  if (grupo !== undefined) {
    // Consumido agora: `flightOf` só serve da hora em que o portador desmontou
    // até a viagem DESTE passageiro começar. Deixá-lo de pé faria a próxima
    // viagem dele entrar na carona de um grupo que já pousou — e aí ele chega
    // sem veículo nenhum.
    flightOf.delete(player.id);
    const flight = flights.get(grupo);
    if (flight) {
      if (flight.capsule !== undefined) {
        const c = flight.capsule;
        system.runTimeout(() => onReady(c && { ...c, primary: false }), 1);
      } else {
        flight.waiting.push((c) => onReady(c && { ...c, primary: false }));
      }
      return;
    }
  }

  const mount = getMount(player);

  // Outro passageiro do MESMO veículo está capturando AGORA.
  //
  // `capsule === undefined` quer dizer captura em andamento. Sem essa condição
  // um voo já resolvido continuaria aceitando carona, e quem montasse naquele
  // veículo depois viajaria como caroneiro de um grupo que já pousou — ou seja,
  // sem veículo nenhum no destino.
  const emCurso = mount?.isValid ? flights.get(mount.id) : null;
  if (emCurso && emCurso.capsule === undefined) {
    const flight = emCurso;
    flight.riders.push(player.id);
    ejectFrom(mount, player);
    flight.waiting.push((c) => onReady(c && { ...c, primary: false }));
    return;
  }

  if (!mountTravels(mount) || !mount?.isValid) {
    // Mesmo atraso do caminho com veículo: quem chama conta com um tempo fixo
    // até o teleporte pra o fade de tela cobrir a troca nos dois casos.
    system.runTimeout(() => onReady(null), CAPTURE_TICKS + REMOVE_TICKS);
    return;
  }

  const typeId = mount.typeId;
  const name = structureNameFor(player);
  const dim = mount.dimension;
  const vid = mount.id;

  // O portador: registra o grupo ANTES de desmontar, com todos os passageiros
  // que estão a bordo agora. Assim quem disparar a viagem depois — e vai
  // disparar, porque foi desmontado e continua subindo — encontra o grupo em
  // vez de viajar sozinho e sem nave.
  const riders = [player.id];
  for (const r of ridersOf(mount)) {
    if (r.id !== player.id && typeof r.id === "string") riders.push(r.id);
  }
  const flight = { riders, waiting: [], capsule: undefined, vehicle: null };
  flights.set(vid, flight);
  for (const pid of riders) flightOf.set(pid, vid);
  flightOf.delete(player.id);          // o portador já está viajando

  const resolveGroup = (capsule) => {
    flight.capsule = capsule;
    const espera = flight.waiting.splice(0);
    for (const fn of espera) fn(capsule);
  };

  // Desmonta TODO MUNDO: estrutura não guarda jogador, e um passageiro ainda
  // montado some junto com a entidade quando ela é removida.
  for (const r of ridersOf(mount)) ejectFrom(mount, r);
  ejectFrom(mount, player);
  keepAlive(mount);

  // Y válido pra dimensão: a Y 800 (entrada no espaço) o salvamento falharia,
  // porque está acima do teto do mundo.
  let safeY;
  try {
    const hr = dim.heightRange;
    safeY = Math.min(
      Math.max(Math.floor(mount.location.y), hr.min + 2),
      hr.max - CEILING_MARGIN
    );
  } catch {
    resolveGroup(null);
    system.runTimeout(() => onReady(null), CAPTURE_TICKS + REMOVE_TICKS);
    return;
  }

  if (safeY !== Math.floor(mount.location.y)) {
    const x = mount.location.x;
    const z = mount.location.z;
    try { mount.teleport({ x, y: safeY, z }); } catch { }
    // O jogador desce junto. Deixá-lo a Y 800 abriria centenas de blocos de
    // distância, e é exatamente essa distância que faz o OVNI se arremessar
    // 19 blocos pra cima e ligar o timer de despawn (ver o cabeçalho).
    try { player.teleport({ x, y: safeY + 1, z }); } catch { }
  }

  // Alguns ticks pro teleporte propagar antes de a estrutura capturar a
  // entidade na caixa — sem isso ela ainda está na posição antiga e não entra.
  system.runTimeout(() => {
    if (!mount?.isValid) {
      resolveGroup(null);
      onReady(null);
      return;
    }

    // Posição de AGORA, não a de quando a viagem começou: entre um tick e
    // outro a entidade pode ter andado, e uma caixa no lugar errado salva
    // vazio sem erro nenhum.
    let from;
    let to;
    try {
      const hr = dim.heightRange;
      const l = mount.location;
      const cy = Math.floor(l.y);
      from = {
        x: Math.floor(l.x) - SAVE_HALF,
        y: Math.max(hr.min, cy - SAVE_HALF),
        z: Math.floor(l.z) - SAVE_HALF,
      };
      to = {
        x: Math.floor(l.x) + SAVE_HALF,
        y: Math.min(hr.max, cy + SAVE_HALF),
        z: Math.floor(l.z) + SAVE_HALF,
      };
    } catch {
      resolveGroup(null);
      onReady(null);
      return;
    }

    dropStructure(name);
    let saved = false;
    try {
      world.structureManager.createFromWorld(name, dim, from, to, {
        includeBlocks: false,
        includeEntities: true,
        saveMode: "World",
      });
      saved = true;
    } catch (e) {
      console.warn("[gh] não deu pra salvar o veículo: " + e);
    }

    // Apaga a original só alguns ticks depois do salvamento, que é a ordem
    // que funciona no Spacecraft. Só então a viagem continua.
    system.runTimeout(() => {
      try { mount.remove(); } catch { }
      const capsule = saved ? { name, typeId, vid } : { name: null, typeId, vid };
      resolveGroup(capsule);
      onReady({ ...capsule, primary: true });
    }, REMOVE_TICKS);
  }, CAPTURE_TICKS);
}

/**
 * Recoloca o veículo no destino e monta o jogador de volta.
 *
 * Se a estrutura falhar, cria um veículo novo do mesmo tipo: perde a cor e a
 * vida, mas é muito melhor que deixar o jogador a pé no meio do espaço.
 */
export function restore(player, dimension, loc, capsule) {
  if (!capsule) return;

  // Passageiro de carona: não recoloca nada. Espera o portador pôr o veículo e
  // monta nele. Recolocar um por passageiro era o que fazia três naves.
  if (capsule.primary === false) {
    rideWhenReady(player, capsule.vid);
    return;
  }

  const place = () => {
    if (!player?.isValid) return;

    // Onde o jogador está AGORA, não onde ele foi teleportado. Na gravidade
    // zero ele chega com inércia, e nos ticks até aqui já andou — colocar o
    // OVNI no ponto antigo é o que abre os 6 blocos que fazem o addon deles
    // arremessá-lo pra cima assim que ele nasce.
    let here = loc;
    try {
      if (player.dimension?.id === dimension.id) here = player.location;
    } catch { }

    let vehicle = null;

    if (capsule.name) {
      try {
        world.structureManager.place(capsule.name, dimension, {
          x: Math.floor(here.x) - SAVE_HALF,
          y: Math.floor(here.y) - SAVE_HALF,
          z: Math.floor(here.z) - SAVE_HALF,
        });
      } catch (e) {
        console.warn("[gh] não deu pra recolocar o veículo: " + e);
      }
      dropStructure(capsule.name);

      try {
        vehicle = dimension.getEntities({
          type: capsule.typeId,
          location: here,
          // 24 e não 12: se o OVNI já tiver levado o empurrão de 19 blocos
          // pra cima, ele ainda é achado — e reaproveitado em vez de virar um
          // segundo OVNI abandonado por perto.
          maxDistance: 24,
          closest: 1,
        })[0] ?? null;
      } catch { }
    }

    // Rede de segurança: sem a estrutura, ao menos devolve um veículo do tipo
    // certo — ninguém fica a pé no vácuo por causa de um erro de estrutura.
    if (!vehicle) {
      try {
        vehicle = dimension.spawnEntity(capsule.typeId, here);
      } catch (e) {
        console.warn("[gh] não deu pra recriar o veículo: " + e);
        try {
          player.sendMessage("§cO veículo não pôde ser trazido — /scriptevent gh:info");
        } catch { }
        return;
      }
      console.warn("[gh] veículo recriado do zero: a estrutura veio vazia");
    }

    keepAlive(vehicle);
    // Puxa pra junto do jogador se o addon dele já tiver arremessado a
    // entidade pra cima no tick em que ela nasceu.
    try {
      const d = Math.hypot(
        vehicle.location.x - here.x,
        vehicle.location.y - here.y,
        vehicle.location.z - here.z
      );
      if (d > 4) vehicle.teleport({ x: here.x, y: here.y, z: here.z });
    } catch { }

    // A partir daqui os caroneiros têm onde montar.
    const flight = capsule.vid !== undefined ? flights.get(capsule.vid) : null;
    if (flight) flight.vehicle = vehicle;

    seat(player, vehicle);
  };

  // Alguns ticks depois do teleporte do jogador: aí a chunk do destino já
  // está carregada e a estrutura tem onde ser colocada.
  system.runTimeout(place, 6);
}

/**
 * Senta o jogador no veículo, insistindo um pouco.
 *
 * Uma tentativa só não basta: o cliente ainda está trocando de dimensão, a
 * entidade acabou de nascer, e com três passageiros as três chamadas caem em
 * ticks diferentes. Insistir é barato e é o que faz o jogador CHEGAR montado
 * em vez de ter que clicar na nave.
 */
function seat(player, vehicle, tentativas = 6) {
  const tentar = () => {
    if (!player?.isValid) return;
    if (!vehicle?.isValid) return;
    try {
      const riding = player.getComponent("riding")?.entityRidingOn;
      if (riding?.id === vehicle.id) return;              // já sentou
    } catch { }
    let ok = false;
    try {
      ok = vehicle.getComponent("rideable")?.addRider?.(player) ?? false;
    } catch { }
    if (!ok && tentativas > 0) {
      tentativas--;
      system.runTimeout(tentar, 4);
    }
  };
  system.runTimeout(tentar, 4);
}

/** Caroneiro: espera o portador pôr o veículo e senta nele. */
function rideWhenReady(player, vid, tentativas = 20) {
  const esperar = () => {
    if (!player?.isValid) return;
    const flight = vid !== undefined ? flights.get(vid) : null;
    const vehicle = flight?.vehicle;
    if (vehicle?.isValid) {
      seat(player, vehicle);
      return;
    }
    if (tentativas > 0) {
      tentativas--;
      system.runTimeout(esperar, 4);
    }
  };
  system.runTimeout(esperar, 6);
}

/** Limpa a estrutura de um jogador que saiu no meio da viagem. */
export function forgetPlayer(player) {
  dropStructure(structureNameFor(player));
  const vid = flightOf.get(player.id);
  flightOf.delete(player.id);
  if (vid !== undefined) {
    const flight = flights.get(vid);
    if (flight) {
      flight.riders = flight.riders.filter((p) => p !== player.id);
      if (!flight.riders.length) finishFlight(vid);
    }
  }
}

/**
 * Encerra a viagem de um grupo, algum tempo depois de todos terem chegado.
 *
 * Sem isto o registro do voo ficaria de pé pra sempre, e o próximo voo daquele
 * veículo entraria na carona de um grupo que já pousou.
 */
export function endFlight(capsule) {
  if (!capsule || capsule.vid === undefined) return;
  system.runTimeout(() => finishFlight(capsule.vid), 200);
}
