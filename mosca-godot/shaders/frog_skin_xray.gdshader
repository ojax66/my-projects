shader_type spatial;
// Pele da ra no raio-X: a mesma pintura, translucida
render_mode blend_mix, depth_draw_never, cull_back;
#include "res://shaders/frog_skin.gdshaderinc"

void fragment() {
	float h;
	ALBEDO = skin_color(h);
	NORMAL = bump(NORMAL, VERTEX, h, 0.012);
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 2.0);
	ALPHA = clamp(xray_alpha + fres * 0.3, 0.0, 1.0);
	ROUGHNESS = 0.3;
	CLEARCOAT = 0.6;
}
