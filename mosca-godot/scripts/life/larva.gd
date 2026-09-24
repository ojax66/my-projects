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
var brain   # GpuBrain (conectoma completo da larva) ou FlyBrain (subcircuito)
# fisiologia (mesmos orgaos basicos da mosca: papo/intestino, corpo gorduroso, traqueias)
var energy := 0.5
var gut := 0.0
var waste := 0.0
var health := 1.0
var pain := 0.0
var _touch := 0.0
var _roll_t := 0.0
var _roll_angle := 0.0
var _starve_t := 0.0
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
	brain = GpuBrain.create("larva")
	if brain == null:
		if FileAccess.file_exists(LARVA_BRAIN):
			brain = FlyBrain.from_json_file(LARVA_BRAIN)
		else:
			brain = FlyBrain.from_dict({"neurons": [], "edges": []})
	brain.set_mode(1)
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
	# corpo gorduroso (lobos brancos) e traqueias prateadas
	var fat_mat := StandardMaterial3D.new()
	fat_mat.albedo_color = Color(1.0, 0.98, 0.9)
	fat_mat.roughness = 0.5
	var tr_mat := StandardMaterial3D.new()
	tr_mat.albedo_color = Color(0.85, 0.88, 0.95)
	tr_mat.metallic = 0.6
	tr_mat.roughness = 0.2
	for s in [-1, 1]:
		var tr := MeshInstance3D.new()
		var tc := CapsuleMesh.new()
		tc.radius = 0.012
		tc.height = 0.9
		tr.mesh = tc
		tr.rotation_degrees = Vector3(90, 0, 0)
		tr.material_override = tr_mat
		tr.name = "trachea_%d" % s
		_body_root.add_child(tr)
		var fat := MeshInstance3D.new()
		var fm := SphereMesh.new()
		fm.radius = 0.05
		fm.height = 0.1
		fat.mesh = fm
		fat.scale = Vector3(1.0, 0.7, 3.5)
		fat.material_override = fat_mat
		fat.name = "fat_%d" % s
		_body_root.add_child(fat)
	# orgao de Bolwig (olhinhos) na cabeca
	var eye_mat := StandardMaterial3D.new()
	eye_mat.albedo_color = Color(0.08, 0.05, 0.04)
	for s in [-1, 1]:
		var eye := MeshInstance3D.new()
		var em := SphereMesh.new()
		em.radius = 0.013
		em.height = 0.026
		eye.mesh = em
		eye.material_override = eye_mat
		eye.name = "eye_%d" % s
		_body_root.add_child(eye)
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
	var cam := get_viewport().get_camera_3d() as Spectator
	brain.set_mode(0 if cam and cam.follow == self else 1)
	_check_crush()
	if dead:
		return
	_physiology(dt)
	if dead:
		return
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
	# rolamento nociceptivo (reflexo do cordao ventral: neuronios Goro/Basin,
	# que nao estao no conectoma do cerebro)
	if pain > 0.6 and _roll_t <= 0.0:
		_roll_t = 1.2
	if _roll_t > 0.0:
		_roll_t -= dt
		behavior = "rolando (dor!)"
		_roll_angle += dt * TAU * 2.5
		_body_root.rotation.z = _roll_angle
		_crawl(dt, 0.8 * size_mm, 0.0)
		_animate(dt, 3.0)
		return
	_body_root.rotation.z = lerpf(_body_root.rotation.z, 0.0, 0.2)
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
		gut = minf(gut + got * 3.0, 1.0)
		speed = 0.1 * size_mm
		turn = _turn_noise * 0.4
	else:
		behavior = "rastejando"
		var drive := clampf((m_crawl_l + m_crawl_r) * 0.5, 0.2, 1.5)
		speed = 0.35 * size_mm * drive * genome.get_gene("speed")
		# viragem: assimetria dos descendentes do conectoma + quimiotaxia
		turn = (m_crawl_l - m_crawl_r) * 1.5 + _odor_bias() * 2.0 * genome.get_gene("tropism") + _turn_noise * 0.7
	# toque leve: para e recua um pouco (resposta de Kernell)
	if _touch > 0.5 and not ready:
		speed = -0.3 * size_mm
		behavior = "recuando (tocada)"
	_crawl(dt, speed, turn)
	_animate(dt, speed / maxf(size_mm, 0.1))


