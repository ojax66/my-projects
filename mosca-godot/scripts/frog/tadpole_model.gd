class_name TadpoleModel
extends Node3D
## Girino (comprimento total = 1, depois escalado): UMA malha continua de
## corpo + cauda com esqueleto (tronco e 10 vertebras da cauda) e pesos por
## vertice, entao a cauda dobra lisa como a de verdade. A pele (shader) tem
## dorso escuro pintado, pontinhos dourados, barriga translucida, miomeros
## em V na musculatura e nadadeiras finas quase transparentes.
## Por dentro: o intestino longo enrolado em espiral dupla (da para ver pela
## barriga, como nos girinos reais), coracao batendo, branquias internas
## (raio-X), cerebro e notocorda. Na cabeca: olhos dorsolaterais, disco oral
## com o bico corneo e as fileiras de denticulos, narinas e o espiraculo
## (saida da agua das branquias, lado esquerdo). As patas aparecem com o
## crescimento e a cauda e reabsorvida na metamorfose.

const SEGS := 10
const BODY_FRAC := 0.36
var skin: ShaderMaterial
var _skel: Skeleton3D
var _mesh: MeshInstance3D
var _tail_bones: Array[int] = []
var _gut: MeshInstance3D
var _heart: MeshInstance3D
var _gills: Array[MeshInstance3D] = []
var _beak: Array[MeshInstance3D] = []
var _legs_h: Array[Node3D] = []
var _legs_f: Array[Node3D] = []
var _xray_nodes: Array[Node3D] = []
var _xray := false
static var _mesh_cache: ArrayMesh
static var _sph: SphereMesh


func build(_seed_i: int) -> void:
	if _sph == null:
		_sph = SphereMesh.new()
		_sph.radius = 0.5
		_sph.height = 1.0
		_sph.radial_segments = 12
		_sph.rings = 6
	_skeleton()
	if _mesh_cache == null:
		_mesh_cache = _build_mesh()
	skin = ShaderMaterial.new()
	skin.shader = load("res://shaders/tadpole.gdshader")
	skin.set_shader_parameter("body_frac", BODY_FRAC)
	_mesh = MeshInstance3D.new()
	_mesh.mesh = _mesh_cache
	_mesh.material_override = skin
	_skel.add_child(_mesh)
	_mesh.skin = _skel.create_skin_from_rest_transforms()
	_mesh.skeleton = _mesh.get_path_to(_skel)
	_head_parts()
	_inside()
	for s in [-1.0, 1.0]:
		_legs_h.append(_leg(Vector3(0.055 * s, -0.035, -0.16), s, 0.2, true))
		_legs_f.append(_leg(Vector3(0.075 * s, -0.045, -0.36), s, 0.11, false))
	set_xray(false)


func _skeleton() -> void:
	_skel = Skeleton3D.new()
	add_child(_skel)
	var body := _skel.add_bone("tronco")
	_skel.set_bone_rest(body, Transform3D(Basis(), Vector3(0, 0, -0.3)))
	var parent := body
	var seg := (1.0 - BODY_FRAC) / SEGS
	for i in SEGS:
		var b := _skel.add_bone("cauda_%d" % i)
		_skel.set_bone_parent(b, parent)
		var off := Vector3(0, 0, (-0.5 + BODY_FRAC) - (-0.3)) if i == 0 else Vector3(0, 0, seg)
		_skel.set_bone_rest(b, Transform3D(Basis(), off))
		_tail_bones.append(b)
		parent = b
	_skel.reset_bone_poses()


