shader_type spatial;
// Casca de fruta: duas cores misturadas por ruido, pintinhas (lenticelas),
// poros para citricos e brilho de cera.
uniform vec4 color_a : source_color = vec4(0.8, 0.1, 0.05, 1.0);
uniform vec4 color_b : source_color = vec4(0.95, 0.7, 0.2, 1.0);
uniform float seed = 0.0;
uniform float dimples = 0.0;
uniform float radius = 30.0;
varying vec3 obj_pos;

float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float noise(vec3 p) {
	vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	float n000 = hash(i), n100 = hash(i + vec3(1,0,0)), n010 = hash(i + vec3(0,1,0)), n110 = hash(i + vec3(1,1,0));
	float n001 = hash(i + vec3(0,0,1)), n101 = hash(i + vec3(1,0,1)), n011 = hash(i + vec3(0,1,1)), n111 = hash(i + vec3(1,1,1));
	return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbm(vec3 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

void vertex() { obj_pos = VERTEX / radius; }

void fragment() {
	vec3 p = obj_pos + seed;
	float m = fbm(p * 2.2);
	float streak = fbm(vec3(p.x * 6.0, p.y * 1.2, p.z * 6.0));
	float t = smoothstep(0.3, 0.75, m * 0.7 + streak * 0.3 + obj_pos.y * 0.25);
	vec3 col = mix(color_a.rgb, color_b.rgb, t);
	float speck = step(0.93, noise(p * 38.0));
	col = mix(col, color_b.rgb * 1.2, speck * 0.5 * (1.0 - dimples));
	ALBEDO = col;
	float pores = noise(p * 60.0);
	ROUGHNESS = mix(0.28, 0.5, pores * dimples + m * 0.2);
	SPECULAR = 0.6;
	CLEARCOAT = 0.3;
	CLEARCOAT_ROUGHNESS = 0.3;
	if (dimples > 0.5) {
		NORMAL = normalize(NORMAL + (vec3(noise(p * 70.0), noise(p * 70.0 + 3.1), noise(p * 70.0 + 7.3)) - 0.5) * 0.25);
	}
}
