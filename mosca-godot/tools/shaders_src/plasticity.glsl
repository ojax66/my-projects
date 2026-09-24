// Regra de tres fatores KC -> MBON (Hige et al. 2015) + esquecimento, e a
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
