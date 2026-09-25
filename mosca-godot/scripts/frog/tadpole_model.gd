class_name TadpoleModel
extends Node3D
## Corpo do girino (comprimento total = 1, depois escalado): corpo ovoide com
## a barriga translucida (da para ver o intestino enrolado em espiral e o
## coracao batendo, como num girino de verdade), olhos, disco oral com o
## bico corneo, espiraculo, branquias internas (raio-X), e a cauda com os
## blocos musculares (miomeros) e as nadadeiras dorsal e ventral.
## A cauda e uma cadeia de segmentos: o angulo de cada um vem da contracao
## dos musculos esquerdo/direito calculada pelo Tadpole (motoneuronios).

const SEGS := 10
var body_frac := 0.36            # fracao do comprimento que e corpo
var skin: StandardMaterial3D
var _tail: Array[Node3D] = []
var _muscles: Array[MeshInstance3D] = []
var _gut: Array[MeshInstance3D] = []
var _heart: MeshInstance3D
var _gills: Array[MeshInstance3D] = []
var _beak: Array[MeshInstance3D] = []
var _legs_h: Array[Node3D] = []
var _legs_f: Array[Node3D] = []
var _body: MeshInstance3D
var _xray := false
static var _sph: SphereMesh


func build(seed_i: int) -> void:
	if _sph == null:
		_sph = SphereMesh.new()
		_sph.radius = 0.5
		_sph.height = 1.0
		_sph.radial_segments = 14
		_sph.rings = 7
	skin = StandardMaterial3D.new()
	skin.vertex_color_use_as_albedo = true
	skin.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	skin.roughness = 0.3
	skin.clearcoat_enabled = true
	skin.clearcoat = 0.7
	var nt := NoiseTexture2D.new()
	var nz := FastNoiseLite.new()
	nz.seed = seed_i
	nz.frequency = 0.08
	nt.noise = nz
	var g := Gradient.new()
	g.set_color(0, Color(0.5, 0.45, 0.35))
	g.set_color(1, Color(1, 1, 1))
	nt.color_ramp = g
	skin.albedo_texture = nt
	_body = MeshInstance3D.new()
	_body.mesh = _loft()
	_body.material_override = skin
	add_child(_body)
	_head_parts()
	_inside()
	_build_tail()
	for s in [-1.0, 1.0]:
		_legs_h.append(_leg(Vector3(0.05 * s, -0.04, -0.02), s, 0.16))
		_legs_f.append(_leg(Vector3(0.07 * s, -0.05, -0.2), s, 0.09))
	set_xray(false)


func _loft() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rings := 24
	var segs := 20
	var L := body_frac
	for i in rings + 1:
		var t := float(i) / rings
		var w := 0.13 * pow(sin(PI * clampf(t * 0.92 + 0.04, 0.0, 1.0)), 0.7)
		var h := 0.11 * pow(sin(PI * clampf(t * 0.95 + 0.03, 0.0, 1.0)), 0.8)
		var z := -0.5 + t * L
		for j in segs + 1:
			var a := TAU * float(j) / segs
			var x := cos(a) * w
			var y := sin(a) * h * (1.0 if sin(a) > 0.0 else 0.85)
			var belly := clampf(-sin(a) * 1.5, 0.0, 1.0)
			var col := Color(0.22, 0.2, 0.12).lerp(Color(0.8, 0.78, 0.62), belly)
			col.a = lerpf(0.97, 0.45, belly)    # barriga translucida
			st.set_color(col)
			st.set_uv(Vector2(float(j) / segs * 2.0, t * 2.0))
			st.add_vertex(Vector3(x, y, z))
	for i in rings:
		for j in segs:
			var a := i * (segs + 1) + j
			var b := a + segs + 1
			for idx in [a, b, a + 1, a + 1, b, b + 1]:
				st.add_index(idx)
	st.generate_normals()
	return st.commit()


func _mi(parent: Node3D, col: Color, pos: Vector3, sc: Vector3, alpha := 1.0) -> MeshInstance3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(col.r, col.g, col.b, alpha)
	if alpha < 1.0:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.roughness = 0.3
	var mi := MeshInstance3D.new()
	mi.mesh = _sph
	mi.material_override = m
	mi.position = pos
	mi.scale = sc
	parent.add_child(mi)
	return mi


func _head_parts() -> void:
	for s in [-1.0, 1.0]:
		_mi(self, Color(0.75, 0.62, 0.3), Vector3(0.075 * s, 0.05, -0.43), Vector3.ONE * 0.05)
		_mi(self, Color(0.02, 0.02, 0.02), Vector3(0.088 * s, 0.056, -0.445), Vector3.ONE * 0.028)
		# bico corneo (mandibulas de queratina) no disco oral
		_beak.append(_mi(self, Color(0.05, 0.04, 0.03), Vector3(0.0, -0.035 + 0.012 * s, -0.49), Vector3(0.05, 0.012, 0.018)))
	_mi(self, Color(0.55, 0.45, 0.3), Vector3(0, -0.035, -0.485), Vector3(0.08, 0.035, 0.03))   # disco oral
	var sp := _mi(self, Color(0.25, 0.22, 0.15), Vector3(-0.12, -0.02, -0.3), Vector3(0.02, 0.02, 0.05))   # espiraculo
	sp.rotation.y = 0.6


