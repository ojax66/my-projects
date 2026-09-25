class_name Fruit
extends RigidBody3D
## Fruta manipulavel. Emite odor (mais forte quando caida e fermentando) e tem
## "sabor" que os GRNs dos tarsos da mosca sentem ao pisar nela.

enum Kind { APPLE, CHERRY, ORANGE, LEMON, PEAR }

const INFO := {
	Kind.APPLE: {"name": "Maca", "radius": 38.0, "a": Color(0.78, 0.08, 0.06), "b": Color(0.95, 0.72, 0.2), "sugar": 1.0, "bitter": 0.0, "odor": 1.0},
	Kind.CHERRY: {"name": "Cereja", "radius": 12.0, "a": Color(0.45, 0.0, 0.05), "b": Color(0.75, 0.05, 0.1), "sugar": 1.0, "bitter": 0.0, "odor": 0.6},
	Kind.ORANGE: {"name": "Laranja", "radius": 40.0, "a": Color(1.0, 0.45, 0.02), "b": Color(1.0, 0.62, 0.1), "sugar": 0.9, "bitter": 0.0, "odor": 1.2},
	Kind.LEMON: {"name": "Limao verde (amargo)", "radius": 28.0, "a": Color(0.35, 0.6, 0.1), "b": Color(0.7, 0.82, 0.25), "sugar": 0.0, "bitter": 1.0, "odor": 0.25},
	Kind.PEAR: {"name": "Pera", "radius": 34.0, "a": Color(0.62, 0.72, 0.18), "b": Color(0.9, 0.78, 0.3), "sugar": 1.0, "bitter": 0.0, "odor": 0.9},
}

## glomerulos do lobo antenal usados no jogo (ORNs do conectoma)
const GLOMS := ["DM1", "DM2", "DM3", "DM4", "DL1", "VA2"]
## perfil de odor de cada fruta sobre esses glomerulos (DM1/DM2 ~ esteres
## frutados, DL1/VA2 ~ notas citricas/verdes). Fermentacao soma acetato de
## etila e etanol, que ativam fortemente DM1/DM2.
const PROFILE := {
	Kind.APPLE: [0.8, 1.0, 0.3, 0.3, 0.1, 0.3],
	Kind.CHERRY: [0.5, 0.4, 0.9, 0.4, 0.1, 0.2],
	Kind.ORANGE: [0.3, 0.3, 0.3, 0.2, 0.9, 0.7],
	Kind.LEMON: [0.1, 0.1, 0.2, 0.1, 1.0, 0.9],
	Kind.PEAR: [0.6, 0.8, 0.2, 0.8, 0.1, 0.3],
}
const FERMENT := [1.0, 0.7, 0.2, 0.3, 0.0, 0.1]

static var _shader: Shader

@export var kind: Kind = Kind.APPLE
@export var hanging := false
var radius_override := 0.0

var radius := 30.0
var display_name := "Fruta"
var ground_time := 0.0   # tempo parada no chao (fermentacao)
var fall_timer := -1.0
var flesh := 1.0         # fracao de polpa que resta
var capacity := 1.0      # unidades de comida
var _stem: Node3D
var _mesh: MeshInstance3D
var _col_shape: Shape3D
var _mat: ShaderMaterial
var _last_scale := 1.0


static func create(k: Kind, hang := false) -> Fruit:
	var f := Fruit.new()
	f.kind = k
	f.hanging = hang
	return f


func _ready() -> void:
	var info: Dictionary = INFO[kind]
	radius = radius_override if radius_override > 0.0 else info["radius"] * randf_range(0.85, 1.15)
	display_name = info["name"]
	capacity = pow(radius / 10.0, 3.0) * 0.08
	add_to_group("odor_source")
	add_to_group("loomer")
	add_to_group("grabbable")
	collision_layer = 2
	collision_mask = 1 | 2
	mass = pow(radius / 10.0, 3.0) * 0.004
	continuous_cd = true
	can_sleep = true
	var pm := PhysicsMaterial.new()
	pm.friction = 0.9
	pm.bounce = 0.15 if kind != Kind.CHERRY else 0.25
	physics_material_override = pm
	angular_damp = 1.5
	_build_mesh(info)
	var cs := CollisionShape3D.new()
	if kind == Kind.LEMON:
		var cap := CapsuleShape3D.new()
		cap.radius = radius * 0.78
		cap.height = radius * 2.3
		cs.shape = cap
		cs.rotation_degrees = Vector3(0, 0, 90)
	else:
		var sp := SphereShape3D.new()
		sp.radius = radius
		cs.shape = sp
	_col_shape = cs.shape
	add_child(cs)
	if hanging:
		freeze = true
		freeze_mode = RigidBody3D.FREEZE_MODE_KINEMATIC
		set_physics_process(false)
		# de vez em quando uma fruta madura cai sozinha
		get_tree().create_timer(randf_range(40.0, 600.0), false, true).timeout.connect(func():
			if hanging and is_inside_tree():
				drop())


func _physics_process(dt: float) -> void:
	if linear_velocity.length() < 5.0 and global_position.y < 200.0:
		ground_time += dt
	else:
		ground_time = maxf(0.0, ground_time - dt * 0.5)
	if global_position.y < -2000.0:
		queue_free()


func drop() -> void:
	hanging = false
	freeze = false
	set_physics_process(true)
	if is_instance_valid(_stem):
		_stem.visible = false
	sleeping = false


## Intensidade do odor (unidades arbitrarias). Frutas caidas fermentam e
## atraem muito mais as moscas (etanol, acetato de etila...).
func odor_strength() -> float:
	var base: float = INFO[kind]["odor"]
	var ferment := clampf(ground_time / 60.0, 0.0, 1.0)
	return base * (0.35 + 1.4 * ferment) if not hanging else base * 0.25