## Perfil: meia-largura do musculo/corpo, meia-altura do corpo, altura das
## nadadeiras (em cima e embaixo), deslocamento vertical.
func _profile(t: float) -> Array:
	if t < BODY_FRAC:
		var k := t / BODY_FRAC
		var w := 0.13 * pow(sin(PI * clampf(k * 0.9 + 0.06, 0.0, 1.0)), 0.6)
		var h := 0.105 * pow(sin(PI * clampf(k * 0.92 + 0.05, 0.0, 1.0)), 0.75)
		var fin_top := 0.03 * smoothstep(0.75, 1.0, k)   # a nadadeira dorsal nasce no fim do corpo
		return [w, h, fin_top, 0.0, 0.0]
	var q := (t - BODY_FRAC) / (1.0 - BODY_FRAC)
	var wm := lerpf(0.055, 0.004, pow(q, 0.8))
	var hm := lerpf(0.06, 0.006, pow(q, 0.9))
	var top := lerpf(0.05, 0.075, smoothstep(0.0, 0.3, q)) * (1.0 - smoothstep(0.7, 1.0, q)) + 0.005
	var bot := lerpf(0.035, 0.055, smoothstep(0.0, 0.3, q)) * (1.0 - smoothstep(0.7, 1.0, q)) + 0.004
	return [wm, hm, top, bot, 0.0]


func _build_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rings := 72
	var segs := 32
	var seg_len := (1.0 - BODY_FRAC) / SEGS
	for i in rings + 1:
		var t := float(i) / rings
		var z := -0.5 + t
		var pr := _profile(t)
		var w: float = pr[0]
		var h: float = pr[1]
		var top: float = pr[2]
		var bot: float = pr[3]
		# pesos: corpo no tronco; cauda entre as duas vertebras mais proximas
		var bones := PackedInt32Array([0, 0, 0, 0])
		var wts := PackedFloat32Array([1, 0, 0, 0])
		if z > -0.5 + BODY_FRAC - 0.04:
			var f := (z - (-0.5 + BODY_FRAC)) / seg_len
			var i0 := clampi(int(floor(f)), -1, SEGS - 1)
			var fr := clampf(f - float(i0), 0.0, 1.0)
			var b0 := 0 if i0 < 0 else 1 + i0
			var b1 := 1 + mini(i0 + 1, SEGS - 1)
			bones = PackedInt32Array([b0, b1, 0, 0])
			wts = PackedFloat32Array([1.0 - fr, fr, 0, 0])
		for j in segs + 1:
			var a := TAU * float(j) / segs
			var ca := cos(a)
			var sa := sin(a)
			var y := sa * h
			var x := ca * w
			var is_fin := 0.0
			# nadadeiras: a secao se estica em cima/embaixo numa lamina fina
			if sa > 0.0 and top > 0.0:
				var k := pow(sa, 6.0)
				y += k * top
				x *= 1.0 - 0.85 * k
				is_fin = 1.0 if k >= 0.5 else 0.0
			elif sa < 0.0 and bot > 0.0:
				var k := pow(-sa, 6.0)
				y -= k * bot
				x *= 1.0 - 0.85 * k
				is_fin = 1.0 if k >= 0.5 else 0.0
			if t < BODY_FRAC:
				y *= 1.0 if sa > 0.0 else 0.85   # ventre mais achatado
			var belly := clampf(-sa * 1.4, 0.0, 1.0) * (1.0 if t < BODY_FRAC else 0.3)
			var alpha := lerpf(0.97, 0.5, belly)
			if is_fin > 0.5:
				alpha = 0.45
			st.set_color(Color(is_fin, 0, 0, alpha))
			st.set_uv(Vector2(t, clampf(y / maxf(h + maxf(top, bot), 1e-4), -1.0, 1.0)))
			st.set_bones(bones)
			st.set_weights(wts)
			st.add_vertex(Vector3(x, y, z))
	for i in rings:
		for j in segs:
			var p0 := i * (segs + 1) + j
			var p1 := p0 + segs + 1
			for k in [p0, p1, p0 + 1, p0 + 1, p1, p1 + 1]:
				st.add_index(k)
	st.generate_normals()
	return st.commit()


