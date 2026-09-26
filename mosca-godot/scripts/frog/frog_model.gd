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
## Nao ha animacao: cada junta (quadril, joelho, tornozelo, tarso, dedos do
## pe um a um, ombro, cotovelo, punho, dedos da mao) recebe um angulo que
## Frog calcula dos motoneuronios do conectoma; garganta, pulmoes, coracao e
## lingua tambem vem do estado do corpo; aqui so se mostra esse estado.

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
var _sit := {}               # osso -> rotacao (modelo) da pose de modelagem para a sentada
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
		var q: Array = b.get("sentado", [0, 0, 0, 1])
		_sit[n] = Quaternion(q[0], q[1], q[2], q[3]).normalized()
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
	# a malha foi esculpida com os membros esticados; a postura sentada e o angulo 0
	for n in _bone:
		_rot(n, Quaternion.IDENTITY)
	_joint_axes()
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
# ---------------------------------------------------------------- juntas (cinematica direta)
## Cada junta e uma dobradica (ou duas, no quadril e no ombro) com o eixo
## tirado da propria pose sentada do esqueleto. Angulo 0 = postura sentada do
## modelo; positivo = estende (abre a junta). Nada de pose pronta: quem da os
## angulos e a dinamica dos musculos em Frog, a partir dos motoneuronios.
## A malha foi esculpida com os membros esticados (pose de modelagem); "sentado"
## (do json) leva cada osso para a postura sentada, que e o angulo 0 de tudo.
const BACK := Vector3(0, 0, 1)
const FWD := Vector3(0, 0, -1)
const DOWN := Vector3(0, -1, 0)
const TOES := 5
const FINGERS := 4
var _ax := {}                # eixo de cada dobradica
var _limb_act := {"L": 0.0, "R": 0.0}


## Direcao do osso na postura sentada (espaco do modelo).
func _dir(n: String) -> Vector3:
	return (_sit[n] as Quaternion) * ((_rest[n][1] as Vector3) - (_rest[n][0] as Vector3)).normalized()


func _hinge(c: Vector3, p: Vector3) -> Vector3:
	# girar o filho em torno de c x p o leva na direcao do pai: abre a junta
	var a := c.cross(p)
	return a.normalized() if a.length() > 1e-4 else Vector3.RIGHT


func _joint_axes() -> void:
	for s in ["L", "R"]:
		var fe := _dir("femur_" + s)
		var ti := _dir("tibia_" + s)
		var ta := _dir("tarso_" + s)
		_ax["quadril_" + s] = _hinge(fe, BACK)            # femur vai para tras
		_ax["quadril_baixo_" + s] = _hinge(fe, DOWN)      # e desce (perna para baixo do corpo)
		_ax["joelho_" + s] = _hinge(ti, fe)
		_ax["tornozelo_" + s] = _hinge(ta, ti)
		_ax["tarso_" + s] = _ax["tornozelo_" + s]         # dobradica paralela
		var mid := _dir("dedo_pe2_" + s)
		for i in TOES:
			var d := _dir("dedo_pe%d_%s" % [i, s])
			_ax["dedo_pe%d_%s" % [i, s]] = _hinge(d, DOWN)          # dobra o dedo para baixo
			_ax["abre_pe%d_%s" % [i, s]] = mid.cross(d).normalized() if i != 2 else Vector3.UP
		var um := _dir("umero_" + s)
		var an := _dir("antebraco_" + s)
		_ax["ombro_" + s] = _hinge(um, FWD)               # umero para a frente (+) / tras (-)
		_ax["ombro_baixo_" + s] = _hinge(um, DOWN)        # umero empurra para baixo
		_ax["cotovelo_" + s] = _hinge(an, um)
		_ax["punho_" + s] = _ax["cotovelo_" + s]
		for i in FINGERS:
			_ax["dedo_mao%d_%s" % [i, s]] = _hinge(_dir("dedo_mao%d_%s" % [i, s]), DOWN)


## q: rotacao da junta no espaco do modelo sentado (em volta dos eixos de
## _joint_axes). Local = sentado(pai)^-1 * q * sentado(osso).
func _rot(bone: String, q: Quaternion) -> void:
	if missing.has(bone):
		return
	var p = _parent[bone]
	var ps: Quaternion = _sit[p] if p != null else Quaternion.IDENTITY
	_skel.set_bone_pose_rotation(_bone[bone], ps.inverse() * q * (_sit[bone] as Quaternion))


