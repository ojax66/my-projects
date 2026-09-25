// Pele da ra (padrao do sapo-banjo), pintada sem textura a partir da
// posicao de repouso de cada vertice (UV = x,y ; UV2.x = z) e das mascaras
// em COLOR (r = dorso, g = labio, b = dedos, a = coordenada ao longo do
// membro para as faixas). Dorso cinza-marrom escuro com reticulado preto e
// verrugas cor de ferrugem, flancos marmorizados, barriga creme, membros com
// faixas escuras, dedos claros, labio bronze, timpano escuro. A pele e
// umida (clearcoat) e as verrugas tem relevo (bump pelas derivadas).
uniform float hue = 0.0;
uniform float albino = 0.0;
uniform float wet = 0.7;
uniform float xray_alpha = 0.28;
uniform float fat = 0.5;       // reserva de gordura (energia): o corpo engorda/emagrece

varying vec3 rest;
varying vec4 msk;
varying float region;

float h31(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.zyx + 31.32);
	return fract((p.x + p.y) * p.z);
}
vec3 h33(vec3 p) {
	p = fract(p * vec3(0.1031, 0.1030, 0.0973));
	p += dot(p, p.yxz + 33.33);
	return fract((p.xxy + p.yxx) * p.zyx);
}
float vn(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
	return vn(p) * 0.5 + vn(p * 2.03) * 0.28 + vn(p * 4.1) * 0.14 + vn(p * 8.3) * 0.08;
}
// Worley: distancia ao centro da celula mais proxima e o "id" dela
vec2 cells(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	float best = 8.0;
	float id = 0.0;
	for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
		vec3 g = vec3(float(x), float(y), float(z));
		vec3 o = h33(i + g);
		float d = length(g + o - f);
		if (d < best) { best = d; id = h31(i + g + 7.7); }
	}
	return vec2(best, id);
}

void vertex() {
	rest = vec3(UV.x, UV.y, UV2.x);
	region = floor(UV2.y + 0.01);
	float fat_w = (UV2.y - region) / 0.49;
	VERTEX += NORMAL * fat_w * (fat - 0.5) * 0.045;
	msk = COLOR;
}

vec3 skin_color(out float height) {
	vec3 p = rest;
	float dorsal = msk.r;
	float digit = msk.b;
	float band = msk.a * 2.0 - 1.0;
	// dorso: cinza-marrom escuro, manchado
	float m = fbm(p * 16.0);
	vec3 back = mix(vec3(0.07, 0.055, 0.04), vec3(0.2, 0.14, 0.085), smoothstep(0.35, 0.7, m));
	// reticulado preto
	float ret = 1.0 - abs(fbm(p * 28.0 + 3.0) * 2.0 - 1.0);
	back = mix(back, vec3(0.05, 0.045, 0.04), smoothstep(0.82, 0.95, ret) * 0.8);
	// verrugas: celulas; varias cor de ferrugem, mais nas fileiras dorsolaterais
	vec2 w = cells(p / 0.034 + 20.0);
	float wart = pow(clamp(1.0 - w.x / 0.42, 0.0, 1.0), 2.0);
	float dl = exp(-pow((abs(p.x) - 0.15) / 0.07, 2.0));
	float rusty = step(0.62 - 0.35 * dl, w.y);
	vec3 rust = mix(vec3(0.42, 0.22, 0.09), vec3(0.62, 0.36, 0.14), fract(w.y * 7.0));
	back = mix(back, rust, wart * rusty * smoothstep(0.1, 0.5, dorsal));
	back = mix(back, back * 1.25, wart * (1.0 - rusty) * 0.5);
	// barriga creme com marmorizado cinza perto dos flancos
	vec3 belly = vec3(0.7, 0.66, 0.56);
	float marble = smoothstep(0.45, 0.62, fbm(p * 22.0 + 9.0));
	belly = mix(belly, vec3(0.3, 0.29, 0.28), marble * smoothstep(0.08, 0.35, dorsal + 0.25 * (1.0 - smoothstep(0.1, 0.25, abs(p.x)))));
	vec3 col = mix(belly, back, smoothstep(0.25, 0.7, dorsal));
	// membros: faixas transversais escuras
	if (band > -0.5) {
		float bars = smoothstep(0.55, 0.72, fract(band * 3.3 + fbm(p * 10.0) * 0.35));
		col = mix(col, vec3(0.07, 0.06, 0.05), bars * 0.7 * smoothstep(0.3, 0.7, dorsal));
	}
	// dedos claros acinzentados
	col = mix(col, mix(vec3(0.36, 0.33, 0.29), vec3(0.5, 0.47, 0.41), fbm(p * 30.0)), digit * 0.6);
	// labio superior bronze e faixa escura do focinho ate o olho
	col = mix(col, vec3(0.58, 0.42, 0.24), msk.g * 0.8);
	// timpano: disco marrom-escuro atras do olho
	float ty = length(vec3(abs(p.x) - 0.225, p.y - 0.345, p.z + 0.255));
	col = mix(col, vec3(0.2, 0.15, 0.1), smoothstep(0.045, 0.03, ty));
	// albinismo (defeito genetico): sem melanina
	vec3 alb = mix(vec3(0.95, 0.8, 0.72), vec3(1.0, 0.93, 0.78), smoothstep(0.3, 0.7, dorsal)) * (0.9 + 0.1 * m);
	alb = mix(alb, vec3(1.0, 0.75, 0.5), wart * 0.3);
	col = mix(col, alb, albino);
	// variacao individual (gene da cor)
	col *= vec3(1.0 + hue * 0.8, 1.0 + hue * 0.2, 1.0 - hue * 0.6);
	height = wart * 0.9 * (0.3 + dorsal) + fbm(p * 90.0) * 0.25;
	return col;
}

vec3 bump(vec3 n, vec3 vtx, float h, float k) {
	vec3 dpdx = dFdx(vtx);
	vec3 dpdy = dFdy(vtx);
	float dhx = dFdx(h);
	float dhy = dFdy(h);
	vec3 r1 = cross(dpdy, n);
	vec3 r2 = cross(n, dpdx);
	float det = dot(dpdx, r1);
	vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
	return normalize(abs(det) * n - grad * k);
}
