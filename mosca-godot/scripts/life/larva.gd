class_name Larva
extends Node3D
## Larva (lagartinha) de Drosophila com o cerebro do conectoma da larva
## (Winding et al. 2023), em modo de taxa. Rasteja por ondas de contracao
## (peristaltismo), come a polpa da fruta, cresce de ~0,7 a ~4 mm e, depois de
## comer o suficiente, sai da fruta e vira pupa.

const WORLD_MASK := 1 | 2
const SEGS := 11
const LARVA_BRAIN := "res://brain/larva_connectome.json"

var genome: Genome
var memory := PackedFloat32Array()
var generation := 1
var lineage := 0
var brain: FlyBrain
var age := 0.0
var food := 0.0
var size_mm := 0.7
var behavior := "recem-eclodida"
var dead := false
var surface_body: Node3D = null
var _surface_local := Transform3D.IDENTITY
var _up := Vector3.UP
var _phase := 0.0
var _turn_noise := 0.0
var _wander_t := 0.0
var _carried := false
var _carry_t := Transform3D.IDENTITY
var _segs: Array[MeshInstance3D] = []
var _body_root: Node3D
var _rng := RandomNumberGenerator.new()
var sense := {"odor_L": 0.0, "odor_R": 0.0, "taste": 0.0, "light": 0.0}
var m_crawl_l := 0.0
var m_crawl_r := 0.0
var m_feed := 0.0
static var _mat: StandardMaterial3D
static var _gut_mat: StandardMaterial3D
static var _hook_mat: StandardMaterial3D


func _ready() -> void:
	_rng.randomize()
	add_to_group("larvae")
	add_to_group("creatures")
	if genome == null:
		genome = Genome.random_founder(_rng)
	if FileAccess.file_exists(LARVA_BRAIN):
		brain = FlyBrain.from_json_file(LARVA_BRAIN)
	else:
		brain = FlyBrain.from_dict({"neurons": [], "edges": []})
	brain.set_mode(FlyBrain.Mode.RATE)
	brain.learning_gain = genome.get_gene("learning")
	_build_body()
	var area := Area3D.new()
	area.collision_layer = 4
	area.collision_mask = 0
	area.monitoring = false
	var cs := CollisionShape3D.new()
	var sh := SphereShape3D.new()
	sh.radius = 2.5
	cs.shape = sh
	area.add_child(cs)
	area.set_meta("creature", self)
	add_child(area)


func _build_body() -> void:
	if _mat == null:
		_mat = StandardMaterial3D.new()
		_mat.albedo_color = Color(0.96, 0.94, 0.86)
		_mat.roughness = 0.25
		_mat.rim_enabled = true
		_mat.rim = 0.5
		_mat.subsurf_scatter_enabled = true
		_mat.subsurf_scatter_strength = 0.6
		_gut_mat = StandardMaterial3D.new()
		_gut_mat.albedo_color = Color(0.55, 0.35, 0.18)
		_hook_mat = StandardMaterial3D.new()
		_hook_mat.albedo_color = Color(0.05, 0.04, 0.03)
	_body_root = Node3D.new()
	add_child(_body_root)
	var sph := SphereMesh.new()
	sph.radius = 0.5
	sph.height = 1.0
	sph.radial_segments = 14
	sph.rings = 7
	for i in SEGS:
		var mi := MeshInstance3D.new()
		mi.mesh = sph
		mi.material_override = _mat
		_body_root.add_child(mi)
		_segs.append(mi)
	# intestino escuro visivel atraves da cuticula
	var gut := MeshInstance3D.new()
	var cap := CapsuleMesh.new()
	cap.radius = 0.07
	cap.height = 0.55
	gut.mesh = cap
	gut.rotation_degrees = Vector3(90, 0, 0)
	gut.material_override = _gut_mat
	gut.name = "gut"
	_body_root.add_child(gut)
	# ganchos da boca
	for s in [-1, 1]:
		var hook := MeshInstance3D.new()
		var c := CylinderMesh.new()
		c.top_radius = 0.0
		c.bottom_radius = 0.025
		c.height = 0.1
		hook.mesh = c
		hook.material_override = _hook_mat
		hook.name = "hook_%d" % s
		_body_root.add_child(hook)


func place(p: Vector3, n: Vector3, surf: Node3D) -> void:
	_up = n.normalized()
	global_transform = Transform3D(Fly._basis_from(_up, Vector3.FORWARD.rotated(_up, _rng.randf() * TAU)), p)
	_attach(surf)


