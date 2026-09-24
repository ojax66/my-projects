// Declaracoes comuns aos kernels do cerebro em GPU (incluido por cada shader).
// set 0: conectoma compartilhado (somente leitura)
// set 1: estado de UM cerebro (cada mosca/larva tem o seu)

layout(set = 0, binding = 0, std430) readonly buffer Off  { uint off[]; };
layout(set = 0, binding = 1, std430) readonly buffer Dst  { uint dst[]; };
layout(set = 0, binding = 2, std430) readonly buffer Wt   { int  wsyn[]; };   // sinapses com sinal
layout(set = 0, binding = 3, std430) readonly buffer Chan { int  chan[]; };   // canal sensorial ou -1
layout(set = 0, binding = 4, std430) readonly buffer OutG { int  outg[]; };   // grupo de leitura ou -1
layout(set = 0, binding = 5, std430) readonly buffer Disp { int  dispg[]; };  // grupo de exibicao
layout(set = 0, binding = 6, std430) readonly buffer Row  { int  rowi[]; };   // linha do raster ou -1
layout(set = 0, binding = 7, std430) readonly buffer Flg  { int  flags[]; };  // 1 KC 2 MBON 4 DAN 8 DAN punicao
layout(set = 0, binding = 8, std430) readonly buffer POff { uint poff[]; };   // KC -> MBON (plasticas)
layout(set = 0, binding = 9, std430) readonly buffer PDst { uint pdst[]; };
layout(set = 0, binding = 10, std430) readonly buffer PW0 { float pw0[]; };
layout(set = 0, binding = 11, std430) readonly buffer MOff { uint moff[]; };  // DANs que inervam cada MBON
layout(set = 0, binding = 12, std430) readonly buffer MDan { uint mdan[]; };
layout(set = 0, binding = 13, std430) readonly buffer MW   { float mw[]; };

layout(set = 1, binding = 0, std430) buffer V     { float v[]; };
layout(set = 1, binding = 1, std430) buffer G     { int   gi[]; };      // g (ponto fixo 1e-4 mV), acumulado com atomicos
layout(set = 1, binding = 2, std430) buffer Refr  { float refr[]; };
layout(set = 1, binding = 3, std430) buffer R     { float r[]; };       // taxa (Hz)
layout(set = 1, binding = 4, std430) buffer Elig  { float elig[]; };    // traco de elegibilidade
layout(set = 1, binding = 5, std430) buffer Adapt { float adapt[]; };
layout(set = 1, binding = 6, std430) buffer Spk   { int   spk[]; };     // [0] = contagem, depois ids
layout(set = 1, binding = 7, std430) readonly buffer CR { float chan_rate[]; };
layout(set = 1, binding = 8, std430) buffer Acc   { int   acc[]; };     // somas por grupo + valencia
layout(set = 1, binding = 9, std430) buffer Ras   { int   raster[]; };
layout(set = 1, binding = 10, std430) buffer PW   { float pw[]; };      // pesos plasticos desta mosca
layout(set = 1, binding = 11, std430) buffer DA   { vec4  da[]; };      // por neuronio: base, da efetiva, valencia, -

layout(push_constant, std430) uniform P {
	uint n;          // neuronios
	uint step;       // contador (semente do RNG)
	uint n_out;      // grupos de leitura
	uint n_disp;     // grupos de exibicao
	float dt;        // ms
	float w_syn;     // mV por sinapse
	float learn;     // taxa de aprendizado efetiva * dt(s)
	float rec;       // recuperacao (dt / tau)
} pc;

const float V_REST = -52.0;
const float V_TH = -45.0;
const float TAU_M = 20.0;
const float TAU_S = 5.0;
const float T_REF = 2.2;
const float W_POISSON = 8.0;
const float FIX = 1000.0;
// depressao sinaptica de curto prazo (Tsodyks-Markram): fracao U dos recursos
// e gasta a cada spike e volta com tau_rec. Guardada em da[i].w.
const float STD_U = 0.06;
const float STD_TAU = 300.0;

uint hash(uint x) {
	x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16;
	return x;
}
float rand01(uint i, uint s) { return float(hash(i * 747796405U + s * 2891336453U + 1U) & 0xFFFFFFU) / 16777216.0; }

float input_rate(uint i) {
	int c = chan[i];
	return c >= 0 ? chan_rate[c] : 0.0;
}

void add_group(uint i, int amount) {
	int o = outg[i];
	if (o >= 0) atomicAdd(acc[o], amount);
	atomicAdd(acc[pc.n_out + uint(dispg[i])], amount);
}

// Garante que todos os bindings existam em todos os kernels (o compilador
// removeria os nao usados e os conjuntos de uniforms deixariam de bater).
void touch_all() {
	if (pc.n != 0xFFFFFFFFu) return;
	uint s = off[0] + dst[0] + uint(wsyn[0] + chan[0] + outg[0] + dispg[0] + rowi[0] + flags[0]) + poff[0] + pdst[0] + moff[0] + mdan[0];
	float f = pw0[0] + mw[0] + v[0] + refr[0] + r[0] + elig[0] + adapt[0] + chan_rate[0] + pw[0] + da[0].x;
	gi[0] = int(s) + int(f) + spk[0] + acc[0] + raster[0];
}
