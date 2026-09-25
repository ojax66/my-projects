class_name FrogModel
extends Node3D
## Corpo da ra feito do zero (tools/build_frog_body.py -> frog/frog_skin.*):
## superficie esculpida com as proporcoes e a aparencia de um sapo-banjo
## (Limnodynastes) sentado, com esqueleto de verdade (quadril, femur, tibia,
## tarso, pe, ombro, umero, radio-ulna, mao, garganta, olhos) e pesos por
## vertice (skinning). A pele e pintada pelo shader (shaders/frog_skin.*):
## dorso escuro com verrugas ferrugem, barriga creme, faixas nos membros,
## pele umida com relevo. Os olhos sao globos separados (iris dourada e
## pupila horizontal).
##
## Dentro, os orgaos esculpidos na cavidade do proprio corpo
## (tools/build_frog_organs.py -> frog/frog_organs.*): coracao com seio
## venoso, 2 atrios, ventriculo e cone arterial em espiral, arcos aorticos
## (carotido, sistemico, pulmocutaneo), aorta dorsal, cavas, veia abdominal e
## porta; pulmoes com septos alveolares; figado de 3 lobos com vesicula;
## estomago em J, pancreas, duodeno, intestino delgado enovelado, baco,
## intestino grosso e cloaca; rins com adrenais e ureteres, bexiga bilobada;
## testiculos (macho) ou ovarios cheios de ovulos pigmentados e ovidutos
## (femea); corpos gordurosos; encefalo completo, medula, nervos opticos,
## plexos e isquiaticos; cranio, mandibula, coluna, urostilo, pelve, cintura
## escapular e ossos dos membros; musculos da coxa, perna e braco (fibras).
## O shader de tecido (shaders/organ.gdshaderinc) desenha vasos, alveolos,
## lobulos e fibras. Tudo visivel no modo raio-X.
##
## Nao ha animacao: Frog calcula extensao das pernas, ativacao dos musculos,
## garganta, pulmoes, coracao e lingua; aqui so se mostra esse estado.

const SKIN := "res://frog/frog_skin.bin"
const META := "res://frog/frog_skin.json"

var L := 45.0
var male := false
var hue := 0.0
var skin_mat: ShaderMaterial
var skin_xray: ShaderMaterial
var albino := 0.0
var missing := []            # ossos de membros ausentes (defeito genetico)
var extra_leg := false       # polimelia: uma pata extra
var _eyes: Array[MeshInstance3D] = []
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
var _holders := {}           # osso -> Node3D no espaco do modelo
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
	_eyeballs()
	_organs()
	_tongue()
	_apply_defects()
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
	var uv2 := f.get_buffer(nv * 8).to_float32_array()
	var col := f.get_buffer(nv * 16).to_float32_array()
	var idx := f.get_buffer(ni * 4).to_int32_array()
	var bones := f.get_buffer(nv * 16).to_int32_array()
	var weights := f.get_buffer(nv * 16).to_float32_array()
	var pv := PackedVector3Array()
	var nvv := PackedVector3Array()
	var uvv := PackedVector2Array()
	var uvv2 := PackedVector2Array()
	var cc := PackedColorArray()
	pv.resize(nv)
	nvv.resize(nv)
	uvv.resize(nv)
	uvv2.resize(nv)
	cc.resize(nv)
	for i in nv:
		pv[i] = Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
		nvv[i] = Vector3(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2])
		uvv[i] = Vector2(uv[i * 2], uv[i * 2 + 1])
		uvv2[i] = Vector2(uv2[i * 2], uv2[i * 2 + 1])
		cc[i] = Color(col[i * 4], col[i * 4 + 1], col[i * 4 + 2], col[i * 4 + 3])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = pv
	arr[Mesh.ARRAY_NORMAL] = nvv
	arr[Mesh.ARRAY_TEX_UV] = uvv
	arr[Mesh.ARRAY_TEX_UV2] = uvv2
	arr[Mesh.ARRAY_COLOR] = cc
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
	skin_mat = ShaderMaterial.new()
	skin_mat.shader = load("res://shaders/frog_skin.gdshader")
	skin_xray = ShaderMaterial.new()
	skin_xray.shader = load("res://shaders/frog_skin_xray.gdshader")
	for m in [skin_mat, skin_xray]:
		m.set_shader_parameter("hue", hue * 3.0)       # cada individuo tem um tom (gene da cor)
		m.set_shader_parameter("albino", albino)
	_body = MeshInstance3D.new()
	_body.mesh = _mesh_cache
	_body.material_override = skin_mat
	_skel.add_child(_body)
	_body.skin = _skel.create_skin_from_rest_transforms()
	_body.skeleton = _body.get_path_to(_skel)


