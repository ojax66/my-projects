class_name FrogModel
extends Node3D
## Corpo da ra construido proceduralmente com proporcoes de Rana (SVL = 1):
## pele (com dobras dorsolaterais, ventre claro, manchas), olhos com iris e
## pupila horizontal e palpebra, timpano, narinas, saco vocal (machos),
## membros com as proporcoes reais (femur 0.45, tibiofibula 0.5, tarso 0.28,
## pe 0.45 x SVL), pes com 5 dedos e membrana, maos com 4 dedos, musculos que
## incham quando contraem, e os orgaos (coracao, pulmoes, figado, estomago,
## intestino, corpos gordurosos, cerebro e medula), visiveis no modo raio-X.
##
## Nao ha animacao pronta: o corpo so mostra o estado que a fisica/musculos
## (Frog) calculam: extensao de cada perna, ativacao dos musculos, garganta
## (bomba bucal), volume dos pulmoes, batida do coracao, estomago, lingua.

var L := 45.0                   # SVL em mm
var male := false
var hue := 0.0
var skin: StandardMaterial3D
var limb: StandardMaterial3D
var belly_mat: StandardMaterial3D
var _body: MeshInstance3D
var _head_root: Node3D
var _jaw: Node3D
var _eyes: Array[Node3D] = []
var _lids: Array[MeshInstance3D] = []
var _sac: MeshInstance3D
var _throat: MeshInstance3D
var legs := {}                  # "L"/"R" -> {hip, knee, ankle, tmt, thigh_m, calf_m}
var arms := {}
var organs := {}
var tongue: MeshInstance3D
var tongue_root: Node3D
var _xray := false
static var _sph: SphereMesh


func build(svl: float, is_male: bool, hue_shift: float, seed_i: int) -> void:
	L = svl
	male = is_male
	hue = hue_shift
	if _sph == null:
		_sph = SphereMesh.new()
		_sph.radius = 0.5
		_sph.height = 1.0
		_sph.radial_segments = 16
		_sph.rings = 8
	_materials(seed_i)
	_body = MeshInstance3D.new()
	_body.mesh = _loft_body()
	_body.material_override = skin
	add_child(_body)
	_head()
	for s in ["L", "R"]:
		_hind_leg(s)
		_fore_leg(s)
	_organs()
	_tongue()
	set_xray(false)


# ---------------------------------------------------------------- materiais
func _materials(seed_i: int) -> void:
	skin = StandardMaterial3D.new()
	skin.vertex_color_use_as_albedo = true
	var nt := NoiseTexture2D.new()
	var nz := FastNoiseLite.new()
	nz.seed = seed_i
	nz.frequency = 0.035
	nz.noise_type = FastNoiseLite.TYPE_CELLULAR
	nt.noise = nz
	nt.seamless = true
	var g := Gradient.new()
	g.set_color(0, Color(0.25, 0.2, 0.1))
	g.set_color(1, Color(1, 1, 1))
	g.add_point(0.25, Color(0.35, 0.28, 0.14))
	g.add_point(0.32, Color(1, 1, 1))
	nt.color_ramp = g
	skin.albedo_texture = nt
	skin.uv1_scale = Vector3(3, 3, 3)
	skin.roughness = 0.32
	skin.clearcoat_enabled = true
	skin.clearcoat = 0.8          # pele umida (muco)
	skin.clearcoat_roughness = 0.15
	skin.rim_enabled = true
	skin.rim = 0.2
	# membros: mesma pele, cor do dorso com faixas escuras (sem cor por vertice)
	limb = skin.duplicate() as StandardMaterial3D
	limb.vertex_color_use_as_albedo = false
	limb.albedo_color = _dorsal() * 1.15
	belly_mat = StandardMaterial3D.new()
	belly_mat.albedo_color = Color(0.93, 0.9, 0.75)
	belly_mat.roughness = 0.5


func _dorsal() -> Color:
	return Color.from_hsv(fposmod(0.27 + hue * 0.5, 1.0), 0.55, 0.45)


# ---------------------------------------------------------------- tronco e cabeca
func _profile(t: float) -> Vector3:
	# t 0 = focinho, 1 = cloaca. Retorna (meia-largura, altura dorsal, altura ventral)
	var tw := [0.0, 0.05, 0.12, 0.2, 0.3, 0.38, 0.5, 0.62, 0.75, 0.88, 1.0]
	var ww := [0.02, 0.12, 0.2, 0.26, 0.27, 0.25, 0.28, 0.3, 0.27, 0.18, 0.06]
	var hd := [0.02, 0.07, 0.11, 0.14, 0.15, 0.15, 0.17, 0.19, 0.2, 0.15, 0.05]
	var hv := [0.01, 0.04, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.11, 0.08, 0.03]
	for i in tw.size() - 1:
		if t <= tw[i + 1]:
			var k := smoothstep(tw[i], tw[i + 1], t)
			return Vector3(lerpf(ww[i], ww[i + 1], k), lerpf(hd[i], hd[i + 1], k), lerpf(hv[i], hv[i + 1], k))
	return Vector3(ww[-1], hd[-1], hv[-1])