func _mi(parent: Node3D, col: Color, pos: Vector3, sc: Vector3, alpha := 1.0, xray_only := false) -> MeshInstance3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(col.r, col.g, col.b, alpha)
	if alpha < 1.0:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.roughness = 0.2
	m.clearcoat_enabled = true
	m.clearcoat = 0.7
	var mi := MeshInstance3D.new()
	mi.mesh = _sph
	mi.material_override = m
	mi.position = pos
	mi.scale = sc
	parent.add_child(mi)
	if xray_only:
		_xray_nodes.append(mi)
	return mi


func _body_attach() -> Node3D:
	var ba := BoneAttachment3D.new()
	ba.bone_name = "tronco"
	_skel.add_child(ba)
	var h := Node3D.new()
	h.position = Vector3(0, 0, 0.3)       # volta para a origem do modelo
	ba.add_child(h)
	return h


func _head_parts() -> void:
	var hb := _body_attach()
	for s in [-1.0, 1.0]:
		var eye := _mi(hb, Color(0.03, 0.03, 0.02), Vector3(0.072 * s, 0.05, -0.43), Vector3.ONE * 0.042)
		(eye.material_override as StandardMaterial3D).roughness = 0.02
		_mi(hb, Color(0.8, 0.65, 0.3), Vector3(0.07 * s, 0.05, -0.43), Vector3.ONE * 0.048, 0.6)
		_mi(hb, Color(0.05, 0.04, 0.03), Vector3(0.025 * s, 0.045, -0.485), Vector3.ONE * 0.01)   # narinas
		# bico corneo (queratina) e fileiras de denticulos no disco oral
		_beak.append(_mi(hb, Color(0.04, 0.03, 0.02), Vector3(0.0, -0.038 + 0.01 * s, -0.49), Vector3(0.045, 0.01, 0.014)))
	_mi(hb, Color(0.62, 0.55, 0.42), Vector3(0, -0.04, -0.485), Vector3(0.085, 0.03, 0.035), 0.9)
	for k in 3:
		_mi(hb, Color(0.12, 0.1, 0.07), Vector3(0, -0.04 - 0.012 * (k - 1), -0.495), Vector3(0.07 - 0.01 * absf(k - 1), 0.004, 0.01))
	var sp := _mi(hb, Color(0.3, 0.26, 0.17), Vector3(-0.11, -0.02, -0.28), Vector3(0.018, 0.018, 0.045))   # espiraculo
	sp.rotation.y = 0.7


func _inside() -> void:
	var hb := _body_attach()
	# intestino: tubo longo enrolado em espiral dupla (visivel pela barriga)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var pts := PackedVector3Array()
	for k in 90:
		var tt := float(k) / 89.0
		var a := tt * TAU * 3.2
		var r := 0.058 * (1.0 - tt * 0.85) if tt < 0.5 else 0.058 * (0.15 + (tt - 0.5) * 1.7)
		var side := 1.0 if tt < 0.5 else -1.0
		pts.append(Vector3(cos(a * side) * r, -0.05 + 0.004 * sin(a * 2.0), -0.3 + sin(a * side) * r * 1.05))
	var sides := 7
	for i in pts.size():
		var tg := (pts[mini(i + 1, pts.size() - 1)] - pts[maxi(i - 1, 0)]).normalized()
		var ax := tg.cross(Vector3.UP).normalized()
		var bx := tg.cross(ax)
		for j in sides + 1:
			var ang := TAU * j / sides
			var dv := ax * cos(ang) + bx * sin(ang)
			st.set_normal(dv)
			st.add_vertex(pts[i] + dv * 0.009)
	for i in pts.size() - 1:
		for j in sides:
			var p0 := i * (sides + 1) + j
			var p1 := p0 + sides + 1
			for k in [p0, p1, p0 + 1, p0 + 1, p1, p1 + 1]:
				st.add_index(k)
	_gut = MeshInstance3D.new()
	_gut.mesh = st.commit()
	var gm := StandardMaterial3D.new()
	gm.albedo_color = Color(0.3, 0.36, 0.14)     # cheio de algas
	gm.roughness = 0.3
	_gut.material_override = gm
	hb.add_child(_gut)
	_heart = _mi(hb, Color(0.75, 0.05, 0.08), Vector3(0, -0.055, -0.4), Vector3.ONE * 0.028)
	for s in [-1.0, 1.0]:
		for k in 4:
			_gills.append(_mi(hb, Color(0.85, 0.2, 0.25), Vector3(0.06 * s, -0.02 - 0.006 * k, -0.37 + 0.012 * k), Vector3(0.012, 0.03, 0.01), 1.0, true))
	_mi(hb, Color(0.95, 0.82, 0.8), Vector3(0, 0.055, -0.44), Vector3(0.035, 0.025, 0.06), 1.0, true)   # cerebro
	# notocorda ao longo do corpo (a da cauda vai com os ossos)
	for i in SEGS:
		var ba := BoneAttachment3D.new()
		ba.bone_name = "cauda_%d" % i
		_skel.add_child(ba)
		var nc := _mi(ba, Color(0.9, 0.9, 0.8), Vector3(0, 0, (1.0 - BODY_FRAC) / SEGS * 0.5), Vector3(0.01, 0.01, (1.0 - BODY_FRAC) / SEGS * 1.1), 0.7, true)
		nc.scale *= Vector3(1.0 - float(i) / SEGS * 0.6, 1.0 - float(i) / SEGS * 0.6, 1.0)


