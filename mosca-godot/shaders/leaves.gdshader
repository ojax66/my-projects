shader_type spatial;
render_mode cull_disabled, depth_prepass_alpha;
// Folhas em cartoes (MultiMesh). Cor por instancia em COLOR, vento no vertex.
uniform sampler2D leaf_tex : source_color, filter_linear_mipmap;
uniform float wind_strength = 6.0;
uniform float wind_speed = 1.3;

void vertex() {
	vec3 world = (MODEL_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float ph = COLOR.a * 6.2831 + world.x * 0.004 + world.z * 0.003;
	float sway = sin(TIME * wind_speed + ph) * 0.5 + sin(TIME * wind_speed * 2.3 + ph * 1.7) * 0.25;
	// deslocamento em espaco local (as folhas tem escala ~50 mm)
	VERTEX += vec3(sway, sway * 0.4, sway * 0.6) * (UV.y < 0.5 ? 1.0 : 0.3) * wind_strength / 50.0;
}

void fragment() {
	vec4 t = texture(leaf_tex, UV);
	ALBEDO = t.rgb * COLOR.rgb;
	ALPHA = t.a;
	ALPHA_SCISSOR_THRESHOLD = 0.5;
	ROUGHNESS = 0.6;
	SPECULAR = 0.35;
	BACKLIGHT = vec3(0.35, 0.45, 0.15);
}
