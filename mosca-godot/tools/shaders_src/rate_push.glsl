// Campo medio, fase 1: cada neuronio ativo empurra r * tau_s * w para os alvos.
void main() {
	uint i = gl_GlobalInvocationID.x;
	if (i >= pc.n) return;
	float ri = r[i];
	if (ri < 0.5) return;
	float s = ri * da[i].w * TAU_S / 1000.0 * pc.w_syn * FIX;
	for (uint k = off[i]; k < off[i + 1]; k++) atomicAdd(gi[dst[k]], int(float(wsyn[k]) * wmul(k) * s));
	if ((flags[i] & 1) != 0)
		for (uint p = poff[i]; p < poff[i + 1]; p++) atomicAdd(gi[pdst[p]], int(pw[p] * s));
}
