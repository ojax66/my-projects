/* =========================================================================
 * O idioma de tudo que o ADDON escreve na tela.
 *
 * São dois textos diferentes no jogo, e eles se resolvem em lugares
 * diferentes:
 *
 *   NOMES de item, bloco e bioma  vêm dos .lang do pack de recurso, e quem
 *     escolhe é o CLIENTE, pelo idioma do jogo. Script nenhum encosta neles —
 *     é por isso que existem os subpacotes (a engrenagem do pack, nas
 *     configurações do mundo): cada um força um idioma nos .lang.
 *
 *   TUDO QUE O SCRIPT ESCREVE  — aviso de oxigênio, calor, frio, pressão,
 *     título de chegada, o rastreador, as mensagens de chat — é string daqui
 *     de dentro, e o pack de recurso não alcança. É este arquivo.
 *
 * Por isso os dois existem, e por isso a escolha é por JOGADOR e não por
 * mundo: num servidor com gente de dois países, cada um lê o seu.
 * ========================================================================= */

import { IDIOMA_PADRAO } from "./config.js";

export const IDIOMAS = ["pt", "en", "es"];
export const NOME_DO_IDIOMA = { pt: "Português", en: "English", es: "Español" };

const PROP = "gh:lang";

/** O idioma deste jogador. */
export function idiomaDe(player) {
  let v;
  try { v = player.getDynamicProperty(PROP); } catch { }
  return IDIOMAS.includes(v) ? v : IDIOMA_PADRAO;
}

/** Troca o idioma deste jogador. Devolve o que ficou valendo. */
export function definirIdioma(player, lang) {
  const escolhido = IDIOMAS.includes(lang) ? lang : IDIOMA_PADRAO;
  try { player.setDynamicProperty(PROP, escolhido); } catch { }
  return escolhido;
}

