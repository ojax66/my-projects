shader_type spatial;
// Olho da ra: iris dourado-bronze com reticulado escuro, parte de cima mais
// escura, pupila horizontal preta, cornea brilhante. O eixo do olho e o -Z
// local do globo.
uniform float albino = 0.0;
varying vec3 lp;

float h31(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.zyx + 31.32);
	return fract((p.x + p.y) * p.z);
}
float vn(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

void vertex() {
	lp = normalize(VERTEX);
}

void fragment() {
	vec3 n = lp;
	float front = -n.z;                       // 1 no centro da pupila
	vec2 q = n.xy / max(1.0 - n.z * 0.0, 0.2);
	vec3 iris = mix(vec3(0.62, 0.42, 0.16), vec3(0.85, 0.62, 0.28), vn(n * 30.0));
	iris = mix(iris, vec3(0.2, 0.12, 0.06), smoothstep(0.55, 0.8, 1.0 - abs(vn(n * 22.0 + 4.0) * 2.0 - 1.0)) * 0.6);
	iris = mix(iris, iris * 0.35, smoothstep(0.1, 0.55, n.y));          // metade de cima escura
	vec3 red = vec3(0.8, 0.2, 0.2);
	iris = mix(iris, red, albino);
	// pupila horizontal
	float pup = length(vec2(q.x / 0.33, q.y / 0.19));
	vec3 col = mix(vec3(0.01), iris, smoothstep(0.95, 1.08, pup));
	col = mix(vec3(0.03, 0.025, 0.02), col, smoothstep(0.1, 0.3, front));   // atras fica escuro (orbita)
	ALBEDO = col;
	ROUGHNESS = 0.05;
	SPECULAR = 0.8;
	CLEARCOAT = 1.0;
	CLEARCOAT_ROUGHNESS = 0.02;
}