func _loft_body() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rings := 36
	var segs := 28
	var dorsal := _dorsal()
	var cream := Color(0.95, 0.92, 0.78)
	for i in rings + 1:
		var t := float(i) / rings
		var pr := _profile(t)
		var z := (t - 0.5) * L
		for j in segs + 1:
			var a := TAU * float(j) / segs
			var ca := cos(a)
			var sa := sin(a)
			var x := signf(ca) * pow(absf(ca), 0.85) * pr.x * L
			var y := 0.0
			if sa >= 0.0:
				y = pow(sa, 0.9) * pr.y * L
				# dobras dorsolaterais (cristas de pele dos dois lados do dorso)
				var fold := exp(-pow((absf(ca) - 0.55) / 0.08, 2.0)) * 0.012 * L * smoothstep(0.25, 0.4, t) * (1.0 - smoothstep(0.8, 0.95, t))
				y += fold
			else:
				y = -pow(-sa, 1.6) * pr.z * L
			var v := Vector3(x, y + 0.13 * L, z)
			var belly := clampf(-sa * 1.4 + 0.3, 0.0, 1.0)
			var col := dorsal.lerp(cream, belly)
			if sa > 0.0 and absf(ca) > 0.35 and absf(ca) < 0.75:
				col = col.lerp(dorsal * Color(1.25, 1.2, 0.8), 0.4)   # faixa clara das dobras
			st.set_color(col)
			st.set_uv(Vector2(float(j) / segs * 2.0, t * 3.0))
			st.add_vertex(v)
	for i in rings:
		for j in segs:
			var a := i * (segs + 1) + j
			var b := a + segs + 1
			for idx in [a, b, a + 1, a + 1, b, b + 1]:
				st.add_index(idx)
	st.generate_normals()
	return st.commit()


func _mi(parent: Node3D, mat: Material, pos: Vector3, sc: Vector3, mesh: Mesh = null) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh if mesh else _sph
	mi.material_override = mat
	mi.position = pos
	mi.scale = sc
	parent.add_child(mi)
	return mi


func _head() -> void:
	_head_root = Node3D.new()
	add_child(_head_root)
	var iris := StandardMaterial3D.new()
	iris.albedo_color = Color(0.78, 0.58, 0.18)
	iris.metallic = 0.3
	iris.roughness = 0.08
	iris.clearcoat_enabled = true
	iris.clearcoat = 1.0
	var pupil := StandardMaterial3D.new()
	pupil.albedo_color = Color(0.01, 0.01, 0.01)
	pupil.roughness = 0.02
	var tymp := StandardMaterial3D.new()
	tymp.albedo_color = Color(0.4, 0.3, 0.15)
	tymp.roughness = 0.4
	var dark := StandardMaterial3D.new()
	dark.albedo_color = Color(0.08, 0.06, 0.04)
	var lid_mat := StandardMaterial3D.new()
	lid_mat.albedo_color = _dorsal() * 0.9
	lid_mat.roughness = 0.35
	for s in [-1.0, 1.0]:
		var eye := Node3D.new()
		eye.position = Vector3(0.13 * L * s, 0.29 * L, -0.3 * L)
		_head_root.add_child(eye)
		_mi(eye, iris, Vector3.ZERO, Vector3.ONE * 0.13 * L)
		# pupila horizontal (fenda eliptica), olhando para fora e para a frente
		_mi(eye, pupil, Vector3(0.045 * L * s, 0.01 * L, -0.02 * L), Vector3(0.05, 0.022, 0.07) * L)
		var lid := _mi(eye, lid_mat, Vector3(0, 0.055 * L, 0), Vector3(0.14, 0.03, 0.14) * L)
		_lids.append(lid)
		_eyes.append(eye)
		# timpano atras do olho
		var tm := _mi(_head_root, tymp, Vector3(0.23 * L * s, 0.2 * L, -0.19 * L), Vector3(0.012, 0.085, 0.085) * L)
		tm.rotation.y = 0.25 * s
		# narinas
		_mi(_head_root, dark, Vector3(0.04 * L * s, 0.2 * L, -0.46 * L), Vector3.ONE * 0.018 * L)
	# mandibula (abre para a lingua) com a garganta / assoalho da boca
	_jaw = Node3D.new()
	_jaw.position = Vector3(0, 0.1 * L, -0.12 * L)
	_head_root.add_child(_jaw)
	var lip := StandardMaterial3D.new()
	lip.albedo_color = Color(0.3, 0.25, 0.12)
	_mi(_jaw, lip, Vector3(0, 0.0, -0.2 * L), Vector3(0.44, 0.02, 0.38) * L)
	_throat = _mi(_jaw, belly_mat, Vector3(0, -0.02 * L, -0.15 * L), Vector3(0.36, 0.08, 0.3) * L)
	if male:
		var sac_mat := StandardMaterial3D.new()
		sac_mat.albedo_color = Color(0.92, 0.9, 0.8, 0.9)
		sac_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		sac_mat.roughness = 0.1
		_sac = _mi(_jaw, sac_mat, Vector3(0, -0.05 * L, -0.22 * L), Vector3(0.2, 0.1, 0.18) * L)


