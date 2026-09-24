class_name FlyBody
extends Node3D
## Corpo do NeuroMechFly montado a partir de fly/fly_model.json (gerado por
## tools/convert_flygym.py) e das malhas OBJ convertidas do flygym.
##
## Cada segmento e um Node3D com o mesmo pos/quat do MuJoCo. As juntas seguem a
## convencao do flygym v2: DOFs aplicados na ordem yaw (x), pitch (y), roll (z),
## com yaw/roll invertidos no lado direito.

const MODEL_PATH := "res://fly/fly_model.json"
const MESH_DIR := "res://fly/meshes/"

static var _model: Dictionary = {}
static var _meshes: Dictionary = {}
static var _materials: Dictionary = {}

## Altura do torax acima da superficie (mm). O flygym solta a mosca com o
## torax a 1.3 mm; com a pose de caminhada ~0.95 mm deixa os tarsos no chao.
@export var body_height := 0.95

var segments: Dictionary = {}      # nome -> Node3D
var _rest: Dictionary = {}         # nome -> Transform3D
var _angles: Dictionary = {}       # nome do filho -> Vector3(yaw, pitch, roll)
var _dirty: Dictionary = {}
var mj_root: Node3D                # referencial do MuJoCo (x frente, y esquerda, z cima)


static func model() -> Dictionary:
	if _model.is_empty():
		var f := FileAccess.open(MODEL_PATH, FileAccess.READ)
		_model = JSON.parse_string(f.get_as_text())
	return _model


func _ready() -> void:
	_build()


func _build() -> void:
	var m := model()
	mj_root = Node3D.new()
	mj_root.name = "MuJoCoFrame"
	# MuJoCo: x frente, y esquerda, z cima  ->  Godot: -z frente, -x esquerda, y cima
	mj_root.basis = Basis(Vector3(0, 0, -1), Vector3(-1, 0, 0), Vector3(0, 1, 0))
	add_child(mj_root)

	for seg: Dictionary in m["segments"]:
		var seg_name: String = seg["name"]
		var node := Node3D.new()
		node.name = seg_name
		var p: Array = seg["pos"]
		var q: Array = seg["quat"]
		var t := Transform3D(Basis(Quaternion(q[1], q[2], q[3], q[0]).normalized()), Vector3(p[0], p[1], p[2]))
		if seg_name == "c_thorax":
			t.origin = Vector3(0, 0, body_height)
		_rest[seg_name] = t
		node.transform = t
		var parent_name: String = seg["parent"]
		if parent_name == "":
			mj_root.add_child(node)
		else:
			(segments[parent_name] as Node3D).add_child(node)
		segments[seg_name] = node

		var mi := MeshInstance3D.new()
		mi.name = "mesh"
		mi.mesh = _get_mesh(seg_name)
		mi.material_override = _get_material(seg)
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		if seg_name.ends_with("_wing"):
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		node.add_child(mi)

	for key: String in m["neutral_pose"]:
		var parts := key.split("-")
		set_dof(parts[1], parts[2], m["neutral_pose"][key])
	apply_pose()


func _get_mesh(seg_name: String) -> Mesh:
	if not _meshes.has(seg_name):
		_meshes[seg_name] = load(MESH_DIR + seg_name + ".obj")
	return _meshes[seg_name]


func _get_material(seg: Dictionary) -> Material:
	var c: Array = seg["color"]
	var key := "%s|%s|%s" % [str(c), str(seg["alpha"]), str(seg["speckle"])]
	if _materials.has(key):
		return _materials[key]
	var mat := StandardMaterial3D.new()
	# as cores do flygym foram pensadas para a luz do MuJoCo; escurecemos um pouco
	# para o ceu + sol do jardim
	c = [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8]
	mat.albedo_color = Color(c[0], c[1], c[2], seg["alpha"])
	mat.roughness = 0.55
	mat.metallic_specular = 0.35
	var sp: Array = seg["speckle"]
	if float(sp[3]) > 0.0:
		mat.albedo_texture = _speckle_texture(Color(c[0], c[1], c[2]), Color(sp[0], sp[1], sp[2]), sp[3])
		mat.albedo_color = Color(1, 1, 1, seg["alpha"])
		mat.uv1_triplanar = true
		mat.uv1_scale = Vector3(6, 6, 6)
		mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	if float(seg["alpha"]) < 1.0:
		# asas: membrana translucida com leve iridescencia
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.cull_mode = BaseMaterial3D.CULL_DISABLED
		mat.albedo_color = Color(0.72, 0.74, 0.8, 0.16)
		mat.roughness = 0.12
		mat.metallic_specular = 0.8
		mat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_ALWAYS
	if str(seg["name"]).ends_with("_eye"):
		mat.roughness = 0.3
		mat.metallic_specular = 0.7
		mat.clearcoat_enabled = true
		mat.clearcoat = 0.4
	_materials[key] = mat
	return mat


func _speckle_texture(base: Color, mark: Color, prob: float) -> ImageTexture:
	# Equivalente ao builtin "flat" + mark "random" do MuJoCo.
	var img := Image.create(50, 50, false, Image.FORMAT_RGB8)
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(str(base) + str(mark))
	for y in 50:
		for x in 50:
			img.set_pixel(x, y, mark if rng.randf() < prob else base)
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


## Define um DOF de uma junta (o filho identifica a junta). Angulo em radianos.
func set_dof(child: String, axis: String, angle: float) -> void:
	var v: Vector3 = _angles.get(child, Vector3.ZERO)
	match axis:
		"yaw": v.x = angle
		"pitch": v.y = angle
		"roll": v.z = angle
	_angles[child] = v
	_dirty[child] = true


func set_joint(child: String, yaw: float, pitch: float, roll: float) -> void:
	_angles[child] = Vector3(yaw, pitch, roll)
	_dirty[child] = true


func get_joint(child: String) -> Vector3:
	return _angles.get(child, Vector3.ZERO)


func apply_pose() -> void:
	for child: String in _dirty:
		var node: Node3D = segments.get(child)
		if node == null:
			continue
		var a: Vector3 = _angles[child]
		var s := -1.0 if child.begins_with("r") else 1.0
		var rest: Transform3D = _rest[child]
		var b := rest.basis \
			* Basis(Vector3.RIGHT, a.x * s) \
			* Basis(Vector3.UP, a.y) \
			* Basis(Vector3.BACK, a.z * s)
		node.transform = Transform3D(b, rest.origin)
	_dirty.clear()


## Posicao global de um segmento (ex.: "c_head", "l_arista").
func segment_position(seg_name: String) -> Vector3:
	var n: Node3D = segments.get(seg_name)
	return n.global_position if n else global_position