func _leg(pos: Vector3, s: float, length: float, hind: bool) -> Node3D:
	var hb := _body_attach()
	var root := Node3D.new()
	root.position = pos
	hb.add_child(root)
	var col := Color(0.24, 0.21, 0.13)
	var thigh := _mi(root, col, Vector3(0.02 * s, 0, length * 0.25), Vector3(0.022, 0.022, length * 0.5))
	var shank := _mi(root, col, Vector3(0.035 * s, -0.005, length * 0.62), Vector3(0.017, 0.017, length * 0.42))
	var foot := _mi(root, col, Vector3(0.03 * s, -0.008, length * 0.92), Vector3(0.025 if hind else 0.015, 0.006, length * 0.3))
	thigh.rotation.y = 0.35 * s
	shank.rotation.y = -0.2 * s
	foot.rotation.y = 0.1 * s
	root.scale = Vector3.ZERO
	return root


## angles: dobra de cada vertebra (+ = para a direita); climax: cauda sumindo.
func set_tail(angles: PackedFloat32Array, _act_l: PackedFloat32Array, _act_r: PackedFloat32Array, climax: float) -> void:
	for i in SEGS:
		_skel.set_bone_pose_rotation(_tail_bones[i], Quaternion(Vector3.UP, -angles[i]))
		var sc := 1.0 - climax * 0.12 if i > 0 else 1.0 - climax * 0.3
		_skel.set_bone_pose_scale(_tail_bones[i], Vector3.ONE * sc)


func set_state(org: AmphibianOrgans, growth: float, climax: float, feeding: float, gut_fill: float) -> void:
	_heart.scale = Vector3.ONE * 0.028 * (1.0 - 0.3 * org.beat_now)
	for g in _gills:
		g.scale = Vector3(0.012, 0.03, 0.01) * (0.8 + 0.4 * absf(org.buccal)) * (1.0 - climax)
	_gut.scale = Vector3.ONE * (0.75 + 0.35 * clampf(gut_fill, 0.0, 1.0)) * (1.0 - 0.6 * climax)
	for b in _beak:
		b.scale = Vector3(0.045, 0.01 + 0.006 * feeding, 0.014)
	var lh := smoothstep(0.55, 0.85, growth)
	var lf := smoothstep(0.85, 1.0, growth) * 0.7 + climax * 0.3
	for l in _legs_h:
		l.scale = Vector3.ONE * lh
	for l in _legs_f:
		l.scale = Vector3.ONE * lf


func set_xray(on: bool) -> void:
	_xray = on
	skin.set_shader_parameter("xray", 1.0 if on else 0.0)
	for n in _xray_nodes:
		n.visible = on


func is_xray() -> bool:
	return _xray
