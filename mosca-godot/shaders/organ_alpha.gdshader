shader_type spatial;
// Orgaos de parede fina / translucidos: pulmoes, bexiga, atrios, cartilagem
render_mode cull_disabled, depth_draw_always;
#include "res://shaders/organ.gdshaderinc"

void fragment() {
	vec4 t = tissue();
	ALBEDO = t.rgb;
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 2.0);
	ALPHA = clamp(t.a + fres * 0.35, 0.0, 1.0);
	ROUGHNESS = rough;
	SPECULAR = 0.5;
	CLEARCOAT = coat;
	CLEARCOAT_ROUGHNESS = 0.1;
}
