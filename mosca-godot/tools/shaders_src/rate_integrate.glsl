// Campo medio, fase 2: taxa pela curva f-I do LIF, com adaptacao.
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
