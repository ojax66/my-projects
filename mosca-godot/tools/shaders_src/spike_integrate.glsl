// LIF com dt fixo (1 ms): integra, dispara, registra spikes e contagens.
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
