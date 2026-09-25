class_name FrogModel
extends Node3D
## Corpo da ra: a malha e a textura do sapo-banjo (Limnodynastes) trazidos
## pelo usuario (tools/import_frog_model.py -> frog/frog_skin.*), com
## esqueleto de verdade (quadril, femur, tibia, tarso, pe, ombro, umero,
## radio-ulna, mao, garganta, olhos) e pesos por vertice (skinning).
##
## Dentro, os orgaos com forma anatomica: coracao com 2 atrios + ventriculo
## + tronco arterial, pulmoes em saco com alveolos, figado de 3 lobos com a
## vesicula biliar, estomago em J, intestino delgado enrolado e reto,
## rins, corpos gordurosos em dedos, bexiga, cerebro (bulbos olfatorios,
## hemisferios, lobos opticos, cerebelo) e medula; o esqueleto (cranio,
## vertebras, urostilo, ilio, ossos dos membros) e os musculos das pernas
## (seguem os ossos). Tudo visivel no modo raio-X.
##
## Nao ha animacao: Frog calcula extensao das pernas, ativacao dos musculos,
## garganta, pulmoes, coracao e lingua; aqui so se mostra esse estado.

const SKIN := "res://frog/frog_skin.bin"
const META := "res://frog/frog_skin.json"
const TEX := "res://frog/banjofrog_diffuse.jpg"

var L := 45.0
var male := false
var hue := 0.0
var skin_mat: StandardMaterial3D
var tongue: MeshInstance3D
var tongue_root: Node3D
var organs := {}
var _scale_root: Node3D
var _skel: Skeleton3D
var _body: MeshInstance3D
var _bone := {}              # nome -> indice
var _rest := {}              # nome -> [cabeca, ponta] (espaco do modelo)
var _parent := {}
var _xray := false
var _xray_nodes: Array[Node3D] = []
var _muscles := {}           # "femur_L" -> MeshInstance3D
var _eyes_rest := {}
var _sac: MeshInstance3D
static var _mesh_cache: ArrayMesh
static var _meta_cache: Dictionary
static var _sph: SphereMesh


func build(svl: float, is_male: bool, hue_shift: float, _seed_i: int) -> void:
	L = svl
	male = is_male
	hue = hue_shift
	if _sph == null:
		_sph = SphereMesh.new()
		_sph.radius = 0.5
		_sph.height = 1.0
		_sph.radial_segments = 16
		_sph.rings = 8
	_scale_root = Node3D.new()
	_scale_root.scale = Vector3.ONE * L
	add_child(_scale_root)
	_load()
	_skeleton()
	_skin_mesh()
	_organs()
	_skeleton_bones()
	_leg_muscles()
	_tongue()
	set_xray(false)


# ---------------------------------------------------------------- malha + esqueleto
func _load() -> void:
	if _mesh_cache:
		return
	_meta_cache = JSON.parse_string(FileAccess.get_file_as_string(META))
	var f := FileAccess.open(SKIN, FileAccess.READ)
	f.get_buffer(4)
	var nv := f.get_32()
	var ni := f.get_32()
	var pos := f.get_buffer(nv * 12).to_float32_array()
	var nrm := f.get_buffer(nv * 12).to_float32_array()
	var uv := f.get_buffer(nv * 8).to_float32_array()
	var idx := f.get_buffer(ni * 4).to_int32_array()
	var bones := f.get_buffer(nv * 16).to_int32_array()
	var weights := f.get_buffer(nv * 16).to_float32_array()
	var pv := PackedVector3Array()
	var nvv := PackedVector3Array()
	var uvv := PackedVector2Array()
	pv.resize(nv)
	nvv.resize(nv)
	uvv.resize(nv)
	for i in nv:
		pv[i] = Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
		nvv[i] = Vector3(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2])
		uvv[i] = Vector2(uv[i * 2], uv[i * 2 + 1])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = pv
	arr[Mesh.ARRAY_NORMAL] = nvv
	arr[Mesh.ARRAY_TEX_UV] = uvv
	arr[Mesh.ARRAY_INDEX] = idx
	arr[Mesh.ARRAY_BONES] = bones
	arr[Mesh.ARRAY_WEIGHTS] = weights
	_mesh_cache = ArrayMesh.new()
	_mesh_cache.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)


