// Dopamina em cada MBON: DANs reais que o inervam, so os que recebem o
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