func _attach(surf: Object) -> void:
	if surf is Node3D and (surf is RigidBody3D or (surf as Node3D).has_method("taste")):
		surface_body = surf
		_surface_local = surface_body.global_transform.affine_inverse() * global_transform
	else:
		surface_body = null


func _physics_process(dt: float) -> void:
	if dead or dt <= 0.0:
		return
	age += dt
	if _carried:
		global_transform = global_transform.interpolate_with(_carry_t, 1.0 - exp(-dt * 20.0))
		_animate(dt, 2.0)
		return
	if is_instance_valid(surface_body):
		global_transform = surface_body.global_transform * _surface_local
		_up = global_basis.y.normalized()
	else:
		surface_body = null
	_sense()
	brain.advance(dt)
	var a := 1.0 - exp(-dt / 0.3)
	m_crawl_l = lerpf(m_crawl_l, brain.output("crawl_L"), a)
	m_crawl_r = lerpf(m_crawl_r, brain.output("crawl_R"), a)
	m_feed = lerpf(m_feed, brain.output("feed"), a)

	# crescimento: tamanho segue a comida acumulada
	size_mm = lerpf(0.7, 4.0 * genome.get_gene("size"), clampf(food / LifeManager.LARVA_FOOD, 0.0, 1.0))
	_body_root.scale = Vector3.ONE * size_mm

	var on_food := surface_body is Fruit and (surface_body as Fruit).flesh > 0.0
	var ready := food >= LifeManager.LARVA_FOOD and age >= LifeManager.LARVA_MIN_TIME
	var speed := 0.0
	var turn := 0.0
	_turn_noise = clampf(_turn_noise * (1.0 - dt * 0.5) + _rng.randfn() * sqrt(dt) * 0.8, -1.0, 1.0)
	if ready:
		# fase errante: larva madura sai da comida para pupar
		_wander_t += dt
		behavior = "procurando lugar para pupar"
		speed = 1.2 * size_mm * 0.4
		turn = _turn_noise * 0.6 - _odor_bias() * 1.5
		if _wander_t > 18.0 and not on_food:
			behavior = "virando pupa"
			if LifeManager.instance:
				LifeManager.instance.pupate(self)
			queue_free()
			return
	elif on_food and (m_feed > 0.15 or sense["taste"] > 0.0):
		behavior = "comendo a polpa"
		var got := (surface_body as Fruit).consume(0.006 * size_mm * dt)
		food += got
		speed = 0.1 * size_mm
		turn = _turn_noise * 0.4
	else:
		behavior = "rastejando"
		var drive := clampf((m_crawl_l + m_crawl_r) * 0.5, 0.2, 1.5)
		speed = 0.35 * size_mm * drive * genome.get_gene("speed")
		# viragem: assimetria dos descendentes do conectoma + quimiotaxia
		turn = (m_crawl_l - m_crawl_r) * 1.5 + _odor_bias() * 2.0 * genome.get_gene("tropism") + _turn_noise * 0.7
	# morre se nao conseguir comida
	if age > LifeManager.LARVA_MIN_TIME * 4.0 and food < LifeManager.LARVA_FOOD * 0.5:
		_die("fome (larva)")
		return
	_crawl(dt, speed, turn)
	_animate(dt, speed / maxf(size_mm, 0.1))


func _sense() -> void:
	var head := global_position - global_basis.z * size_mm * 0.5
	var right := global_basis.x
	var c_l := _odor_sum(head - right * 20.0)
	var c_r := _odor_sum(head + right * 20.0)
	var gain := genome.get_gene("odor_gain")
	sense["odor_L"] = 150.0 * c_l / (c_l + 0.6) * gain
	sense["odor_R"] = 150.0 * c_r / (c_r + 0.6) * gain
	brain.set_input("odor_L", sense["odor_L"])
	brain.set_input("odor_R", sense["odor_R"])
	var taste := 0.0
	if surface_body is Fruit:
		taste = 150.0 * float((surface_body as Fruit).taste().get("sugar", 0.0))
	sense["taste"] = taste
	brain.set_input("taste", taste)
	# larvas fogem da luz: exposta = superficie virada para o ceu
	var light := clampf(_up.y, 0.0, 1.0) * 80.0
	sense["light"] = light
	brain.set_input("light_L", light)
	brain.set_input("light_R", light)
	brain.set_input("explore_L", 25.0)
	brain.set_input("explore_R", 25.0)
	brain.set_input("reward", taste * 0.5)


