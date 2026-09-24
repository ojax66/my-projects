shader_type spatial;
render_mode cull_disabled;
// Laminas de grama (MultiMesh). UV.y = 0 na ponta. Vento e cor por instancia.
uniform vec4 base_color : source_color = vec4(0.12, 0.28, 0.06, 1.0);
uniform vec4 tip_color : source_color = vec4(0.55, 0.75, 0.25, 1.0);
uniform float wind_strength = 10.0;

void vertex() {
	vec3 world = (MODEL_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float h = 1.0 - UV.y;
	float w = sin(TIME * 1.7 + world.x * 0.006 + world.z * 0.004) + 0.4 * sin(TIME * 3.9 + world.x * 0.02);
	VERTEX.x += w * h * h * wind_strength / 60.0;
	VERTEX.z += w * h * h * wind_strength * 0.4 / 60.0;
}

void fragment() {
	float h = 1.0 - UV.y;
	vec3 c = mix(base_color.rgb, tip_color.rgb * COLOR.rgb, h);
	ALBEDO = c;
	ROUGHNESS = 0.7;
	SPECULAR = 0.3;
	BACKLIGHT = vec3(0.3, 0.4, 0.1) * h;
	AO = mix(0.4, 1.0, h);
	AO_LIGHT_AFFECT = 0.4;
}