## Globos oculares: saltam da cabeca pela abertura das palpebras.
func _eyeballs() -> void:
	var r: float = float(_meta_cache["pontos"].get("raio_olho", 0.066))
	var sm := SphereMesh.new()
	sm.radius = r
	sm.height = r * 2.0
	sm.radial_segments = 24
	sm.rings = 12
	var em := ShaderMaterial.new()
	em.shader = load("res://shaders/frog_eye.gdshader")
	em.set_shader_parameter("albino", albino)
	for s in ["L", "R"]:
		var sg := 1.0 if s == "R" else -1.0
		var out_dir := Vector3(0.72 * sg, 0.62, -0.3).normalized()
		var eye := MeshInstance3D.new()
		eye.mesh = sm
		eye.material_override = em
		var pos: Vector3 = _rest["olho_" + s][0]
		eye.transform = Transform3D(Basis.looking_at(out_dir, Vector3.UP), pos - out_dir * 0.006)
		_attach("olho_" + s).add_child(eye)
		_eyes.append(eye)


## Defeitos geneticos/de desenvolvimento visiveis: membro ausente (ectromelia),
## pata extra (polimelia), olho ausente (anoftalmia), albinismo.
func set_defects(d: Dictionary) -> void:
	albino = 1.0 if d.get("albinismo", false) else 0.0
	missing = d.get("membro_ausente", [])
	extra_leg = d.get("polimelia", false)
	set_meta("sem_olho", d.get("anoftalmia", ""))
	set_meta("escoliose", d.get("escoliose", false))


func _apply_defects() -> void:
	for b: String in missing:
		if _bone.has(b):
			_skel.set_bone_pose_scale(_bone[b], Vector3.ONE * 0.02)
	if get_meta("escoliose", false):
		# coluna torta: o peito e a cabeca ficam desviados do quadril
		_skel.set_bone_pose_rotation(_bone["peito"], Quaternion(Vector3.UP, 0.22) * Quaternion(Vector3.FORWARD, 0.12))
	var no_eye: String = get_meta("sem_olho", "")
	if no_eye != "":
		_eyes[0 if no_eye == "L" else 1].visible = false
		_skel.set_bone_pose_scale(_bone["olho_" + no_eye], Vector3(1.0, 0.4, 1.0))
	if extra_leg:
		# uma perna a mais saindo do quadril (copia menor e torta da perna direita)
		var extra := MeshInstance3D.new()
		var cm := CapsuleMesh.new()
		cm.radius = 0.035
		cm.height = 0.4
		extra.mesh = cm
		extra.material_override = skin_mat
		var hip: Vector3 = _rest["femur_R"][0]
		extra.transform = Transform3D(Basis.from_euler(Vector3(1.2, 0.5, 0.4)), hip + Vector3(0.05, -0.02, 0.1))
		_attach("corpo").add_child(extra)


# ---------------------------------------------------------------- orgaos (tools/build_frog_organs.py)
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


func _attach(bone: String) -> Node3D:
	if _holders.has(bone):
		return _holders[bone]
	var ba := BoneAttachment3D.new()
	ba.bone_name = bone
	_skel.add_child(ba)
	var holder := Node3D.new()
	holder.position = -(_rest[bone][0] as Vector3)     # espaco do modelo em repouso
	ba.add_child(holder)
	_holders[bone] = holder
	return holder


func _organs() -> void:
	for e: Dictionary in OrganBank.meshes(OrganBank.FROG):
		var n: String = e["name"]
		# gonadas conforme o sexo
		if male and (n.begins_with("ovario") or n.begins_with("oviduto")):
			continue
		if not male and n.begins_with("testiculo"):
			continue
		var mi := MeshInstance3D.new()
		mi.mesh = e["mesh"]
		mi.material_override = OrganBank.tissue(e["mat"])
		mi.position = e["pivot"]
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_attach(e["bone"]).add_child(mi)
		_xray_nodes.append(mi)
		organs[n] = mi
		mi.set_meta("base", mi.scale)
		if n.begins_with("musc_"):
			var b: String = e["bone"]
			if not _muscles.has(b):
				_muscles[b] = []
			(_muscles[b] as Array).append(mi)
	if not male:
		var eggs: Dictionary = OrganBank.meta(OrganBank.FROG)["ovulos"]
		var egg_mat := StandardMaterial3D.new()
		egg_mat.vertex_color_use_as_albedo = true
		egg_mat.roughness = 0.15
		egg_mat.clearcoat_enabled = true
		egg_mat.clearcoat = 1.0
		var rng := RandomNumberGenerator.new()
		rng.seed = hash(hue)
		for s in ["L", "R"]:
			var list: Array = eggs[s]
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.mesh = OrganBank.egg_mesh()
			mm.instance_count = list.size()
			for i in list.size():
				var q: Array = list[i]
				var b := Basis.from_euler(Vector3(rng.randf_range(-0.6, 0.6), rng.randf() * TAU, rng.randf_range(-0.6, 0.6)))
				mm.set_instance_transform(i, Transform3D(b.scaled(Vector3.ONE * float(q[3])), Vector3(q[0], q[1], q[2])))
			var mmi := MultiMeshInstance3D.new()
			mmi.multimesh = mm
			mmi.material_override = egg_mat
			mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			(organs["ovario_" + s] as Node3D).add_child(mmi)