# ---------------------------------------------------------------- membros
func _seg(parent: Node3D, length: float, r0: float, r1: float) -> MeshInstance3D:
	# segmento cilindrico afunilado ao longo de +Z local, de 0 a length
	var cyl := CylinderMesh.new()
	cyl.top_radius = r1
	cyl.bottom_radius = r0
	cyl.height = length
	cyl.radial_segments = 10
	var mi := MeshInstance3D.new()
	mi.mesh = cyl
	mi.material_override = limb
	mi.rotation.x = PI * 0.5
	mi.position.z = length * 0.5
	parent.add_child(mi)
	return mi


func _hind_leg(s: String) -> void:
	var sg := -1.0 if s == "L" else 1.0
	var hip := Node3D.new()
	hip.position = Vector3(0.1 * L * sg, 0.12 * L, 0.4 * L)
	add_child(hip)
	_seg(hip, 0.45 * L, 0.09 * L, 0.055 * L)
	# musculos da coxa (semimembranoso, cruralis): incham ao contrair
	var thigh_m := _mi(hip, limb, Vector3(0, 0, 0.2 * L), Vector3(0.2, 0.17, 0.42) * L)
	var knee := Node3D.new()
	knee.position.z = 0.45 * L
	hip.add_child(knee)
	_seg(knee, 0.5 * L, 0.05 * L, 0.03 * L)
	var calf_m := _mi(knee, limb, Vector3(0, 0, 0.16 * L), Vector3(0.12, 0.11, 0.32) * L)   # gastrocnemio
	var ankle := Node3D.new()
	ankle.position.z = 0.5 * L
	knee.add_child(ankle)
	_seg(ankle, 0.28 * L, 0.03 * L, 0.022 * L)
	var tmt := Node3D.new()
	tmt.position.z = 0.28 * L
	ankle.add_child(tmt)
	# pe: 5 dedos com membrana (o 4o e o mais longo)
	var toe_len := [0.2, 0.26, 0.34, 0.45, 0.32]
	var web := SurfaceTool.new()
	web.begin(Mesh.PRIMITIVE_TRIANGLES)
	var tips: Array[Vector3] = []
	for k in 5:
		var a := (float(k) - 2.0) * 0.22 * sg
		var toe := Node3D.new()
		toe.rotation.y = a
		tmt.add_child(toe)
		_seg(toe, toe_len[k] * L, 0.012 * L, 0.006 * L)
		_mi(toe, limb, Vector3(0, 0, toe_len[k] * L), Vector3.ONE * 0.016 * L)
		tips.append(Vector3(sin(a), 0, cos(a)) * toe_len[k] * L * 0.8)
	for k in 4:
		web.add_vertex(Vector3.ZERO)
		web.add_vertex(tips[k])
		web.add_vertex(tips[k + 1])
	web.generate_normals()
	var wmi := MeshInstance3D.new()
	wmi.mesh = web.commit()
	var wm := StandardMaterial3D.new()
	wm.albedo_color = _dorsal().lerp(Color(0.8, 0.75, 0.5), 0.4)
	wm.albedo_color.a = 0.75
	wm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	wm.cull_mode = BaseMaterial3D.CULL_DISABLED
	wmi.material_override = wm
	tmt.add_child(wmi)
	legs[s] = {"hip": hip, "knee": knee, "ankle": ankle, "tmt": tmt, "thigh_m": thigh_m, "calf_m": calf_m}