## q: quadril, joelho, tornozelo, tarso (rad, + estende), dedos (+ dobra
## para baixo); spread 0..1 abre os dedos (membrana esticada); act 0..1 so
## para o shader dos musculos.
func set_leg_joints(s: String, q: Dictionary, spread: float, act: float) -> void:
	var hip: float = q["quadril"]
	_rot("femur_" + s, Quaternion(_ax["quadril_baixo_" + s], clampf(hip, 0.0, 2.0) * 0.28) * Quaternion(_ax["quadril_" + s], hip))
	_rot("tibia_" + s, Quaternion(_ax["joelho_" + s], q["joelho"]))
	_rot("tarso_" + s, Quaternion(_ax["tornozelo_" + s], q["tornozelo"]))
	_rot("pe_" + s, Quaternion(_ax["tarso_" + s], q["tarso"]))
	for i in TOES:
		var sp := (i - 2) * 0.5 * 0.32 * spread
		_rot("dedo_pe%d_%s" % [i, s], Quaternion(_ax["abre_pe%d_%s" % [i, s]], absf(sp)) * Quaternion(_ax["dedo_pe%d_%s" % [i, s]], q["dedos"]))
	_limb_act[s] = act
	var k := clampf(act, 0.0, 1.3)
	for b in ["femur_" + s, "tibia_" + s]:
		for m: MeshInstance3D in _muscles.get(b, []):
			m.set_instance_shader_parameter("activation", k)


## q: ombro (+ frente / - tras), ombro_baixo (+ empurra para baixo),
## cotovelo (+ estende), punho (+ estende), dedos (+ fecha).
func set_arm_joints(s: String, q: Dictionary) -> void:
	_rot("umero_" + s, Quaternion(_ax["ombro_baixo_" + s], q["ombro_baixo"]) * Quaternion(_ax["ombro_" + s], q["ombro"]))
	_rot("antebraco_" + s, Quaternion(_ax["cotovelo_" + s], q["cotovelo"]))
	_rot("mao_" + s, Quaternion(_ax["punho_" + s], q["punho"]))
	for i in FINGERS:
		_rot("dedo_mao%d_%s" % [i, s], Quaternion(_ax["dedo_mao%d_%s" % [i, s]], q["dedos"]))


## Ponto de um osso (t = 0 cabeca, 1 ponta) no espaco deste no (FrogModel).
func point(bone: String, t := 1.0) -> Vector3:
	var gp := _skel.get_bone_global_pose(_bone[bone])
	var local: Vector3 = ((_rest[bone][1] as Vector3) - (_rest[bone][0] as Vector3)) * t
	return _scale_root.transform * (gp * local)


func _rest_point(bone: String, p: Vector3) -> Vector3:
	var gp := _skel.get_bone_global_pose(_bone[bone])
	return _scale_root.transform * (gp * (p - (_rest[bone][0] as Vector3)))


## Pontos que podem encostar no chao, no espaco deste no.
func contacts() -> Dictionary:
	var out := {"pe_L": [], "pe_R": [], "mao_L": [], "mao_R": [], "barriga": []}
	for s in ["L", "R"]:
		if not missing.has("femur_" + s):
			var f: Array = out["pe_" + s]
			f.append(point("pe_" + s, 0.0))
			for i in TOES:
				f.append(point("dedo_pe%d_%s" % [i, s]))
		var h: Array = out["mao_" + s]
		h.append(point("mao_" + s, 1.0))
		h.append(point("antebraco_" + s, 1.0))
		for i in FINGERS:
			h.append(point("dedo_mao%d_%s" % [i, s]))
	var bl: Array = out["barriga"]
	for p in [Vector3(0, 0.028, 0.3), Vector3(0, 0.028, 0.02), Vector3(0, 0.03, -0.1)]:
		bl.append(_rest_point("corpo", p))
	for p in [Vector3(0, 0.045, -0.2), Vector3(0, 0.11, -0.3)]:
		bl.append(_rest_point("peito", p))
	for p in [Vector3(0, 0.19, -0.36), Vector3(0, 0.23, -0.52)]:
		bl.append(_rest_point("cabeca", p))
	return out


## Quadril (cabeca do femur) no espaco deste no.
func hip(s: String) -> Vector3:
	return point("femur_" + s, 0.0)


## Centro da membrana do pe (para o empuxo na agua).
func web_center(s: String) -> Vector3:
	return (point("pe_" + s, 1.0) + point("dedo_pe2_" + s, 0.6) + point("dedo_pe3_" + s, 0.6)) / 3.0


## Pele: secrecao (brilho do muco), escurecer (MSH, melanoforos), inflar.
func set_skin(secretion: float, dark: float, inflate: float) -> void:
	for m in [skin_mat, skin_xray]:
		m.set_shader_parameter("wet", clampf(0.7 + 0.3 * secretion, 0.0, 1.0))
		m.set_shader_parameter("dark", clampf(dark, 0.0, 1.0))
		m.set_shader_parameter("inflate", clampf(inflate, 0.0, 1.0))


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
