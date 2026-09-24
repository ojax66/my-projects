shader_type spatial;
// Chao do jardim: mistura terra / grama rala / folhas secas por ruido, em
// coordenadas do mundo (mm), com detalhe fino visivel na escala da mosca.
uniform sampler2D noise_big : filter_linear_mipmap, repeat_enable;
uniform sampler2D noise_fine : filter_linear_mipmap, repeat_enable;
uniform vec4 dirt : source_color = vec4(0.36, 0.26, 0.17, 1.0);
uniform vec4 dirt_dark : source_color = vec4(0.22, 0.15, 0.1, 1.0);
uniform vec4 moss : source_color = vec4(0.26, 0.4, 0.12, 1.0);
uniform vec4 litter : source_color = vec4(0.55, 0.4, 0.2, 1.0);
varying vec3 wpos;

void vertex() { wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }

void fragment() {
	vec2 p = wpos.xz;
	float big = texture(noise_big, p / 2500.0).r;
	float mid = texture(noise_big, p / 400.0 + 0.3).r;
	float fine = texture(noise_fine, p / 40.0).r;
	float grain = texture(noise_fine, p / 6.0 + 0.7).r;
	float micro = texture(noise_fine, p / 1.2).r;
	vec3 soil = mix(dirt_dark.rgb, dirt.rgb, smoothstep(0.3, 0.7, fine * 0.6 + grain * 0.4));
	float g = smoothstep(0.42, 0.62, big * 0.7 + mid * 0.3);
	vec3 col = mix(soil, moss.rgb * (0.8 + 0.4 * fine), g);
	float lit = smoothstep(0.68, 0.8, mid * 0.5 + fine * 0.5);
	col = mix(col, litter.rgb * (0.7 + 0.5 * grain), lit * 0.7);
	col *= 0.85 + 0.3 * micro;
	ALBEDO = col;
	ROUGHNESS = 0.95;
	SPECULAR = 0.2;
	// relevo de graos de terra
	vec2 e = vec2(0.2, 0.0);
	float hx = texture(noise_fine, (p + e.xy) / 1.2).r - micro;
	float hz = texture(noise_fine, (p + e.yx) / 1.2).r - micro;
	vec3 n_world = normalize(vec3(-hx * 3.0, 1.0, -hz * 3.0));
	NORMAL = normalize(mix(NORMAL, (VIEW_MATRIX * vec4(n_world, 0.0)).xyz, 0.35));
}