func _fore_leg(s: String) -> void:
	var sg := -1.0 if s == "L" else 1.0
	var sh := Node3D.new()
	sh.position = Vector3(0.14 * L * sg, 0.1 * L, -0.12 * L)
	add_child(sh)
	_seg(sh, 0.18 * L, 0.04 * L, 0.03 * L)
	var el := Node3D.new()
	el.position.z = 0.18 * L
	sh.add_child(el)
	_seg(el, 0.16 * L, 0.028 * L, 0.02 * L)
	var hand := Node3D.new()
	hand.position.z = 0.16 * L
	el.add_child(hand)
	for k in 4:
		var f := Node3D.new()
		f.rotation.y = (float(k) - 1.5) * 0.35
		hand.add_child(f)
		_seg(f, 0.1 * L, 0.01 * L, 0.006 * L)
		_mi(f, limb, Vector3(0, 0, 0.1 * L), Vector3.ONE * 0.014 * L)
	arms[s] = {"shoulder": sh, "elbow": el, "hand": hand}


# ---------------------------------------------------------------- orgaos
func _organ(name_: String, col: Color, pos: Vector3, sc: Vector3) -> MeshInstance3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.roughness = 0.25
	m.clearcoat_enabled = true
	m.clearcoat = 0.6
	var mi := _mi(self, m, pos * L, sc * L)
	mi.set_meta("base", sc * L)
	organs[name_] = mi
	return mi


func _organs() -> void:
	_organ("coracao", Color(0.75, 0.08, 0.1), Vector3(0, 0.08, -0.13), Vector3(0.07, 0.07, 0.08))
	_organ("pulmao_L", Color(0.95, 0.6, 0.62), Vector3(-0.09, 0.17, 0.02), Vector3(0.1, 0.09, 0.22))
	_organ("pulmao_R", Color(0.95, 0.6, 0.62), Vector3(0.09, 0.17, 0.02), Vector3(0.1, 0.09, 0.22))
	_organ("figado", Color(0.45, 0.1, 0.08), Vector3(0.02, 0.07, -0.03), Vector3(0.22, 0.06, 0.14))
	_organ("estomago", Color(0.9, 0.82, 0.62), Vector3(-0.08, 0.08, 0.08), Vector3(0.08, 0.07, 0.2))
	_organ("intestino", Color(0.85, 0.72, 0.55), Vector3(0.03, 0.07, 0.22), Vector3(0.16, 0.06, 0.14))
	_organ("gordura_L", Color(1.0, 0.85, 0.2), Vector3(-0.08, 0.1, 0.3), Vector3(0.05, 0.04, 0.1))
	_organ("gordura_R", Color(1.0, 0.85, 0.2), Vector3(0.08, 0.1, 0.3), Vector3(0.05, 0.04, 0.1))
	_organ("cerebro", Color(0.95, 0.75, 0.75), Vector3(0, 0.24, -0.26), Vector3(0.07, 0.05, 0.16))
	_organ("medula", Color(0.95, 0.85, 0.85), Vector3(0, 0.25, 0.12), Vector3(0.025, 0.025, 0.55))
	_organ("rins", Color(0.55, 0.15, 0.12), Vector3(0, 0.15, 0.3), Vector3(0.12, 0.03, 0.1))


func _tongue() -> void:
	tongue_root = Node3D.new()
	tongue_root.position = Vector3(0, 0.09 * L, -0.46 * L)
	add_child(tongue_root)
	tongue = MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.5
	cyl.bottom_radius = 0.5
	cyl.height = 1.0
	cyl.radial_segments = 8
	tongue.mesh = cyl
	var tm := StandardMaterial3D.new()
	tm.albedo_color = Color(0.92, 0.48, 0.52)
	tm.roughness = 0.1
	tm.clearcoat_enabled = true
	tm.clearcoat = 1.0
	tongue.material_override = tm
	tongue.visible = false
	add_child(tongue)


# ---------------------------------------------------------------- estado vindo da fisica
## ext 0 = perna dobrada (sentada), 1 = esticada para tras (empurrao).
## act = ativacao dos extensores (incha os musculos).
func set_leg(s: String, ext: float, act: float) -> void:
	var sg := -1.0 if s == "L" else 1.0
	var d: Dictionary = legs[s]
	var e := clampf(ext, 0.0, 1.0)
	# sentada: coxa para frente e para fora, canela para tras, tarso para frente
	(d["hip"] as Node3D).rotation = Vector3(lerpf(0.25, 0.2, e), lerpf(-2.65, -0.2, e) * -sg, 0.0)
	(d["knee"] as Node3D).rotation = Vector3(lerpf(0.05, -0.05, e), lerpf(-2.85, -0.1, e) * sg, 0.0)
	(d["ankle"] as Node3D).rotation = Vector3(lerpf(0.1, 0.3, e), lerpf(2.75, 0.2, e) * sg, 0.0)
	(d["tmt"] as Node3D).rotation = Vector3(lerpf(0.05, 0.4, e), lerpf(-0.9, 0.0, e) * sg, 0.0)
	var bulge := 1.0 + 0.3 * clampf(act, 0.0, 1.2)
	(d["thigh_m"] as MeshInstance3D).scale = Vector3(0.2 * bulge, 0.17 * bulge, 0.42 / sqrt(bulge)) * L
	(d["calf_m"] as MeshInstance3D).scale = Vector3(0.12 * bulge, 0.11 * bulge, 0.32 / sqrt(bulge)) * L


