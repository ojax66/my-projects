shader_type spatial;
// Pele do girino: dorso escuro com pintinhas (melanoforos) e pontos dourados
// (iridoforos), barriga translucida, miomeros em V na musculatura da cauda e
// nadadeiras finas quase transparentes com pigmento salpicado.
// UV.x = posicao ao longo do corpo (0 focinho .. 1 ponta da cauda)
// UV.y = altura relativa na secao (-1 ventre/nadadeira de baixo .. 1 dorso)
// COLOR.a = opacidade base (barriga/nadadeiras), COLOR.r = 1 na nadadeira
render_mode blend_mix, depth_draw_always, cull_disabled;

uniform float body_frac = 0.36;
uniform float xray = 0.0;
uniform vec3 dorsal : source_color = vec3(0.2, 0.18, 0.11);
uniform vec3 belly : source_color = vec3(0.78, 0.74, 0.58);

float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float nz(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hsh(i), hsh(i + vec2(1, 0)), u.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), u.x), u.y);
}

void fragment() {
	float x = UV.x;
	float h = UV.y;
	float fin = COLOR.r;
	vec3 col = mix(belly, dorsal, smoothstep(-0.35, 0.25, h));
	// melanoforos (pintas escuras) e iridoforos (pontinhos dourados)
	float sp = nz(vec2(x * 90.0, h * 14.0 + x * 7.0));
	col *= mix(0.55, 1.1, smoothstep(0.35, 0.75, sp));
	float gold = step(0.93, hsh(floor(vec2(x * 160.0, h * 30.0))));
	col = mix(col, vec3(0.85, 0.7, 0.3), gold * 0.6 * (1.0 - fin));
	// miomeros em V na cauda (chevrons)
	if (x > body_frac && fin < 0.5) {
		float v = fract((x - body_frac) * 38.0 - abs(h) * 0.35);
		col *= 1.0 - 0.28 * smoothstep(0.85, 1.0, v);
	}
	// nadadeira: membrana clara com pigmento salpicado
	if (fin > 0.5) {
		col = mix(vec3(0.55, 0.52, 0.42), dorsal, step(0.78, nz(vec2(x * 60.0, h * 25.0))) * 0.8);
	}
	ALBEDO = col;
	float a = COLOR.a;
	a *= mix(1.0, 0.35, xray);
	ALPHA = a;
	ROUGHNESS = 0.25;
	SPECULAR = 0.6;
	CLEARCOAT = 0.6;
	CLEARCOAT_ROUGHNESS = 0.2;
	SSS_STRENGTH = 0.3;
}