// ---------------------------------------------------------------------------
// O dicionário
// ---------------------------------------------------------------------------
// `{nome}` no texto é trocado pelo valor passado em `t()`. Chave que falta num
// idioma cai no inglês, que é o padrão — é melhor uma linha em inglês no meio
// do espanhol do que um buraco na tela.
const TEXTOS = {
  // --- avisos da barra de ação ---
  "hud.sem_oxigenio": {
    pt: "§4§lSEM OXIGÊNIO §r§7— traje completo + mochila, ou entre no OVNI",
    en: "§4§lNO OXYGEN §r§7— full suit + backpack, or get in the UFO",
    es: "§4§lSIN OXÍGENO §r§7— traje completo + mochila, o entra en el OVNI",
  },
  "hud.acido": {
    pt: "§e§lÁCIDO SULFÚRICO §r§7— saia da poça",
    en: "§e§lSULFURIC ACID §r§7— get out of the pool",
    es: "§e§lÁCIDO SULFÚRICO §r§7— sal del charco",
  },
  "hud.acido_folego": {
    pt: "§e§lÁCIDO §r§7— afundado, {s}s de ar",
    en: "§e§lACID §r§7— submerged, {s}s of air",
    es: "§e§lÁCIDO §r§7— sumergido, {s}s de aire",
  },
  "hud.acido_afogando": {
    pt: "§4§lAFOGANDO NO ÁCIDO §r§7— suba",
    en: "§4§lDROWNING IN ACID §r§7— get up",
    es: "§4§lAHOGÁNDOTE EN ÁCIDO §r§7— sube",
  },
  "acido.encheu": {
    pt: "§eBalde de titânio cheio de ácido sulfúrico",
    en: "§eTitanium bucket filled with sulfuric acid",
    es: "§eCubo de titanio lleno de ácido sulfúrico",
  },
  "acido.nao_cabe": {
    pt: "§eNão cabe ácido aí — mire um espaço vazio",
    en: "§eNo room for acid there — aim at an empty space",
    es: "§eNo cabe ácido ahí — apunta a un espacio vacío",
  },
  "acido.balde_errado": {
    pt: "§eO ácido comeria esse balde — ferro vira sulfato de ferro. Só o de titânio aguenta.",
    en: "§eThe acid would eat that bucket — iron turns into iron sulfate. Only titanium holds it.",
    es: "§eEl ácido se comería ese cubo — el hierro se vuelve sulfato de hierro. Solo el de titanio aguanta.",
  },
  "hud.venus_esmagando": {
    pt: "§4§lVÊNUS ESMAGANDO §r§7— 92 atm a 464 °C: só o traje reforçado",
    en: "§4§lVENUS IS CRUSHING YOU §r§7— 92 atm at 464 °C: reinforced suit only",
    es: "§4§lVENUS TE APLASTA §r§7— 92 atm a 464 °C: solo el traje reforzado",
  },
  "hud.venus_nave_cedendo": {
    pt: "§c§lO CASCO ESTÁ CEDENDO §r§7— a Level 1 não aguenta Vênus ({s}s)",
    en: "§c§lTHE HULL IS BUCKLING §r§7— the Level 1 cannot take Venus ({s}s)",
    es: "§c§lEL CASCO CEDE §r§7— la Level 1 no aguanta Venus ({s}s)",
  },
  "nave.guardar_ocupada": {
    pt: "§eTem gente dentro — todo mundo precisa descer primeiro.",
    en: "§eSomeone is aboard — everyone has to get out first.",
    es: "§eHay alguien dentro — todos tienen que bajar primero.",
  },
  "nave.guardar_cheio": {
    pt: "§eInventário cheio — a nave continua onde está.",
    en: "§eInventory full — the ship stays where it is.",
    es: "§eInventario lleno — la nave se queda donde está.",
  },
  "hud.rastreador": { pt: "§lRASTREADOR", en: "§lTRACKER", es: "§lRASTREADOR" },
  "hud.nada_ligado": {
    pt: "§8rastreador sem nada ligado",
    en: "§8tracker with nothing on",
    es: "§8rastreador sin nada activo",
  },

  // --- calor do Sol ---
  "calor.dentro_protegido": {
    pt: "§6{corpo}§r §7— dentro do Sol, protegido do calor",
    en: "§6{corpo}§r §7— inside the Sun, shielded from the heat",
    es: "§6{corpo}§r §7— dentro del Sol, protegido del calor",
  },
  "calor.intenso_protegido": {
    pt: "§6{corpo}§r §7— calor intenso, mas você está protegido",
    en: "§6{corpo}§r §7— intense heat, but you are shielded",
    es: "§6{corpo}§r §7— calor intenso, pero estás protegido",
  },
  "calor.dentro_do_sol": {
    pt: "§4§lVOCÊ ESTÁ DENTRO DO SOL",
    en: "§4§lYOU ARE INSIDE THE SUN",
    es: "§4§lESTÁS DENTRO DEL SOL",
  },
  "calor.extremo": {
    pt: "§c§lCALOR EXTREMO §r§7— afaste-se do Sol",
    en: "§c§lEXTREME HEAT §r§7— get away from the Sun",
    es: "§c§lCALOR EXTREMO §r§7— aléjate del Sol",
  },
  "calor.perigoso": {
    pt: "§6Calor do Sol §r§7— está ficando perigoso",
    en: "§6Solar heat §r§7— this is getting dangerous",
    es: "§6Calor del Sol §r§7— se está poniendo peligroso",
  },

  // --- pressão ---
  "pressao.aguenta": {
    pt: "§e{corpo}§r §7— {quem} aguenta a pressão",
    en: "§e{corpo}§r §7— {quem} holds the pressure",
    es: "§e{corpo}§r §7— {quem} aguanta la presión",
  },
  "pressao.quem_estrela": {
    pt: "a armadura de estrela", en: "the star armor", es: "la armadura de estrella",
  },
  "pressao.quem_traje": {
    pt: "o traje reforçado", en: "the reinforced suit", es: "el traje reforzado",
  },
  "pressao.parcial": {
    pt: "§6PRESSÃO §r§7— o traje segura em parte; a de estrela anula",
    en: "§6PRESSURE §r§7— the suit helps; the star armor cancels it",
    es: "§6PRESIÓN §r§7— el traje ayuda; la de estrella la anula",
  },
  "pressao.esmagadora": {
    pt: "§4§lPRESSÃO ESMAGADORA §r§7— sem proteção contra pressão",
    en: "§4§lCRUSHING PRESSURE §r§7— no protection against pressure",
    es: "§4§lPRESIÓN APLASTANTE §r§7— sin protección contra la presión",
  },

  // --- frio ---
  "frio.reaquecendo": {
    pt: "§b§lREAQUECENDO §r§7— {barra}",
    en: "§b§lWARMING UP §r§7— {barra}",
    es: "§b§lCALENTÁNDOSE §r§7— {barra}",
  },
  "frio.congelando": {
    pt: "§b§lCONGELANDO §r§7— traje reforçado, armadura de estrela ou o OVNI",
    en: "§b§lFREEZING §r§7— reinforced suit, star armor or the UFO",
    es: "§b§lCONGELÁNDOTE §r§7— traje reforzado, armadura de estrella o el OVNI",
  },
  "frio.perdendo": {
    pt: "§b§lPERDENDO CALOR §r§7— {barra}",
    en: "§b§lLOSING HEAT §r§7— {barra}",
    es: "§b§lPERDIENDO CALOR §r§7— {barra}",
  },

  // --- tempestade de Marte ---
  "tempestade.forte": {
    pt: "§6§lTEMPESTADE DE AREIA §r§7— visibilidade quase nula",
    en: "§6§lSANDSTORM §r§7— almost no visibility",
    es: "§6§lTORMENTA DE ARENA §r§7— visibilidad casi nula",
  },
  "tempestade.fraca": {
    pt: "§6Poeira em suspensão §7— a vista fecha",
    en: "§6Dust in the air §7— the view closes in",
    es: "§6Polvo en suspensión §7— la vista se cierra",
  },

  // --- viagem ---
  "viagem.titulo_espaco": {
    pt: "§f§lESPAÇO SIDERAL", en: "§f§lOUTER SPACE", es: "§f§lESPACIO EXTERIOR",
  },
  "viagem.sub_espaco": {
    pt: "§7Sem gravidade — pule pra subir, agache pra descer",
    en: "§7No gravity — jump to rise, sneak to sink",
    es: "§7Sin gravedad — salta para subir, agáchate para bajar",
  },
  "viagem.titulo_terra": { pt: "§a§lTERRA", en: "§a§lEARTH", es: "§a§lTIERRA" },
  "viagem.sub_terra": {
    pt: "§7Reentrada na atmosfera",
    en: "§7Atmospheric reentry",
    es: "§7Reentrada en la atmósfera",
  },
  "viagem.sub_superficie": {
    pt: "§7Superfície — sem ar, traje obrigatório",
    en: "§7Surface — no air, suit required",
    es: "§7Superficie — sin aire, traje obligatorio",
  },
  "viagem.nave_ficou": {
    pt: "§7A nave ficou no espaço — ela não desce à superfície.",
    en: "§7The ship stayed in space — it does not land on the surface.",
    es: "§7La nave se quedó en el espacio — no baja a la superficie.",
  },
  "viagem.subindo": {
    pt: "§7Subindo até a altitude de saída...",
    en: "§7Climbing to exit altitude...",
    es: "§7Subiendo a la altitud de salida...",
  },
  "viagem.erro_dimensao": {
    pt: "§cA dimensão do espaço não pôde ser aberta.",
    en: "§cThe space dimension could not be opened.",
    es: "§cNo se pudo abrir la dimensión del espacio.",
  },
  "viagem.erro_chegada": {
    pt: "§cNão deu pra chegar em {alvo}§c: a dimensão não abriu.",
    en: "§cCould not reach {alvo}§c: the dimension did not open.",
    es: "§cNo se pudo llegar a {alvo}§c: la dimensión no abrió.",
  },

  // --- portais ---
  "portal.overworld": {
    pt: "{corpo} §7— encoste pra voltar ao Overworld",
    en: "{corpo} §7— touch to return to the Overworld",
    es: "{corpo} §7— toca para volver al Overworld",
  },
  "portal.planeta": {
    pt: "{corpo} §7— encoste pra pousar",
    en: "{corpo} §7— touch to land",
    es: "{corpo} §7— toca para aterrizar",
  },

  // --- rastreador ---
  "tracker.canal_actionbar": {
    pt: "barra de ação", en: "action bar", es: "barra de acción",
  },
  "tracker.canal_sidebar": { pt: "placar", en: "sidebar", es: "marcador" },
  "tracker.canal_off": { pt: "§8não mostrar", en: "§8do not show", es: "§8no mostrar" },
  "tracker.titulo": {
    pt: "§lRastreador Estelar", en: "§lStar Tracker", es: "§lRastreador Estelar",
  },
  "tracker.corpo": {
    pt: "§7Sistemas que você conhece. Desligar não apaga o que já foi\n§7descoberto — só tira da tela.",
    en: "§7Systems you know. Turning one off does not erase what you\n§7found — it only hides it.",
    es: "§7Sistemas que conoces. Apagar no borra lo que ya\n§7descubriste — solo lo quita de la pantalla.",
  },
  "tracker.trocar": {
    pt: "§7toque pra trocar", en: "§7tap to switch", es: "§7toca para cambiar",
  },
  "tracker.sem_coordenadas": {
    pt: "§8sem coordenadas", en: "§8no coordinates", es: "§8sin coordenadas",
  },
  "tracker.corpos_de": {
    pt: "§7{n} de {total} corpos",
    en: "§7{n} of {total} bodies",
    es: "§7{n} de {total} cuerpos",
  },
  "tracker.agora": { pt: "Rastreador: §f{canal}", en: "Tracker: §f{canal}", es: "Rastreador: §f{canal}" },
  "tracker.falta_coordenada": {
    pt: "§7Você ainda não tem as coordenadas desse sistema.",
    en: "§7You do not have this system's coordinates yet.",
    es: "§7Todavía no tienes las coordenadas de ese sistema.",
  },
  "tracker.liga_desliga": {
    pt: "§7Toque pra ligar ou desligar.",
    en: "§7Tap to turn on or off.",
    es: "§7Toca para encender o apagar.",
  },
  "tracker.sistema_inteiro": {
    pt: "§fSistema inteiro", en: "§fWhole system", es: "§fSistema entero",
  },
  "tracker.ligado": { pt: "ligado", en: "on", es: "encendido" },
  "tracker.desligado": { pt: "desligado", en: "off", es: "apagado" },
  "tracker.ligado_cor": { pt: "§aligado", en: "§aon", es: "§aencendido" },
  "tracker.desligado_cor": { pt: "§8desligado", en: "§8off", es: "§8apagado" },
  "tracker.visitavel": { pt: "§7visitável", en: "§7visitable", es: "§7visitable" },
  "tracker.so_rastreio": {
    pt: "§8só rastreio", en: "§8tracking only", es: "§8solo rastreo",
  },
  "tracker.voltar": { pt: "§8‹ voltar", en: "§8‹ back", es: "§8‹ volver" },

  // --- mapas estelares ---
  "mapa.sem_alvo": {
    pt: "§cEste mapa não aponta pra lugar nenhum.",
    en: "§cThis chart points nowhere.",
    es: "§cEste mapa no apunta a ninguna parte.",
  },
  "mapa.ja_tem": {
    pt: "§7Você já tem as coordenadas de {alvo}.",
    en: "§7You already have {alvo}'s coordinates.",
    es: "§7Ya tienes las coordenadas de {alvo}.",
  },
  "mapa.registrado": {
    pt: "§b§lCOORDENADAS REGISTRADAS\n§r§7{alvo} entrou no rastreador.",
    en: "§b§lCOORDINATES LOGGED\n§r§7{alvo} is now in the tracker.",
    es: "§b§lCOORDENADAS REGISTRADAS\n§r§7{alvo} entró en el rastreador.",
  },

  // --- destroços e veículo ---
  "destrocos.ok": {
    pt: "§7Destroços em §f{x}, {z}§7.",
    en: "§7Wreck at §f{x}, {z}§7.",
    es: "§7Restos en §f{x}, {z}§7.",
  },
  "destrocos.terreno": {
    pt: "§cTerreno acidentado demais aqui — tente num lugar mais aberto.",
    en: "§cGround is too rough here — try somewhere more open.",
    es: "§cEl terreno es muy accidentado — prueba en un lugar más abierto.",
  },
  "veiculo.nao_trazido": {
    pt: "§cO veículo não pôde ser trazido — /scriptevent gh:info",
    en: "§cThe vehicle could not be brought along — /scriptevent gh:info",
    es: "§cNo se pudo traer el vehículo — /scriptevent gh:info",
  },

  // --- engrenagem ---
  "idioma.titulo": { pt: "§lIdioma", en: "§lLanguage", es: "§lIdioma" },
  "idioma.corpo": {
    pt: "§7Escolha o idioma dos avisos e telas do addon.\n§7Os NOMES de itens e blocos vêm do pack de recurso:\n§7troque na engrenagem do pack, nas configurações do mundo.",
    en: "§7Choose the language of the addon's warnings and screens.\n§7Item and block NAMES come from the resource pack:\n§7change those in the pack gear, in world settings.",
    es: "§7Elige el idioma de los avisos y pantallas del addon.\n§7Los NOMBRES de objetos y bloques vienen del paquete:\n§7cámbialos en el engranaje del paquete, en la configuración del mundo.",
  },
  "idioma.trocado": {
    pt: "§aIdioma: §f{idioma}", en: "§aLanguage: §f{idioma}", es: "§aIdioma: §f{idioma}",
  },
  "idioma.boas_vindas": {
    pt: "§b§lGALACTIC HORIZONS\n§r§7Use a §fengrenagem§7 pra escolher o idioma.",
    en: "§b§lGALACTIC HORIZONS\n§r§7Use the §fgear§7 to choose your language.",
    es: "§b§lGALACTIC HORIZONS\n§r§7Usa el §fengranaje§7 para elegir el idioma.",
  },

  // --- diagnóstico (/scriptevent) ---
  "diag.fora_do_planeta": {
    pt: "§7Você não está na Lua nem em Marte.",
    en: "§7You are not on the Moon or on Mars.",
    es: "§7No estás en la Luna ni en Marte.",
  },
  "diag.sim": { pt: "sim", en: "yes", es: "sí" },
  "diag.nao": { pt: "não", en: "no", es: "no" },
};

