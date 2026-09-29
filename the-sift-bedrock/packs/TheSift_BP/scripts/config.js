/* Números de ajuste do port. Tudo o que é "quanto" mora aqui. */

export const NS = "the_sift";
export const SIFT_DIM = "the_sift:the_sift";

// Geração do terreno (world_generator_API + budget)
export const GEN_RADIUS_CHUNKS = 5;
export const CHUNKS_PER_TICK = 2;
export const BLOCK_BUDGET_PER_TICK = 4000;
export const SIFT_MIN_Y = 0;
export const SIFT_MAX_Y = 256;

// Sequência que abre o portal (índices 1..8 dos sons da ardósia sonora).
// A de fechar é a mesma ao contrário.
export const OPEN_SEQUENCE = [1, 3, 7, 6, 5, 2, 4, 8];

// Portal principal no Sift: perto da origem do mundo
export const MAIN_PORTAL_SEARCH = 96;

// Criaturas
export const SPAWN_INTERVAL = 80;          // ticks entre tentativas
export const SPAWN_CAP_PER_PLAYER = 10;    // criaturas do Sift num raio de 64 blocos