func _skeleton() -> void:
	_skel = Skeleton3D.new()
	_scale_root.add_child(_skel)
	for b: Dictionary in _meta_cache["ossos"]:
		var n: String = b["nome"]
		var i := _skel.add_bone(n)
		_bone[n] = i
		var h: Array = b["cabeca"]
		var t: Array = b["ponta"]
		_rest[n] = [Vector3(h[0], h[1], h[2]), Vector3(t[0], t[1], t[2])]
		_parent[n] = b["pai"]
	for b: Dictionary in _meta_cache["ossos"]:
		var n: String = b["nome"]
		var p = b["pai"]
		var head: Vector3 = _rest[n][0]
		if p != null:
			_skel.set_bone_parent(_bone[n], _bone[p])
			_skel.set_bone_rest(_bone[n], Transform3D(Basis(), head - (_rest[p][0] as Vector3)))
		else:
			_skel.set_bone_rest(_bone[n], Transform3D(Basis(), head))
	_skel.reset_bone_poses()
	for s in ["L", "R"]:
		_eyes_rest[s] = (_rest["olho_" + s][0] as Vector3) - (_rest["cabeca"][0] as Vector3)


func _skin_mesh() -> void:
	skin_mat = StandardMaterial3D.new()
	skin_mat.albedo_texture = load(TEX)
	# cada individuo tem um tom um pouco diferente (gene da cor)
	skin_mat.albedo_color = Color.from_hsv(fposmod(0.1 + hue, 1.0), 0.12, 1.0)
	skin_mat.roughness = 0.38
	skin_mat.clearcoat_enabled = true
	skin_mat.clearcoat = 0.7          # pele umida (muco)
	skin_mat.clearcoat_roughness = 0.2
	skin_mat.rim_enabled = true
	skin_mat.rim = 0.15
	skin_mat.subsurf_scatter_enabled = true
	skin_mat.subsurf_scatter_strength = 0.15
	_body = MeshInstance3D.new()
	_body.mesh = _mesh_cache
	_body.material_override = skin_mat
	_skel.add_child(_body)
	_body.skin = _skel.create_skin_from_rest_transforms()
	_body.skeleton = _body.get_path_to(_skel)


