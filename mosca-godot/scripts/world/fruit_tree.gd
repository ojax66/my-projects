class_name FruitTree
extends Node3D
## Arvore frutifera procedural. Tronco e galhos sao cilindros afunilados com
## colisao (capsulas) para a mosca poder caminhar neles; folhas sao cartoes com
## textura em MultiMesh com vento no shader; frutas ficam penduradas nas pontas.

static var _bark_mat: StandardMaterial3D
static var _leaf_mat: ShaderMaterial

@export var fruit_kind: Fruit.Kind = Fruit.Kind.APPLE
@export var height := 1200.0
@export var seed_value := 1

var _rng := RandomNumberGenerator.new()
var _st := SurfaceTool.new()
var _leaf_xforms: Array[Transform3D] = []
var _leaf_colors: Array[Color] = []
var _tips: Array = []   # [posicao, direcao]
var _static: StaticBody3D


func _ready() -> void:
	_rng.seed = seed_value
	_static = StaticBody3D.new()
	_static.collision_layer = 1
	_static.collision_mask = 0
	add_child(_static)
	_st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var trunk_r := height * 0.045
	_branch(Vector3.ZERO, Vector3.UP, height * 0.42, trunk_r, 0)
	_st.generate_normals()
	_st.generate_tangents()
	var wood := MeshInstance3D.new()
	wood.mesh = _st.commit()
	wood.material_override = _bark()
	add_child(wood)
	_build_leaves()
	_hang_fruits()
	_roots(trunk_r)


func _branch(start: Vector3, dir: Vector3, length: float, r: float, depth: int) -> void:
	var segs := 3
	var p := start
	var d := dir.normalized()
	var r0 := r
	for i in segs:
		d = (d + Vector3(_rng.randf_range(-0.15, 0.15), _rng.randf_range(-0.05, 0.12), _rng.randf_range(-0.15, 0.15))).normalized()
		var q := p + d * (length / segs)
		var r1 := r0 * 0.86
		_cylinder(p, q, r0, r1)
		if depth <= 2:
			_capsule(p, q, (r0 + r1) * 0.5)
		p = q
		r0 = r1
	if depth >= 4 or r0 < 3.0:
		_tips.append([p, d])
		_leaf_cluster(p, length * 0.9)
		return
	var n := _rng.randi_range(2, 3) if depth > 0 else 4
	for k in n:
		var ang := TAU * (float(k) / n) + _rng.randf() * 0.8
		var side := d.cross(Vector3.RIGHT if absf(d.x) < 0.9 else Vector3.FORWARD).normalized()
		side = side.rotated(d, ang)
		var spread := _rng.randf_range(0.5, 0.95) if depth == 0 else _rng.randf_range(0.35, 0.8)
		var nd := (d * (1.0 - spread) + side * spread + Vector3.UP * 0.25).normalized()
		_branch(p, nd, length * _rng.randf_range(0.62, 0.78), r0 * 0.72, depth + 1)
	if depth >= 2:
		_leaf_cluster(p, length * 0.6)


func _cylinder(a: Vector3, b: Vector3, ra: float, rb: float) -> void:
	var sides := 10
	var axis := (b - a).normalized()
	var u := axis.cross(Vector3.RIGHT if absf(axis.x) < 0.9 else Vector3.FORWARD).normalized()
	var w := axis.cross(u)
	var length := a.distance_to(b)
	for i in sides:
		var t0 := TAU * i / sides
		var t1 := TAU * (i + 1) / sides
		var n0 := u * cos(t0) + w * sin(t0)
		var n1 := u * cos(t1) + w * sin(t1)
		var v := [a + n0 * ra, a + n1 * ra, b + n1 * rb, b + n0 * rb]
		var uv := [Vector2(float(i) / sides, 0), Vector2(float(i + 1) / sides, 0),
			Vector2(float(i + 1) / sides, length / 300.0), Vector2(float(i) / sides, length / 300.0)]
		for idx in [0, 2, 1, 0, 3, 2]:
			_st.set_uv(uv[idx])
			_st.add_vertex(v[idx])


func _capsule(a: Vector3, b: Vector3, r: float) -> void:
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = r
	cap.height = a.distance_to(b) + 2.0 * r
	cs.shape = cap
	var y := (b - a).normalized()
	var x := y.cross(Vector3.FORWARD if absf(y.z) < 0.9 else Vector3.RIGHT).normalized()
	var z := x.cross(y)
	cs.transform = Transform3D(Basis(x, y, z), (a + b) * 0.5)
	_static.add_child(cs)


func _roots(r: float) -> void:
	for i in 5:
		var ang := TAU * i / 5.0 + _rng.randf() * 0.5
		var dir := Vector3(cos(ang), -0.35, sin(ang)).normalized()
		var a := Vector3(0, r * 1.2, 0)
		var b := a + dir * r * 3.5
		_st = SurfaceTool.new()
		_st.begin(Mesh.PRIMITIVE_TRIANGLES)
		_cylinder(a, b, r * 0.45, r * 0.12)
		_st.generate_normals()
		var mi := MeshInstance3D.new()
		mi.mesh = _st.commit()
		mi.material_override = _bark()
		add_child(mi)