func taste() -> Dictionary:
	if flesh <= 0.0:
		return {"sugar": 0.0, "bitter": 0.0}
	return {"sugar": INFO[kind]["sugar"], "bitter": INFO[kind]["bitter"]}


## Perfil de odor (6 glomerulos) ja multiplicado pela intensidade.
func odor_profile() -> PackedFloat32Array:
	var k := odor_strength()
	var ferment := clampf(ground_time / 60.0, 0.0, 1.0) * (0.5 + (1.0 - flesh)) if not hanging else 0.0
	var base: Array = PROFILE[kind]
	var out := PackedFloat32Array()
	out.resize(GLOMS.size())
	for i in GLOMS.size():
		out[i] = k * (float(base[i]) + ferment * float(FERMENT[i]))
	return out


## "Assinatura" do cheiro para a memoria: o perfil nos glomerulos mais os
## compostos proprios de cada fruta (limoneno do limao, etc.), que no cerebro
## viram um padrao esparso e quase unico de celulas de Kenyon. Assim o que se
## aprende sobre um limao nao contamina a laranja ou a maca.
func memory_key() -> PackedFloat32Array:
	var prof := CreatureMemory.norm(odor_profile())
	var out := PackedFloat32Array()
	for x in prof:
		out.append(x * 0.5)
	for k in Kind.size():
		out.append(1.0 if k == kind else 0.0)
	return out


## Uma mosca ou larva come: tira polpa e devolve quanto conseguiu (unidades).
func consume(amount: float) -> float:
	var got := minf(amount, flesh * capacity)
	flesh -= got / capacity
	var sc := 0.45 + 0.55 * pow(maxf(flesh, 0.0), 0.5)
	if absf(sc - _last_scale) > 0.03:
		_last_scale = sc
		if _mesh:
			_mesh.scale = Vector3.ONE * sc
		if _col_shape is SphereShape3D:
			(_col_shape as SphereShape3D).radius = radius * sc
		if _mat:
			_mat.set_shader_parameter("rot", 1.0 - flesh)
	if flesh <= 0.01:
		queue_free.call_deferred()
	return got


func loom_radius() -> float:
	return radius


func describe() -> String:
	var s := display_name
	if hanging:
		s += " (no galho)"
	if flesh < 0.97:
		s += " — %d%% comida" % int((1.0 - flesh) * 100)
	elif ground_time > 30.0:
		s += " (fermentando)"
	return s


func _build_mesh(info: Dictionary) -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rings := 24
	var segs := 32
	var verts: Array[Vector3] = []
	for i in rings + 1:
		var v := float(i) / rings
		var th := v * PI
		for j in segs + 1:
			var u := float(j) / segs
			var ph := u * TAU
			var p := Vector3(sin(th) * cos(ph), cos(th), sin(th) * sin(ph))
			p = _shape(p) * radius
			verts.append(p)
	for i in rings:
		for j in segs:
			var a := i * (segs + 1) + j
			var b := a + segs + 1
			for idx in [a, b, a + 1, a + 1, b, b + 1]:
				st.add_vertex(verts[idx])
	st.index()
	st.generate_normals()
	var mi := MeshInstance3D.new()
	_mesh = mi
	mi.mesh = st.commit()
	if _shader == null:
		_shader = load("res://shaders/fruit.gdshader")
	var mat := ShaderMaterial.new()
	mat.shader = _shader
	mat.set_shader_parameter("color_a", info["a"])
	mat.set_shader_parameter("color_b", info["b"])
	mat.set_shader_parameter("seed", randf() * 100.0)
	mat.set_shader_parameter("dimples", 1.0 if kind in [Kind.ORANGE, Kind.LEMON] else 0.0)
	mat.set_shader_parameter("radius", radius)
	mi.material_override = mat
	_mat = mat
	add_child(mi)
	# cabinho
	if kind != Kind.LEMON and kind != Kind.ORANGE or hanging:
		_stem = Node3D.new()
		var stem := MeshInstance3D.new()
		var cyl := CylinderMesh.new()
		var long := kind == Kind.CHERRY
		cyl.top_radius = radius * (0.04 if long else 0.06)
		cyl.bottom_radius = radius * (0.05 if long else 0.08)
		cyl.height = radius * (3.0 if long else 0.5)
		stem.mesh = cyl
		var sm := StandardMaterial3D.new()
		sm.albedo_color = Color(0.35, 0.25, 0.1) if not long else Color(0.35, 0.5, 0.15)
		stem.material_override = sm
		stem.position = Vector3(0, radius * 0.85 + cyl.height * 0.5, 0)
		stem.rotation_degrees = Vector3(0, 0, randf_range(-12, 12))
		_stem.add_child(stem)
		add_child(_stem)


func _shape(p: Vector3) -> Vector3:
	match kind:
		Kind.APPLE:
			var dimple := exp(-pow((1.0 - p.y) * 3.0, 2.0)) * 0.22 + exp(-pow((1.0 + p.y) * 4.0, 2.0)) * 0.12
			var q := p * Vector3(1.0, 0.9, 1.0)
			return q * (1.0 - dimple * (1.0 - absf(p.y) * 0.3)) + Vector3(0, -dimple * 0.1, 0)
		Kind.PEAR:
			var t := (p.y + 1.0) * 0.5
			var w := lerpf(1.0, 0.55, smoothstep(0.35, 1.0, t))
			return Vector3(p.x * w, p.y * 1.25 + 0.2, p.z * w)
		Kind.LEMON:
			var tip := pow(absf(p.x), 6.0) * 0.18
			return Vector3(p.x * (1.2 + tip), p.y * 0.82, p.z * 0.82)
		Kind.CHERRY:
			return p * Vector3(1.0, 0.92, 1.0)
	return p
