shader_type spatial;
// Agua de lago: esverdeada, transparente, com reflexo (fresnel) e ondinhas.
render_mode blend_mix, depth_draw_opaque, cull_disabled, specular_schlick_ggx;

uniform vec4 shallow : source_color = vec4(0.3, 0.45, 0.32, 0.22);
uniform vec4 deep : source_color = vec4(0.1, 0.22, 0.2, 0.55);

float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y);
}

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 p = wpos.xz * 0.02;
	float t = TIME * 0.35;
	float w1 = n(p + vec2(t, t * 0.7));
	float w2 = n(p * 2.3 - vec2(t * 0.8, t));
	vec3 nrm = normalize(vec3((w1 - 0.5) * 0.25, 1.0, (w2 - 0.5) * 0.25));
	NORMAL = (VIEW_MATRIX * vec4(nrm, 0.0)).xyz;
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0);
	vec4 c = mix(shallow, deep, clamp(w1 * 0.6, 0.0, 1.0));
	ALBEDO = c.rgb;
	ALPHA = clamp(c.a + fres * 0.4, 0.0, 0.92);
	ROUGHNESS = 0.05;
	METALLIC = 0.0;
	SPECULAR = 0.8;
}