func _tongue() -> void:
	var head := _attach("cabeca")
	var p: Array = _meta_cache["pontos"]["boca"]
	tongue_root = Node3D.new()
	tongue_root.position = Vector3(p[0], p[1], p[2])
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
		_sac.position = (_rest["garganta"][0] as Vector3) + Vector3(0, -0.005, -0.03)
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
	# os ventres dos musculos incham e avermelham quando contraem (shader)
	var k := clampf(act, 0.0, 1.3)
	for b in ["femur_" + s, "tibia_" + s]:
		for m: MeshInstance3D in _muscles.get(b, []):
			m.set_instance_shader_parameter("activation", k)


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
	# ciclo cardiaco: os atrios contraem logo antes do ventriculo (sistole
	# atrial -> ventricular); o ventriculo empalidece ao ejetar o sangue
	var ph := org.beat_phase
	var a_sys := exp(-pow(wrapf(ph - 0.02, -0.5, 0.5) / 0.05, 2.0))
	var v_sys := org.beat_now
	(organs["ventriculo"] as MeshInstance3D).scale = Vector3(1.0 - 0.14 * v_sys, 1.0 - 0.1 * v_sys, 1.0 - 0.18 * v_sys)
	(organs["ventriculo"] as MeshInstance3D).set_instance_shader_parameter("pulse", 0.5 * v_sys)
	for s in ["L", "R"]:
		(organs["atrio_" + s] as Node3D).scale = Vector3.ONE * (1.0 - 0.25 * a_sys + 0.08 * v_sys)
		# pulmoes enchem a partir do hilo com a bomba bucal
		(organs["pulmao_" + s] as Node3D).scale = Vector3.ONE * (0.55 + 0.55 * org.lung)
		(organs["gordura_" + s] as Node3D).scale = Vector3.ONE * (0.4 + 0.8 * energy)
		if organs.has("ovario_" + s):
			(organs["ovario_" + s] as Node3D).scale = Vector3.ONE * (0.55 + 0.5 * energy)
	(organs["cone_arterial"] as Node3D).scale = Vector3.ONE * (1.0 + 0.12 * v_sys)
	skin_mat.set_shader_parameter("fat", energy)
	skin_xray.set_shader_parameter("fat", energy)
	(organs["estomago"] as Node3D).scale = Vector3.ONE * (0.8 + 0.7 * minf(org.stomach, 0.4))
	(organs["intestino_delgado"] as Node3D).scale = Vector3.ONE * (0.95 + 0.25 * minf(org.intestine, 0.3))
	# garganta: a bomba bucal sobe e desce o assoalho da boca; canto infla o saco
	var g := 1.0 + 0.06 * maxf(-org.buccal, 0.0)   # papo recolhido; o saco vocal so infla no canto
	_skel.set_bone_pose_scale(_bone["garganta"], Vector3(1.0 + 0.1 * (g - 1.0), g, 1.0 + 0.2 * (g - 1.0)))
	if _sac:
		_sac.visible = call > 0.05
		_sac.scale = Vector3(0.1, 0.05, 0.09) * (1.0 + 1.3 * call)
	# olhos: afundam para empurrar a presa (engolir) e piscam (sobem a palpebra)
	for s in ["L", "R"]:
		var off := Vector3(0, -0.07 * swallow - 0.02 * blink, 0)
		_skel.set_bone_pose_position(_bone["olho_" + s], _eyes_rest[s] + off)
		var sunk := 0.4 if get_meta("sem_olho", "") == s else 1.0
		_skel.set_bone_pose_scale(_bone["olho_" + s], Vector3(1.0, (1.0 - 0.5 * blink) * sunk, 1.0))


func set_xray(on: bool) -> void:
	_xray = on
	_body.material_override = skin_xray if on else skin_mat
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