func _inside() -> void:
	# intestino longo enrolado em espiral (girinos herbivoros)
	for k in 22:
		var a := float(k) * 0.9
		var r := 0.055 * (1.0 - float(k) / 30.0)
		var p := Vector3(cos(a) * r, -0.045 + sin(a) * r * 0.35, -0.3 + sin(a) * r * 0.9 + float(k) * 0.004)
		_gut.append(_mi(self, Color(0.35, 0.4, 0.18), p, Vector3.ONE * 0.026))
	_heart = _mi(self, Color(0.8, 0.05, 0.08), Vector3(0, -0.05, -0.4), Vector3.ONE * 0.03)
	for s in [-1.0, 1.0]:
		var gl := _mi(self, Color(0.85, 0.15, 0.2), Vector3(0.07 * s, -0.01, -0.36), Vector3(0.03, 0.05, 0.06))
		_gills.append(gl)
	_mi(self, Color(0.95, 0.8, 0.8), Vector3(0, 0.05, -0.43), Vector3(0.04, 0.03, 0.06))   # cerebro


func _build_tail() -> void:
	var parent: Node3D = self
	var seg_len := (1.0 - body_frac) / SEGS
	var fin_mat := StandardMaterial3D.new()
	fin_mat.albedo_color = Color(0.5, 0.47, 0.36, 0.62)
	fin_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	fin_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	fin_mat.roughness = 0.2
	var musc := StandardMaterial3D.new()
	musc.vertex_color_use_as_albedo = false
	musc.albedo_color = Color(0.36, 0.3, 0.2)
	musc.roughness = 0.35
	for i in SEGS:
		var j := Node3D.new()
		j.position = Vector3(0, 0, (-0.5 + body_frac) if i == 0 else seg_len)
		parent.add_child(j)
		var t := float(i) / SEGS
		var thick := lerpf(0.07, 0.012, t)
		var m := MeshInstance3D.new()
		m.mesh = _sph
		m.material_override = musc
		m.position = Vector3(0, 0, seg_len * 0.5)
		m.scale = Vector3(thick * 1.2, thick * 1.6, seg_len * 1.9)
		j.add_child(m)
		_muscles.append(m)
		# nadadeiras (membranas finas acima e abaixo do musculo)
		var fin_h := lerpf(0.09, 0.02, pow(t, 1.4)) * (1.0 if i > 0 else 0.6)
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		for sgn: float in [1.0, -1.0]:
			var h0: float = thick * 0.7 * sgn
			var h1: float = (thick * 0.7 + fin_h) * sgn
			var v := [Vector3(0, h0, 0), Vector3(0, h0, seg_len), Vector3(0, h1, seg_len), Vector3(0, h1 * 0.95, 0)]
			for idx in [0, 1, 2, 0, 2, 3]:
				st.add_vertex(v[idx])
		st.generate_normals()
		var fm := MeshInstance3D.new()
		fm.mesh = st.commit()
		fm.material_override = fin_mat
		j.add_child(fm)
		_tail.append(j)
		parent = j


func _leg(pos: Vector3, s: float, length: float) -> Node3D:
	var root := Node3D.new()
	root.position = pos
	add_child(root)
	var thigh := _mi(root, Color(0.3, 0.27, 0.16), Vector3(0.0, 0, length * 0.3), Vector3(0.025, 0.025, length * 0.6))
	var shank := _mi(root, Color(0.3, 0.27, 0.16), Vector3(0.02 * s, 0, length * 0.75), Vector3(0.02, 0.02, length * 0.5))
	thigh.rotation.y = 0.5 * s
	shank.rotation.y = -0.4 * s
	root.scale = Vector3.ZERO
	return root


## angles: dobra de cada segmento (rad, + = para a direita); act: ativacao
## dos musculos para colorir/inchar; growth/climax: patas e cauda.
func set_tail(angles: PackedFloat32Array, act_l: PackedFloat32Array, act_r: PackedFloat32Array, climax: float) -> void:
	for i in SEGS:
		_tail[i].rotation.y = -angles[i]
		var a := maxf(act_l[i], act_r[i])
		var m := _muscles[i]
		m.scale.x = m.scale.x * 0.0 + lerpf(0.07, 0.012, float(i) / SEGS) * 1.2 * (1.0 + 0.25 * a)
		_tail[i].scale = Vector3.ONE * (1.0 - climax * 0.85) if i > 0 else Vector3.ONE


func set_state(org: AmphibianOrgans, growth: float, climax: float, feeding: float, gut_fill: float) -> void:
	_heart.scale = Vector3.ONE * 0.03 * (1.0 - 0.3 * org.beat_now)
	for g in _gills:
		g.scale = Vector3(0.03, 0.05, 0.06) * (0.8 + 0.3 * absf(org.buccal)) * (1.0 - climax)
	for k in _gut.size():
		_gut[k].visible = float(k) / _gut.size() < 0.35 + 0.65 * clampf(gut_fill, 0.0, 1.0) and climax < 0.8
	for b in _beak:
		b.position.y = -0.035 + (0.012 + 0.01 * feeding) * signf(b.position.y + 0.035 + 0.0001)
	var lh := smoothstep(0.55, 0.85, growth)
	var lf := smoothstep(0.85, 1.0, growth) * 0.7 + climax * 0.3
	for l in _legs_h:
		l.scale = Vector3.ONE * lh
	for l in _legs_f:
		l.scale = Vector3.ONE * lf


func set_xray(on: bool) -> void:
	_xray = on
	skin.albedo_color.a = 0.3 if on else 1.0
	for g in _gills:
		g.visible = on


func is_xray() -> bool:
	return _xray