// Os NOMES dos corpos e biomas. Ficam aqui e não nas tabelas de dados porque
// só existem pra ser LIDOS na tela — o gerador usa o id, nunca o nome.
const NOMES = {
  venus: { pt: "§eVênus", en: "§eVenus", es: "§eVenus" },
  venus_planicies_de_lava: {
    pt: "§6Planícies de Lava", en: "§6Lava Plains", es: "§6Llanuras de Lava" },
  venus_tesserae: { pt: "§8Tesserae", en: "§8Tesserae", es: "§8Tesserae" },
  venus_domos_panqueca: {
    pt: "§ePanquecas Vulcânicas", en: "§ePancake Domes", es: "§eDomos Panqueque" },
  venus_chasmata: { pt: "§4Chasmata", en: "§4Chasmata", es: "§4Chasmata" },
  venus_montes_maxwell: {
    pt: "§fMontes Maxwell", en: "§fMaxwell Montes", es: "§fMontes Maxwell" },
  sun: { pt: "§6Sol", en: "§6Sun", es: "§6Sol" },
  earth: { pt: "§bTerra", en: "§bEarth", es: "§bTierra" },
  moon: { pt: "§7Lua", en: "§7Moon", es: "§7Luna" },
  mars: { pt: "§cMarte", en: "§cMars", es: "§cMarte" },
  sol: { pt: "§eSistema Solar", en: "§eSolar System", es: "§eSistema Solar" },

  mar_de_basalto: { pt: "§8Mar de Basalto", en: "§8Basalt Sea", es: "§8Mar de Basalto" },
  terras_altas: { pt: "§fTerras Altas", en: "§fHighlands", es: "§fTierras Altas" },
  bacia_de_impacto: {
    pt: "§7Bacia de Impacto", en: "§7Impact Basin", es: "§7Cuenca de Impacto",
  },
  polo_sombrio: { pt: "§bPolo Sombrio", en: "§bDark Pole", es: "§bPolo Oscuro" },
  planicie_boreal: {
    pt: "§6Planície Boreal", en: "§6Northern Plain", es: "§6Llanura Boreal",
  },
  terras_altas_do_sul: {
    pt: "§cTerras Altas do Sul", en: "§cSouthern Highlands", es: "§cTierras Altas del Sur",
  },
  valles: { pt: "§4Valles Marineris", en: "§4Valles Marineris", es: "§4Valles Marineris" },
  tharsis: {
    pt: "§8Planalto de Tharsis", en: "§8Tharsis Plateau", es: "§8Meseta de Tharsis",
  },
  campo_de_dunas: { pt: "§eCampo de Dunas", en: "§eDune Field", es: "§eCampo de Dunas" },
  calota_polar: { pt: "§fCalota Polar", en: "§fPolar Cap", es: "§fCasquete Polar" },
};

/**
 * O texto da chave, no idioma do jogador, com os `{buracos}` preenchidos.
 *
 * Chave que não existe volta como ela mesma entre colchetes: erro de digitação
 * aparece na tela em vez de virar "undefined", que é o que some sem ninguém ver.
 */
export function t(player, chave, valores) {
  const linha = TEXTOS[chave];
  if (!linha) return `[${chave}]`;
  let texto = linha[idiomaDe(player)] ?? linha.en ?? linha.pt;
  if (valores) {
    for (const k of Object.keys(valores)) {
      texto = texto.split(`{${k}}`).join(String(valores[k]));
    }
  }
  return texto;
}

/**
 * O nome de um corpo ou bioma, no idioma do jogador.
 *
 * `cru` é o que está na tabela de dados; ele vale quando o id não tem tradução
 * — assim um corpo novo aparece com o nome dele em vez de sumir.
 */
export function nome(player, id, cru) {
  const linha = NOMES[id];
  if (!linha) return cru ?? id;
  return linha[idiomaDe(player)] ?? linha.en ?? linha.pt ?? cru ?? id;
}

/** Tira os códigos de cor — pra quando o nome entra no meio de outra frase. */
export function semCor(s) {
  return String(s).replace(/§./g, "");
}