func set_arm(s: String, lift: float) -> void:
	var sg := -1.0 if s == "L" else 1.0
	var d: Dictionary = arms[s]
	(d["shoulder"] as Node3D).rotation = Vector3(lerpf(2.0, 0.4, lift), 0.35 * sg, 0.0)
	(d["elbow"] as Node3D).rotation = Vector3(lerpf(-0.7, -0.2, lift), 0.0, 0.0)
	(d["hand"] as Node3D).rotation = Vector3(lerpf(0.2, 0.0, lift), 0.0, 0.0)


## org: AmphibianOrgans; call: 0..1 saco vocal; swallow: olhos afundando;
## blink 0..1; jaw 0..1 boca abrindo; energy para os corpos gordurosos.
func set_state(org: AmphibianOrgans, call: float, swallow: float, blink: float, jaw: float, energy: float) -> void:
	var beat := org.beat_now
	(organs["coracao"] as MeshInstance3D).scale = (organs["coracao"].get_meta("base") as Vector3) * (1.0 - 0.28 * beat)
	for s in ["L", "R"]:
		var lm: MeshInstance3D = organs["pulmao_" + s]
		lm.scale = (lm.get_meta("base") as Vector3) * (0.45 + 0.75 * org.lung)
		var fm: MeshInstance3D = organs["gordura_" + s]
		fm.scale = (fm.get_meta("base") as Vector3) * (0.3 + 1.0 * energy)
	var st: MeshInstance3D = organs["estomago"]
	st.scale = (st.get_meta("base") as Vector3) * (0.6 + 2.5 * minf(org.stomach, 0.4))
	var it: MeshInstance3D = organs["intestino"]
	it.scale = (it.get_meta("base") as Vector3) * (0.8 + 2.0 * minf(org.intestine, 0.3))
	# bomba bucal: o assoalho da boca (garganta) sobe e desce
	_throat.scale = Vector3(0.36, 0.08 * (1.0 + 0.5 * maxf(-org.buccal, 0.0) + 0.25 * org.buccal), 0.3) * L
	if _sac:
		_sac.scale = Vector3(0.2, 0.1, 0.18) * L * (1.0 + 2.2 * call)
		_sac.visible = call > 0.05
	for i in _eyes.size():
		_eyes[i].position.y = lerpf(0.29, 0.2, swallow) * L
		# palpebra: uma "sobrancelha" de pele em cima; ao piscar desce sobre o olho
		_lids[i].scale = Vector3(0.14, lerpf(0.03, 0.135, blink), 0.14) * L
		_lids[i].position.y = lerpf(0.055, 0.0, blink) * L
	_jaw.rotation.x = -0.5 * jaw


func set_xray(on: bool) -> void:
	_xray = on
	var a := 0.22 if on else 1.0
	for m: StandardMaterial3D in [skin, limb, belly_mat]:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA if on else BaseMaterial3D.TRANSPARENCY_DISABLED
		m.albedo_color.a = a
		m.no_depth_test = false
	for k in organs:
		(organs[k] as MeshInstance3D).visible = on


func is_xray() -> bool:
	return _xray


## Lingua do ponto da mandibula ate `tip` (global); k = 0..1 do caminho.
func show_tongue(tip: Vector3, k: float) -> void:
	var root := tongue_root.global_position
	var seg := (tip - root) * k
	tongue.visible = seg.length() > 0.3
	if not tongue.visible:
		return
	var y := seg.normalized()
	var x := y.cross(Vector3.UP if absf(y.y) < 0.95 else Vector3.RIGHT).normalized()
	var z := x.cross(y)
	var w := L * 0.05 * lerpf(1.3, 0.8, k)
	tongue.global_transform = Transform3D(Basis(x * w, y * seg.length(), z * w), root + seg * 0.5)


func hide_tongue() -> void:
	tongue.visible = false


func eye_positions() -> Array:
	return [_eyes[0].global_position, _eyes[1].global_position]