# ---------------------------------------------------------------- geometria de orgaos
func _mat(col: Color, rough := 0.25, alpha := 1.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(col.r, col.g, col.b, alpha)
	if alpha < 1.0:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.roughness = rough
	m.clearcoat_enabled = true
	m.clearcoat = 0.8
	m.clearcoat_roughness = 0.15
	return m


## Tubo liso por uma curva (intestino, estomago, medula, arterias).
func _tube(pts: PackedVector3Array, radii: PackedFloat32Array, sides := 10) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var n := pts.size()
	for i in n:
		var t := (pts[mini(i + 1, n - 1)] - pts[maxi(i - 1, 0)]).normalized()
		var a := t.cross(Vector3.UP if absf(t.y) < 0.9 else Vector3.RIGHT).normalized()
		var b := t.cross(a)
		for j in sides + 1:
			var ang := TAU * j / sides
			var dir := a * cos(ang) + b * sin(ang)
			st.set_normal(dir)
			st.add_vertex(pts[i] + dir * radii[i])
	for i in n - 1:
		for j in sides:
			var p0 := i * (sides + 1) + j
			var p1 := p0 + sides + 1
			for k in [p0, p1, p0 + 1, p0 + 1, p1, p1 + 1]:
				st.add_index(k)
	return st.commit()


## Esfera deformada (lobos, sacos): bumps = alveolos/rugosidade.
func _blob(radii: Vector3, bumps := 0.0, freq := 9.0, taper := 0.0) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rings := 14
	var segs := 20
	for i in rings + 1:
		var v := float(i) / rings
		var th := v * PI
		for j in segs + 1:
			var ph := TAU * j / segs
			var p := Vector3(sin(th) * cos(ph), cos(th), sin(th) * sin(ph))
			var r := 1.0 + bumps * sin(p.x * freq) * sin(p.y * freq * 1.3) * sin(p.z * freq * 0.9)
			r *= 1.0 - taper * (p.z * 0.5 + 0.5)
			st.add_vertex(p * radii * r)
	for i in rings:
		for j in segs:
			var a := i * (segs + 1) + j
			var b := a + segs + 1
			for k in [a, b, a + 1, a + 1, b, b + 1]:
				st.add_index(k)
	st.generate_normals()
	return st.commit()


func _put(parent: Node3D, mesh: Mesh, mat: Material, pos: Vector3, rot := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	mi.rotation = rot
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	_xray_nodes.append(mi)
	return mi


func _attach(bone: String) -> Node3D:
	var ba := BoneAttachment3D.new()
	ba.bone_name = bone
	_skel.add_child(ba)
	var holder := Node3D.new()
	ba.add_child(holder)
	return holder


func _organs() -> void:
	var trunk := _attach("corpo")
	var chest := _attach("peito")
	var head := _attach("cabeca")
	var o_c: Vector3 = _rest["corpo"][0]
	var o_p: Vector3 = _rest["peito"][0]
	var o_h: Vector3 = _rest["cabeca"][0]
	# coracao (3 camaras): dois atrios em cima, ventriculo conico, tronco arterial
	var heart := Node3D.new()
	heart.position = Vector3(0, 0.1, -0.2) - o_p
	chest.add_child(heart)
	organs["coracao"] = heart
	_put(heart, _blob(Vector3(0.045, 0.05, 0.05), 0.02, 6.0, 0.35), _mat(Color(0.62, 0.05, 0.06), 0.2), Vector3(0, -0.02, 0.01), Vector3(-0.5, 0, 0))
	_put(heart, _blob(Vector3(0.028, 0.025, 0.03), 0.03), _mat(Color(0.45, 0.04, 0.12), 0.25), Vector3(-0.025, 0.028, 0.0))
	_put(heart, _blob(Vector3(0.026, 0.024, 0.028), 0.03), _mat(Color(0.4, 0.05, 0.2), 0.25), Vector3(0.025, 0.028, 0.0))
	_put(heart, _tube(PackedVector3Array([Vector3(0, 0.0, -0.02), Vector3(0, 0.03, -0.05), Vector3(0.02, 0.05, -0.06), Vector3(0.05, 0.06, -0.05)]),
		PackedFloat32Array([0.012, 0.011, 0.009, 0.008])), _mat(Color(0.8, 0.35, 0.4)), Vector3.ZERO)
	_put(heart, _tube(PackedVector3Array([Vector3(0, 0.03, -0.05), Vector3(-0.02, 0.05, -0.06), Vector3(-0.05, 0.06, -0.05)]),
		PackedFloat32Array([0.011, 0.009, 0.008])), _mat(Color(0.8, 0.35, 0.4)), Vector3.ZERO)
	# pulmoes: sacos finos com alveolos, dorsais
	for s in [-1.0, 1.0]:
		var lung := _put(chest, _blob(Vector3(0.055, 0.045, 0.13), 0.08, 22.0, 0.3), _mat(Color(0.93, 0.55, 0.58), 0.35, 0.92),
			Vector3(0.08 * s, 0.2, -0.05) - o_p)
		organs["pulmao_%s" % ("L" if s < 0 else "R")] = lung
		lung.set_meta("base", lung.scale)
	# figado: 3 lobos (o esquerdo maior) + vesicula biliar verde
	var liver_m := _mat(Color(0.38, 0.1, 0.07), 0.2)
	_put(chest, _blob(Vector3(0.09, 0.03, 0.08), 0.02), liver_m, Vector3(-0.07, 0.08, -0.05) - o_p, Vector3(0, 0.3, 0))
	_put(chest, _blob(Vector3(0.07, 0.03, 0.07), 0.02), liver_m, Vector3(0.07, 0.08, -0.06) - o_p, Vector3(0, -0.3, 0))
	_put(chest, _blob(Vector3(0.04, 0.025, 0.05), 0.02), liver_m, Vector3(0.0, 0.07, -0.02) - o_p)
	_put(chest, _blob(Vector3(0.015, 0.015, 0.015)), _mat(Color(0.2, 0.5, 0.15)), Vector3(0.01, 0.06, -0.04) - o_p)
	# estomago em J (lado esquerdo) -> intestino delgado enrolado -> reto
	var stomach := _put(trunk, _tube(PackedVector3Array([Vector3(-0.05, 0.15, -0.3), Vector3(-0.08, 0.13, -0.2), Vector3(-0.09, 0.12, -0.1),
		Vector3(-0.06, 0.11, -0.03), Vector3(-0.01, 0.1, -0.02)]), PackedFloat32Array([0.02, 0.035, 0.042, 0.035, 0.018])),
		_mat(Color(0.88, 0.76, 0.6), 0.3), -o_c)
	organs["estomago"] = stomach
	var gut := PackedVector3Array()
	var gr := PackedFloat32Array()
	for k in 40:
		var a := float(k) * 0.55
		gut.append(Vector3(cos(a) * 0.05 * (1.0 - k / 60.0), 0.08 + sin(a * 0.5) * 0.015, 0.02 + sin(a) * 0.035 + k * 0.0022))
		gr.append(0.011)
	gut.append(Vector3(0.0, 0.1, 0.16))
	gut.append(Vector3(0.0, 0.11, 0.24))
	gr.append(0.016)
	gr.append(0.018)
	var intestine := _put(trunk, _tube(gut, gr, 8), _mat(Color(0.86, 0.68, 0.52), 0.3), -o_c)
	organs["intestino"] = intestine
	# rins (dorsais, escuros), corpos gordurosos (dedos amarelos), bexiga
	for s in [-1.0, 1.0]:
		_put(trunk, _blob(Vector3(0.022, 0.012, 0.07), 0.05, 14.0), _mat(Color(0.45, 0.1, 0.08)), Vector3(0.03 * s, 0.17, 0.14) - o_c)
		var fat := Node3D.new()
		fat.position = Vector3(0.05 * s, 0.14, 0.02) - o_c
		trunk.add_child(fat)
		for k in 4:
			_put(fat, _tube(PackedVector3Array([Vector3.ZERO, Vector3(0.01 * s * k, -0.01, 0.04), Vector3(0.02 * s * k, -0.02, 0.07)]),
				PackedFloat32Array([0.008, 0.01, 0.006]), 6), _mat(Color(1.0, 0.82, 0.2), 0.4), Vector3(0.006 * k * s, 0, -0.004 * k))
		organs["gordura_%s" % ("L" if s < 0 else "R")] = fat
	_put(trunk, _blob(Vector3(0.035, 0.025, 0.03), 0.0), _mat(Color(0.95, 0.95, 0.8), 0.1, 0.55), Vector3(0, 0.07, 0.24) - o_c)
	# cerebro: bulbos olfatorios, hemisferios, lobos opticos, cerebelo, bulbo; medula
	var brain_m := _mat(Color(0.95, 0.78, 0.76), 0.3)
	var bz := Vector3(0, 0.35, -0.42) - o_h
	for s in [-1.0, 1.0]:
		_put(head, _blob(Vector3(0.009, 0.008, 0.02)), brain_m, bz + Vector3(0.008 * s, 0, -0.06))
		_put(head, _blob(Vector3(0.014, 0.012, 0.03)), brain_m, bz + Vector3(0.012 * s, 0, -0.02))
		_put(head, _blob(Vector3(0.014, 0.014, 0.016)), _mat(Color(0.95, 0.7, 0.7)), bz + Vector3(0.014 * s, 0.002, 0.018))
	_put(head, _blob(Vector3(0.012, 0.006, 0.008)), brain_m, bz + Vector3(0, 0.005, 0.04))
	_put(head, _tube(PackedVector3Array([bz + Vector3(0, 0, 0.045), bz + Vector3(0, -0.01, 0.1), Vector3(0, 0.27, -0.1) - o_h]),
		PackedFloat32Array([0.009, 0.007, 0.006])), brain_m, Vector3.ZERO)
	_put(trunk, _tube(PackedVector3Array([Vector3(0, 0.27, -0.1), Vector3(0, 0.25, 0.05), Vector3(0, 0.22, 0.12)]) , PackedFloat32Array([0.006, 0.005, 0.003])),
		brain_m, -o_c)


## Esqueleto de ra: cranio achatado, 9 vertebras curtas, urostilo longo,
## ilio (bacia comprida), e os ossos dos membros presos aos ossos animados.
func _skeleton_bones() -> void:
	var bone_m := _mat(Color(0.96, 0.93, 0.85), 0.5, 0.55)
	var trunk := _attach("corpo")
	var head := _attach("cabeca")
	var o_c: Vector3 = _rest["corpo"][0]
	var o_h: Vector3 = _rest["cabeca"][0]
	_put(head, _blob(Vector3(0.1, 0.018, 0.12), 0.05, 12.0), bone_m, Vector3(0, 0.33, -0.44) - o_h)
	for k in 9:
		_put(trunk, _blob(Vector3(0.025, 0.012, 0.012)), bone_m, Vector3(0, 0.26 - k * 0.004, -0.25 + k * 0.04) - o_c)
	_put(trunk, _tube(PackedVector3Array([Vector3(0, 0.23, 0.11), Vector3(0, 0.2, 0.3)]), PackedFloat32Array([0.008, 0.004])), bone_m, -o_c)
	for s in [-1.0, 1.0]:
		_put(trunk, _tube(PackedVector3Array([Vector3(0.03 * s, 0.24, 0.1), Vector3(0.05 * s, 0.16, 0.3)]), PackedFloat32Array([0.007, 0.009])), bone_m, -o_c)
	for s in ["L", "R"]:
		for b in ["femur", "tibia", "tarso", "pe", "umero", "antebraco", "mao"]:
			var n: String = b + "_" + s
			var hold := _attach(n)
			var v: Vector3 = (_rest[n][1] as Vector3) - (_rest[n][0] as Vector3)
			var r := 0.009 if b in ["femur", "tibia"] else 0.006
			_put(hold, _tube(PackedVector3Array([Vector3.ZERO, v * 0.5, v]), PackedFloat32Array([r * 1.3, r, r * 1.2]), 6), bone_m, Vector3.ZERO)


## Musculos das pernas: fusos vermelhos em volta do femur e da tibia;
## incham (e ficam mais vermelhos) quando os motoneuronios os contraem.
func _leg_muscles() -> void:
	for s in ["L", "R"]:
		for b in ["femur", "tibia", "umero"]:
			var n: String = b + "_" + s
			var hold := _attach(n)
			var v: Vector3 = (_rest[n][1] as Vector3) - (_rest[n][0] as Vector3)
			var r: float = {"femur": 0.05, "tibia": 0.035, "umero": 0.025}[b]
			var m := _put(hold, _tube(PackedVector3Array([v * 0.05, v * 0.3, v * 0.6, v * 0.95]), PackedFloat32Array([r * 0.3, r, r * 0.8, r * 0.25]), 10),
				_mat(Color(0.7, 0.15, 0.15), 0.35, 0.75), Vector3.ZERO)
			_muscles[n] = m


func _tongue() -> void:
	var head := _attach("cabeca")
	var p: Array = _meta_cache["pontos"]["boca"]
	tongue_root = Node3D.new()
	tongue_root.position = Vector3(p[0], p[1], p[2]) - (_rest["cabeca"][0] as Vector3)
	head.add_child(tongue_root)
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
	if male:
		var sm := _mat(Color(0.9, 0.87, 0.7), 0.1, 0.85)
		var throat := _attach("garganta")
		_sac = MeshInstance3D.new()
		_sac.mesh = _sph
		_sac.material_override = sm
		_sac.scale = Vector3(0.1, 0.05, 0.09)
		_sac.position = Vector3(0, -0.005, -0.03)
		throat.add_child(_sac)


# ---------------------------------------------------------------- estado vindo da fisica
func _q(from: Vector3, to: Vector3) -> Quaternion:
	var a := from.normalized()
	var b := to.normalized()
	if a.dot(b) > 0.9999:
		return Quaternion.IDENTITY
	if a.dot(b) < -0.9999:
		return Quaternion(Vector3.UP, PI)
	return Quaternion(a, b)


## Orienta uma cadeia de ossos para as direcoes pedidas (espaco do modelo).
func _chain(names: Array, dirs: Array) -> void:
	var parent_q := Quaternion.IDENTITY
	for i in names.size():
		var n: String = names[i]
		var rest_dir: Vector3 = (_rest[n][1] as Vector3) - (_rest[n][0] as Vector3)
		var gq := _q(rest_dir, dirs[i])
		_skel.set_bone_pose_rotation(_bone[n], parent_q.inverse() * gq)
		parent_q = gq


## ext 0 = pata dobrada (sentada, como o modelo), 1 = esticada para tras.
func set_leg(s: String, ext: float, act: float) -> void:
	var sx := 1.0 if s == "R" else -1.0
	var e := clampf(ext, 0.0, 1.0)
	var names := ["femur_" + s, "tibia_" + s, "tarso_" + s, "pe_" + s]
	var ext_dirs := [Vector3(0.25 * sx, -0.12, 1), Vector3(0.12 * sx, -0.18, 1), Vector3(0.05 * sx, -0.25, 1), Vector3(0.05 * sx, -0.3, 1)]
	var dirs := []
	for i in names.size():
		var rd: Vector3 = ((_rest[names[i]][1] as Vector3) - (_rest[names[i]][0] as Vector3)).normalized()
		dirs.append(rd.slerp((ext_dirs[i] as Vector3).normalized(), e))
	_chain(names, dirs)
	for b in ["femur_" + s, "tibia_" + s]:
		var m: MeshInstance3D = _muscles[b]
		var k := clampf(act, 0.0, 1.3)
		m.scale = Vector3(1.0 + 0.35 * k, 1.0 - 0.1 * k, 1.0 + 0.35 * k)
		(m.material_override as StandardMaterial3D).albedo_color = Color(0.6 + 0.35 * k, 0.12, 0.12, 0.75)


func set_arm(s: String, lift: float) -> void:
	var sx := 1.0 if s == "R" else -1.0
	var names := ["umero_" + s, "antebraco_" + s, "mao_" + s]
	var lift_dirs := [Vector3(0.4 * sx, -0.3, -0.8), Vector3(0.1 * sx, -0.4, -0.9), Vector3(0.0, -0.3, -1.0)]
	var dirs := []
	for i in names.size():
		var rd: Vector3 = ((_rest[names[i]][1] as Vector3) - (_rest[names[i]][0] as Vector3)).normalized()
		dirs.append(rd.slerp((lift_dirs[i] as Vector3).normalized(), clampf(lift, 0.0, 1.0)))
	_chain(names, dirs)


func set_state(org: AmphibianOrgans, call: float, swallow: float, blink: float, _jaw: float, energy: float) -> void:
	var heart: Node3D = organs["coracao"]
	heart.scale = Vector3.ONE * (1.0 - 0.22 * org.beat_now)
	for s in ["L", "R"]:
		var lg: MeshInstance3D = organs["pulmao_" + s]
		lg.scale = Vector3.ONE * (0.5 + 0.7 * org.lung)
		(organs["gordura_" + s] as Node3D).scale = Vector3.ONE * (0.4 + 0.9 * energy)
	(organs["estomago"] as Node3D).scale = Vector3.ONE * (0.8 + 0.8 * minf(org.stomach, 0.4))
	(organs["intestino"] as Node3D).scale = Vector3.ONE * (0.9 + 0.5 * minf(org.intestine, 0.3))
	# garganta: a bomba bucal sobe e desce o assoalho da boca; canto infla o saco
	var g := 1.0 + 0.35 * maxf(-org.buccal, 0.0) + 0.12 * org.buccal
	_skel.set_bone_pose_scale(_bone["garganta"], Vector3(1.0 + 0.1 * (g - 1.0), g, 1.0 + 0.2 * (g - 1.0)))
	if _sac:
		_sac.visible = call > 0.05
		_sac.scale = Vector3(0.1, 0.05, 0.09) * (1.0 + 1.3 * call)
	# olhos: afundam para empurrar a presa (engolir) e piscam (sobem a palpebra)
	for s in ["L", "R"]:
		var off := Vector3(0, -0.07 * swallow - 0.02 * blink, 0)
		_skel.set_bone_pose_position(_bone["olho_" + s], _eyes_rest[s] + off)
		_skel.set_bone_pose_scale(_bone["olho_" + s], Vector3(1.0, 1.0 - 0.5 * blink, 1.0))


func set_xray(on: bool) -> void:
	_xray = on
	skin_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA if on else BaseMaterial3D.TRANSPARENCY_DISABLED
	skin_mat.albedo_color.a = 0.28 if on else 1.0
	for n in _xray_nodes:
		n.visible = on


func is_xray() -> bool:
	return _xray


func show_tongue(tip: Vector3, k: float) -> void:
	var root := tongue_root.global_position
	var seg := (tip - root) * k
	tongue.visible = seg.length() > 0.3
	if not tongue.visible:
		return
	var y := seg.normalized()
	var x := y.cross(Vector3.UP if absf(y.y) < 0.95 else Vector3.RIGHT).normalized()
	var z := x.cross(y)
	var w := L * 0.045 * lerpf(1.3, 0.8, k) * global_basis.get_scale().x
	tongue.global_transform = Transform3D(Basis(x * w, y * seg.length(), z * w), root + seg * 0.5)


func hide_tongue() -> void:
	tongue.visible = false


func eye_positions() -> Array:
	var out := []
	for s in ["L", "R"]:
		out.append(_skel.to_global(_skel.get_bone_global_pose(_bone["olho_" + s]).origin))
	return out
