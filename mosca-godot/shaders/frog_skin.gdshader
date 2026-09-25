shader_type spatial;
// Pele opaca da ra (ver frog_skin.gdshaderinc)
#include "res://shaders/frog_skin.gdshaderinc"

void fragment() {
	float h;
	ALBEDO = skin_color(h);
	NORMAL = bump(NORMAL, VERTEX, h, 0.012);
	ROUGHNESS = mix(0.62, 0.4, wet);
	SPECULAR = 0.25;
	CLEARCOAT = wet * 0.3;
	CLEARCOAT_ROUGHNESS = 0.22;
	SSS_STRENGTH = 0.15;
}
