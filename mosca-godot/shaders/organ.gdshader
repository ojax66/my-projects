shader_type spatial;
// Orgaos opacos (ver organ.gdshaderinc)
render_mode cull_disabled;
#include "res://shaders/organ.gdshaderinc"

void fragment() {
	vec4 t = tissue();
	ALBEDO = t.rgb;
	ROUGHNESS = rough;
	SPECULAR = 0.45;
	CLEARCOAT = coat;
	CLEARCOAT_ROUGHNESS = 0.12;
	SSS_STRENGTH = sss;
	RIM = 0.12;
	RIM_TINT = 0.6;
}
