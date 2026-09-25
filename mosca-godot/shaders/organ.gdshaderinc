// Tecido vivo (orgaos, ossos, musculos) visto no raio-X: cor base umida com
// padroes procedurais no espaco do proprio orgao (unidades = SVL):
//  vasos     - rede de vasos sanguineos (cristas de ruido: grossos + capilares)
//  cells     - septos alveolares / favo (Worley F2-F1): pulmao, ovario
//  lobules   - lobulos (Worley F1): gordura, pancreas, rim, figado
//  fibers    - fibras musculares ao longo de COLOR.rgb (direcao codificada)
//  mottle    - manchas suaves
// COLOR.a = peso do ventre do musculo (incha com instance 'activation').
uniform vec3 base_col : source_color = vec3(0.8, 0.3, 0.3);
uniform vec3 vein_col : source_color = vec3(0.5, 0.05, 0.08);
uniform float veins = 0.0;
uniform float vein_scale = 18.0;
uniform float cells = 0.0;
uniform float cell_scale = 60.0;
uniform float lobules = 0.0;
uniform float lobule_scale = 40.0;
uniform float fibers = 0.0;
uniform float mottle = 0.25;
uniform float rough = 0.25;
uniform float coat = 0.6;
uniform float sss = 0.2;
uniform float alpha = 1.0;
uniform float bulge = 0.0;
instance uniform float activation = 0.0;
instance uniform float pulse = 0.0;

varying vec3 lp;
varying vec3 fdir;

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
	return vn(p) * 0.55 + vn(p * 2.1) * 0.3 + vn(p * 4.3) * 0.15;
}
vec2 worley(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	float f1 = 8.0;
	float f2 = 8.0;
	for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
		vec3 g = vec3(float(x), float(y), float(z));
		vec3 d = g + h33(i + g) - f;
		float dd = dot(d, d);
		if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) { f2 = dd; }
	}
	return vec2(sqrt(f1), sqrt(f2));
}
// cristas de ruido = vasos que se ramificam
float vessel(vec3 p, float w) {
	vec3 q = p + vec3(fbm(p * 0.7), fbm(p * 0.7 + 7.3), fbm(p * 0.7 + 3.1)) * 1.4;
	float r = 1.0 - abs(vn(q) * 2.0 - 1.0);
	return smoothstep(1.0 - w, 1.0, r);
}

void vertex() {
	lp = VERTEX;
	fdir = COLOR.rgb * 2.0 - 1.0;
	VERTEX += NORMAL * bulge * activation * COLOR.a;
}

vec4 tissue() {
	vec3 col = base_col;
	col *= 1.0 + mottle * (fbm(lp * 25.0) - 0.5);
	if (lobules > 0.0) {
		vec2 w = worley(lp * lobule_scale);
		col *= 1.0 + lobules * (0.35 - smoothstep(0.0, 0.9, w.x) * 0.7);
		col = mix(col, col * 0.7, lobules * (1.0 - smoothstep(0.0, 0.12, w.y - w.x)));
	}
	if (cells > 0.0) {
		vec2 w = worley(lp * cell_scale);
		float septum = 1.0 - smoothstep(0.02, 0.14, w.y - w.x);
		col = mix(col, vein_col, cells * septum * 0.55);
		col *= 1.0 + cells * 0.18 * smoothstep(0.3, 0.9, w.x);
	}
	if (fibers > 0.0) {
		vec3 d = normalize(fdir + vec3(1e-4));
		vec3 u = normalize(cross(d, abs(d.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0)));
		vec3 v = cross(d, u);
		vec3 q = vec3(dot(lp, u), dot(lp, v), dot(lp, d) * 0.06) * 260.0;
		float fas = vn(q) * 0.6 + vn(q * 2.3) * 0.4;
		col *= 1.0 - fibers * 0.35 * smoothstep(0.55, 0.85, fas);
		col *= 1.0 + fibers * 0.12 * sin(dot(lp, d) * 900.0);   // estriacao
	}
	if (veins > 0.0) {
		float big = vessel(lp * vein_scale, 0.05);
		float cap = vessel(lp * vein_scale * 3.7 + 11.0, 0.07) * 0.55;
		col = mix(col, vein_col, clamp((big + cap) * veins, 0.0, 1.0));
	}
	// musculo contraido fica mais vermelho; coracao empalidece na sistole
	col = mix(col, vec3(0.85, 0.08, 0.08), clamp(activation * 0.45, 0.0, 0.6));
	col = mix(col, col * vec3(1.25, 1.1, 1.1), pulse);
	return vec4(col, alpha);
}