func _odor_sum(p: Vector3) -> float:
	var c := 0.0
	for src in get_tree().get_nodes_in_group("odor_source"):
		var d: float = p.distance_to(src.global_position)
		if d < 800.0:
			c += float(src.odor_strength()) * exp(-d / 120.0)
	return c


func _odor_bias() -> float:
	var l: float = sense["odor_L"]
	var r: float = sense["odor_R"]
	return (l - r) / (l + r + 1.0)


func _crawl(dt: float, speed: float, turn: float) -> void:
	var up := _up.normalized()
	var b := Basis(up, turn * dt) * global_basis.orthonormalized()
	var fwd := -b.z
	var pos := global_position
	var p := pos + fwd * speed * dt
	var hit := _ray(p + up * 1.0, p - up * 2.5)
	if not hit:
		hit = _ray(p - up * 0.6, p - up * 0.6 - fwd * 2.5)
	if hit:
		_up = _up.lerp(hit.normal, 0.3).normalized()
		global_transform = Transform3D(Fly._basis_from(_up, fwd), hit.position)
		_attach(hit.collider)
	else:
		# caiu: desce ate o chao
		var down := _ray(pos + Vector3.UP * 5.0, pos + Vector3.DOWN * 3000.0)
		if down:
			_up = down.normal
			global_transform = Transform3D(Fly._basis_from(_up, fwd), down.position)
			_attach(down.collider)


func _animate(dt: float, rel_speed: float) -> void:
	_phase += dt * (1.5 + rel_speed * 6.0)
	var z := 0.0
	for i in SEGS:
		var t := float(i) / (SEGS - 1)
		# perfil: cabeca fina, meio gordo, cauda afunilando
		var rad := lerpf(0.06, 0.13, sin(clampf(t * 1.25, 0.0, 1.0) * PI * 0.5)) * (1.0 - 0.35 * pow(t, 3.0))
		var wave := 1.0 + 0.28 * sin(_phase * TAU - t * 5.0)
		var seg_len := 0.09 * wave
		var mi := _segs[i]
		mi.position = Vector3(0, rad * 0.95, -0.5 + z)
		mi.scale = Vector3(rad * 2.0, rad * 1.9, seg_len * 2.0 + rad)
		z += seg_len
	var head: MeshInstance3D = _segs[0]
	var gut: Node3D = _body_root.get_node("gut")
	gut.position = Vector3(0, 0.1, -0.5 + z * 0.5)
	for s in [-1, 1]:
		var hook: Node3D = _body_root.get_node("hook_%d" % s)
		hook.position = head.position + Vector3(0.02 * s, -0.02, -0.06)
		hook.rotation = Vector3(-PI * 0.5 + (0.4 * sin(_phase * 8.0) if behavior == "comendo a polpa" else 0.0), 0, 0)


func _ray(from: Vector3, to: Vector3) -> Dictionary:
	var q := PhysicsRayQueryParameters3D.create(from, to, WORLD_MASK)
	return get_world_3d().direct_space_state.intersect_ray(q)


func _die(reason: String) -> void:
	dead = true
	behavior = "morta (" + reason + ")"
	if LifeManager.instance:
		LifeManager.instance.record_death(reason)
	_mat_dark()
	get_tree().create_timer(40.0).timeout.connect(queue_free)


func _mat_dark() -> void:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.45, 0.38, 0.28)
	for s in _segs:
		s.material_override = m


func crush() -> void:
	if not dead:
		_die("esmagada")


# manipulacao pelo espectador
func grab() -> void:
	_carried = true
	surface_body = null
	behavior = "sendo carregada!"


func carry_to(t: Transform3D) -> void:
	_carry_t = t


func release(_vel: Vector3) -> void:
	_carried = false
	var down := _ray(global_position, global_position + Vector3.DOWN * 3000.0)
	if down:
		_up = down.normal
		global_transform = Transform3D(Fly._basis_from(_up, -global_basis.z), down.position)
		_attach(down.collider)


func describe() -> String:
	return "Larva (geracao %d, %.1f mm) — %s" % [generation, size_mm, behavior]


func loom_radius() -> float:
	return size_mm