func _leaf_cluster(center: Vector3, spread: float) -> void:
	var count := _rng.randi_range(40, 70)
	var base_col := Color(0.75, 0.95, 0.6) if fruit_kind != Fruit.Kind.ORANGE else Color(0.6, 0.85, 0.5)
	for i in count:
		var off := Vector3(_rng.randfn(), _rng.randfn() * 0.6, _rng.randfn()) * spread * 0.35
		var pos := center + off
		var size := _rng.randf_range(38.0, 62.0)
		var b := Basis.from_euler(Vector3(_rng.randf_range(-1.2, 1.2), _rng.randf() * TAU, _rng.randf_range(-0.6, 0.6)))
		_leaf_xforms.append(Transform3D(b.scaled(Vector3(size, size, size)), pos))
		var tint := _rng.randf_range(0.75, 1.1)
		_leaf_colors.append(Color(base_col.r * tint, base_col.g * tint, base_col.b * tint * 0.9, _rng.randf()))


func _build_leaves() -> void:
	var quad := QuadMesh.new()
	quad.size = Vector2(0.7, 1.0)
	quad.center_offset = Vector3(0, 0.5, 0)
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = quad
	mm.instance_count = _leaf_xforms.size()
	for i in _leaf_xforms.size():
		mm.set_instance_transform(i, _leaf_xforms[i])
		mm.set_instance_color(i, _leaf_colors[i])
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.material_override = _leaves()
	add_child(mmi)


## Lugares (locais) onde a arvore da frutas; comeca cheia e, conforme as
## frutas maduras caem, novas crescem aos poucos (uma a cada ~dia).
var _spots: Array[Vector3] = []
var _grow_t := 0.0


func budget() -> int:
	return 18 if fruit_kind != Fruit.Kind.CHERRY else 30


func _hang_fruits() -> void:
	var left := budget()
	var tips := _tips.duplicate()
	for i in tips.size():
		var j := _rng.randi_range(i, tips.size() - 1)
		var tmp = tips[i]
		tips[i] = tips[j]
		tips[j] = tmp
	var r: float = Fruit.INFO[fruit_kind]["radius"]
	for tip: Array in tips:
		var p: Vector3 = tip[0]
		var per := 1 if fruit_kind != Fruit.Kind.CHERRY else 2
		for k in per:
			if left <= 0:
				break
			left -= 1
			_spots.append(p + Vector3(_rng.randf_range(-30, 30), -r * 1.6 - _rng.randf() * 30.0, _rng.randf_range(-30, 30)))
	for sp in _spots:
		_grow_at(sp)
	_grow_t = randf_range(0.6, 1.2) * GardenWorld.DAY_LENGTH


func _grow_at(local: Vector3) -> Fruit:
	var f := Fruit.create(fruit_kind, true)
	f.position = local
	add_child(f)
	return f


func hanging_fruits() -> Array:
	var out: Array = []
	for c in get_children():
		if c is Fruit and (c as Fruit).hanging and not c.is_queued_for_deletion():
			out.append(c)
	return out


func _process(dt: float) -> void:
	_grow_t -= dt
	if _grow_t > 0.0:
		return
	_grow_t = randf_range(0.6, 1.2) * GardenWorld.DAY_LENGTH
	var hang := hanging_fruits()
	if hang.size() >= budget() or _spots.is_empty():
		return
	# uma fruta nova num lugar livre
	var r: float = Fruit.INFO[fruit_kind]["radius"]
	for k in 8:
		var sp: Vector3 = _spots[randi() % _spots.size()]
		var free := true
		for f: Fruit in hang:
			if f.position.distance_to(sp) < r * 1.5:
				free = false
				break
		if free:
			_grow_at(sp)
			return


## Save: posicoes das frutas penduradas agora.
func save_hanging() -> Array:
	var out: Array = []
	for f: Fruit in hanging_fruits():
		out.append([snappedf(f.position.x, 0.01), snappedf(f.position.y, 0.01), snappedf(f.position.z, 0.01)])
	return out


func load_hanging(list: Array) -> void:
	for f: Fruit in hanging_fruits():
		remove_child(f)
		f.queue_free()
	for a: Array in list:
		_grow_at(Vector3(float(a[0]), float(a[1]), float(a[2])))


static func _bark() -> StandardMaterial3D:
	if _bark_mat == null:
		_bark_mat = StandardMaterial3D.new()
		_bark_mat.albedo_texture = load("res://assets/textures/bark.png")
		_bark_mat.roughness = 0.95
		_bark_mat.uv1_scale = Vector3(1, 1, 1)
		_bark_mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	return _bark_mat


static func _leaves() -> ShaderMaterial:
	if _leaf_mat == null:
		_leaf_mat = ShaderMaterial.new()
		_leaf_mat.shader = load("res://shaders/leaves.gdshader")
		_leaf_mat.set_shader_parameter("leaf_tex", load("res://assets/textures/leaf.png"))
	return _leaf_mat
