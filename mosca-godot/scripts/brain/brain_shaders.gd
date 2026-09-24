# GERADO por tools/gen_brain_shaders.py a partir de tools/shaders_src/*.glsl -- nao edite a mao
class_name BrainShaders
extends RefCounted

const COMMON := """// Declaracoes comuns aos kernels do cerebro em GPU (incluido por cada shader).
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
"""

const KERNELS := {
	"dopamine": """// Dopamina em cada MBON: DANs reais que o inervam, so os que recebem o
// estimulo incondicionado agora; acima de uma linha de base lenta.
void main() {
	uint m = gl_GlobalInvocationID.x;
	if (m >= pc.n || (flags[m] & 2) == 0) return;
	float num = 0.0, tot = 0.0, pun = 0.0;
	for (uint k = moff[m]; k < moff[m + 1]; k++) {
		uint d = mdan[k];
		tot += mw[k];
		if ((flags[d] & 8) != 0) pun += mw[k];
		if (input_rate(d) > 0.0) num += mw[k] * r[d];
	}
	vec4 s = da[m];
	if (tot <= 0.0) { da[m] = vec4(0.0, 0.0, 0.0, s.w); return; }
	float d_now = num / tot / 40.0;
	float base = s.x + (min(d_now, s.x + 0.5) - s.x) * min(1.0, pc.dt / 20000.0);
	da[m] = vec4(base, max(0.0, d_now - base - 0.25), pun > tot * 0.5 ? 1.0 : -1.0, s.w);
}
""",
	"plasticity": """// Regra de tres fatores KC -> MBON (Hige et al. 2015) + esquecimento, e a
// leitura da valencia aprendida (acumulada em acc[n_out + n_disp + 0..2]).
void main() {
	uint i = gl_GlobalInvocationID.x;
	if (i >= pc.n || (flags[i] & 1) == 0) return;
	float e = elig[i];
	uint base = pc.n_out + pc.n_disp;
	for (uint p = poff[i]; p < poff[i + 1]; p++) {
		uint post = pdst[p];
		float w0 = pw0[p];
		float w = pw[p];
		vec4 d = da[post];
		if (e > 0.02 && d.y > 0.0) w -= pc.learn * d.y * e * w;
		w += (w0 - w) * pc.rec;
		w = clamp(w, w0 * 0.05, w0 * 1.5);
		pw[p] = w;
		float dw = w / w0 - 1.0;
		if (e > 0.05) {
			atomicAdd(acc[base], int(d.z * dw * e * FIX));
			atomicAdd(acc[base + 1], int(e * FIX));
		}
		atomicAdd(acc[base + 2], int(abs(dw) * 1000.0));
	}
}
""",
	"rate_integrate": """// Campo medio, fase 2: taxa pela curva f-I do LIF, com adaptacao.
float lif_noisy(float x, float th) {
	const float SIG = 0.8;
	float xe = th + SIG * log(1.0 + exp(clamp((x - th) / SIG, -30.0, 30.0)));
	return 1.0 / (T_REF / 1000.0 + TAU_M / 1000.0 * log(xe / (xe - th)));
}

void main() {
	uint i = gl_GlobalInvocationID.x;
	if (i >= pc.n) return;
	float x = float(gi[i]) / FIX;
	gi[i] = 0;
	float ri = r[i];
	float ad = adapt[i] + (ri - adapt[i]) * min(1.0, pc.dt / 400.0);
	adapt[i] = ad;
	x -= 0.1 * ad + 0.3 * max(0.0, ad - 80.0);
	float th = V_TH - V_REST;
	// curva f-I do LIF suavizada pelo ruido sinaptico (sigma ~1.5 mV): perto
	// do limiar a flutuacao das entradas ja faz o neuronio disparar
	float target = max(0.0, lif_noisy(x, th) - lif_noisy(0.0, th));
	float ir = input_rate(i);
	if (ir > 0.0) target += ir * clamp((x + th) / th, 0.0, 1.0);
	target = min(target, 200.0);
	ri += (target - ri) * (pc.dt / (pc.dt + 30.0));
	r[i] = ri;
	float dep = da[i].w;
	dep += pc.dt * ((1.0 - dep) / STD_TAU - STD_U * dep * ri / 1000.0);
	da[i].w = clamp(dep, 0.02, 1.0);
	elig[i] = max(elig[i] * exp(-pc.dt / 1500.0), clamp((ri - 5.0) / 40.0, 0.0, 1.0));
	add_group(i, int(ri * 10.0));
	int row = rowi[i];
	if (row >= 0 && rand01(i, pc.step) < ri * pc.dt / 1000.0) raster[row] = 1;
}
""",
	"rate_push": """// Campo medio, fase 1: cada neuronio ativo empurra r * tau_s * w para os alvos.
void main() {
	uint i = gl_GlobalInvocationID.x;
	if (i >= pc.n) return;
	float ri = r[i];
	if (ri < 0.5) return;
	float s = ri * da[i].w * TAU_S / 1000.0 * pc.w_syn * FIX;
	for (uint k = off[i]; k < off[i + 1]; k++) atomicAdd(gi[dst[k]], int(float(wsyn[k]) * s));
	if ((flags[i] & 1) != 0)
		for (uint p = poff[i]; p < poff[i + 1]; p++) atomicAdd(gi[pdst[p]], int(pw[p] * s));
}
""",
	"reset": """// Zera a lista de spikes entre passos.
void main() { if (gl_GlobalInvocationID.x == 0) spk[0] = 0; }
""",
	"spike_integrate": """// LIF com dt fixo (1 ms): integra, dispara, registra spikes e contagens.
void main() {
	uint i = gl_GlobalInvocationID.x;
	if (i >= pc.n) return;
	float decay = exp(-pc.dt / TAU_S);
	float g = float(gi[i]) / FIX * decay;
	gi[i] = int(g * FIX);
	float dep = da[i].w;
	dep += (1.0 - dep) * (pc.dt / STD_TAU);
	float a_r = exp(-pc.dt / 100.0);
	r[i] *= a_r;
	elig[i] *= exp(-pc.dt / 1500.0);
	if (refr[i] > 0.0) { refr[i] -= pc.dt; da[i].w = dep; return; }
	float vi = v[i];
	float ir = input_rate(i);
	if (ir > 0.0 && rand01(i, pc.step) < ir * pc.dt / 1000.0) vi += W_POISSON;
	vi += (g - (vi - V_REST)) * (pc.dt / TAU_M);
	if (vi >= V_TH) {
		vi = V_REST;
		refr[i] = T_REF;
		r[i] += (1.0 - a_r) * 1000.0 / pc.dt;
		elig[i] = min(elig[i] + 0.15, 1.0);
		dep *= (1.0 - STD_U);
		uint k = uint(atomicAdd(spk[0], 1));
		spk[1 + k] = int(i);
		add_group(i, 1);
		int row = rowi[i];
		if (row >= 0) raster[row] = 1;
	}
	v[i] = vi;
	da[i].w = dep;
}
""",
	"spike_propagate": """// Propagacao por eventos: so os neuronios que dispararam somam nas sinapses.
void main() {
	uint total = gl_NumWorkGroups.x * gl_WorkGroupSize.x;
	uint count = uint(spk[0]);
	for (uint s = gl_GlobalInvocationID.x; s < count; s += total) {
		uint pre = uint(spk[1 + s]);
		float ws = pc.w_syn * FIX * da[pre].w / (1.0 - STD_U);
		for (uint k = off[pre]; k < off[pre + 1]; k++) atomicAdd(gi[dst[k]], int(float(wsyn[k]) * ws));
		if ((flags[pre] & 1) != 0)
			for (uint p = poff[pre]; p < poff[pre + 1]; p++) atomicAdd(gi[pdst[p]], int(pw[p] * ws));
	}
}
""",
}