func _physiology(dt: float) -> void:
	energy -= dt / 400.0
	var d := minf(gut, 0.02 * dt)
	gut -= d
	energy = minf(energy + d * 1.2, 1.0)
	waste += d * 0.5
	if waste > 0.06:
		waste = 0.0
		if LifeManager.instance:
			LifeManager.instance.drop_spot(global_position + global_basis.z * size_mm * 0.45, _up, surface_body)
	pain = maxf(0.0, pain - dt * 0.8)
	_touch = maxf(0.0, _touch - dt * 1.5)
	health = minf(1.0, health + dt / 300.0)
	if energy <= 0.0:
		energy = 0.0
		_starve_t += dt
		if _starve_t > 30.0:
			_die("fome (larva)")
	else:
		_starve_t = 0.0


func hurt(amount: float) -> void:
	pain = clampf(pain + amount, 0.0, 2.0)
	health -= amount * 0.4
	_touch = maxf(_touch, amount * 2.0)
	if health <= 0.0:
		_die("ferimentos (larva)")


func _check_crush() -> void:
	if Engine.get_physics_frames() < 600:
		return  # frutas ainda se acomodando no inicio do mundo
	var p := global_position + _up * size_mm * 0.15
	for n in get_tree().get_nodes_in_group("grabbable"):
		var rb := n as RigidBody3D
		if rb == null or rb == surface_body and rb.linear_velocity.length() < 250.0:
			continue
		var r: float = rb.call("loom_radius") if rb.has_method("loom_radius") else 20.0
		var c := rb.global_position
		var dist := p.distance_to(c) - r
		if dist > size_mm * 0.4:
			continue
		var towards := -rb.linear_velocity.dot((p - c).normalized())
		var above := (c - p).dot(_up) > r * 0.25
		if rb.mass >= Fly.CRUSH_MASS and (towards > 120.0 or (above and dist < 0.2)):
			crush()
			return
		if towards > 40.0:
			hurt(clampf(towards / 400.0, 0.05, 0.7))


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
	brain.set_input("gust_externo", taste)
	brain.set_input("gust_faringe", taste if behavior == "comendo a polpa" else 0.0)
	brain.set_input("dor", 200.0 * clampf(pain, 0.0, 1.0))
	brain.set_input("tato", 20.0 + 150.0 * _touch)
	brain.set_input("tato_ch", 10.0 + 100.0 * _touch)
	brain.set_input("proprio", 15.0 + 20.0 * absf(_last_speed))
	brain.set_input("intestino", 100.0 * gut)
	brain.set_input("co2", 60.0 * clampf(float(sense["odor_L"]) / 150.0, 0.0, 1.0))
	brain.set_input("calor", 40.0 * clampf(_up.y, 0.0, 1.0))
	brain.set_input("frio", 0.0)
	# larvas fogem da luz: exposta = superficie virada para o ceu
	var light := clampf(_up.y, 0.0, 1.0) * 80.0
	sense["light"] = light
	brain.set_input("light_L", light)
	brain.set_input("light_R", light)
	brain.set_input("luz_L", light)
	brain.set_input("luz_R", light)
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


var _last_speed := 0.0


func _crawl(dt: float, speed: float, turn: float) -> void:
	_last_speed = speed
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
	var gut_n: Node3D = _body_root.get_node("gut")
	gut_n.position = Vector3(0, 0.1, -0.5 + z * 0.5)
	gut_n.scale = Vector3.ONE * (0.7 + 0.6 * gut)
	for s in [-1, 1]:
		var tr: Node3D = _body_root.get_node("trachea_%d" % s)
		tr.position = Vector3(0.045 * s, 0.16, -0.5 + z * 0.5)
		var fat: Node3D = _body_root.get_node("fat_%d" % s)
		fat.position = Vector3(0.05 * s, 0.09, -0.5 + z * 0.6)
		fat.scale = Vector3(1.0, 0.7, 3.5) * (0.6 + 0.8 * energy)
		var eye: Node3D = _body_root.get_node("eye_%d" % s)
		eye.position = _segs[0].position + Vector3(0.03 * s, 0.04, 0.0)
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
	if brain and brain.has_method("free_gpu"):
		brain.free_gpu()
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
		_die("esmagada (larva)")
		_body_root.scale = Vector3(_body_root.scale.x * 1.3, _body_root.scale.y * 0.25, _body_root.scale.z)
		if LifeManager.instance:
			LifeManager.instance.splat(global_position, _up)


# manipulacao pelo espectador
func grab() -> void:
	_touch = 1.0
	pain = maxf(pain, 0.3)
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


func _exit_tree() -> void:
	if brain and brain.has_method("free_gpu"):
		brain.free_gpu()
