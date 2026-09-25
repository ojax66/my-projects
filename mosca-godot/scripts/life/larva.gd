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
var uid := 0
var mind: CreatureMemory        # comeca zerada; sobrevive a metamorfose
var wiring: Array = []
var parents: Array = []
var last_lesson := ""
var decision := "explorar"
var decision_scores := {}
var _decide_t := 0.0
var _target: Node3D = null
var _threat_obj: Object = null
var _dodge_t := 0.0
var _dodge_dir := Vector3.ZERO
var _taste_t := 0.0
var _hit_t := -99.0
# estagios (L1, L2, L3) separados por mudas de pele
var instar := 1
var instar_t := 0.0             # segundos neste estagio
var instar_food := 0.0          # polpa comida neste estagio
var molt_t := 0.0
# esconderijo: 0 = na superficie, 1 = enterrada (na polpa ou na terra)
var hidden := 0.0
var _hide_goal := 0.0
var _hide_t := 0.0
var _on_soil := false
var _last_threat_t := -999.0
var _site := Vector3.INF         # lugar escolhido para pupar
var _site_t := 0.0
var _dig_t := 0.0
var _mound: MeshInstance3D
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
var sense := {"odor_L": 0.0, "odor_R": 0.0, "taste": 0.0, "bitter": 0.0, "light": 0.0}
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
	if uid == 0:
		uid = LifeManager.instance.next_uid() if LifeManager.instance else randi()
	if wiring.size() < 3:
		wiring = LifeManager.instance.random_wiring() if LifeManager.instance else [randi(), randi(), randi()]
	if mind == null:
		mind = CreatureMemory.new()
	brain.set_wiring(int(wiring[0]), int(wiring[1]), int(wiring[2]), genome.get_gene("wiring_var"))
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
	_on_soil = surf is Node and (surf as Node).name == "ChaoColisao"
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
	var followed := cam != null and cam.follow == self
	brain.focused = followed
	brain.set_mode(0 if followed and Engine.time_scale <= 1.0 else 1)
	mind.decay(dt)
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

	# crescimento: cada estagio vai do tamanho inicial ao final conforme come
	instar_t += dt
	_update_size()

	var fruit := surface_body as Fruit if surface_body is Fruit else null
	var on_food := fruit != null and fruit.flesh > 0.0
	# rolamento nociceptivo (reflexo do cordao ventral: neuronios Goro/Basin,
	# que nao estao no conectoma do cerebro)
	if pain > 0.6 and _roll_t <= 0.0 and hidden < 0.5:
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
	# muda de pele (ecdise): para, sai da cuticula velha e passa ao proximo estagio
	if molt_t > 0.0:
		molt_t -= dt
		behavior = "trocando de pele (virando L%d)" % (instar + 1)
		if molt_t <= 0.0:
			_finish_molt()
		_update_hidden(dt)
		_animate(dt, 0.4)
		return
	if instar < 3 and instar_t >= float(LifeManager.INSTAR_DAYS[instar - 1]) * LifeManager.DAY \
			and instar_food >= float(LifeManager.INSTAR_FOOD[instar - 1]):
		molt_t = 40.0
		return
	_turn_noise = clampf(_turn_noise * (1.0 - dt * 0.5) + _rng.randfn() * sqrt(dt) * 0.8, -1.0, 1.0)
	_decide(dt, fruit, on_food)
	var speed := 0.0
	var turn := 0.0
	var crawl := 0.35 * size_mm * genome.get_gene("speed")
	if decision == "comer" and not on_food:
		decision = "procurar comida"
	_hide_goal = 0.0
	match decision:
		"desviar":
			# rasteja depressa para fora de onde a coisa vai cair
			_dodge_t -= dt
			behavior = "desviando de algo caindo!"
			speed = crawl * 4.0
			turn = _steer_to(global_position + _dodge_dir) * 3.0
		"pupar":
			var r := _pupation(dt)
			if r.is_empty():
				return   # virou pupa
			speed = r[0]
			turn = r[1]
		"comer":
			# come a polpa cavando para dentro da fruta: com medo ou com luz
			# (larvas fogem da luz) se enterra mais fundo
			_hide_goal = clampf(0.35 + 0.5 * mind.fall_fear + 0.3 * float(sense["light"]) / 80.0, 0.0, 0.9)
			behavior = "comendo dentro da polpa" if hidden > 0.5 else "comendo a polpa"
			var got := fruit.consume(0.00016 * size_mm * dt)
			food += got
			instar_food += got
			gut = minf(gut + got * 6.0, 1.0)
			speed = 0.05 * size_mm
			turn = _turn_noise * 0.4
			_taste_t -= dt
			if got > 0.0 and _taste_t <= 0.0:
				_taste_t = 2.0
				mind.learn_odor(fruit.memory_key(), 1.0, _learn_rate(), fruit.display_name)
				if LifeManager.instance:
					LifeManager.instance.report_taste(self, fruit, 1.0)
		"esconder":
			# cava um buraco na terra e fica la dentro ate o perigo passar
			_hide_goal = 1.0
			_hide_t += dt
			behavior = "cavando um buraco" if hidden < 0.9 else "escondida no buraco"
		"procurar comida":
			behavior = "procurando comida"
			speed = crawl * 2.5
			if is_instance_valid(_target):
				behavior = "indo ate %s" % _target.get("display_name")
				_leave_fruit_towards(_target.global_position)
				if _target is Fruit and _try_climb(_target as Fruit):
					behavior = "subindo na %s" % _target.get("display_name")
				else:
					turn = _steer_to(_target.global_position) * 2.0 + _turn_noise * 0.3
			else:
				turn = _odor_bias() * 2.5 + _turn_noise * 0.7
		"evitar":
			behavior = "saindo daqui (lembra que e ruim)"
			speed = crawl * 2.5
			var dz := mind.nearest_danger(global_position)
			if fruit and sense["bitter"] > 0.0:
				turn = _turn_noise * 1.5 + 1.0
			elif dz != Vector3.INF:
				turn = -_steer_to(dz) * 2.0
		_:
			behavior = "rastejando"
			var drive := clampf((m_crawl_l + m_crawl_r) * 0.5, 0.2, 1.5)
			speed = crawl * drive
			# viragem: assimetria dos descendentes do conectoma + quimiotaxia
			turn = (m_crawl_l - m_crawl_r) * 1.5 + _odor_bias() * 2.0 * genome.get_gene("tropism") + _turn_noise * 0.7
	if decision != "esconder":
		_hide_t = maxf(0.0, _hide_t - dt * 0.5)
	# toque leve: para e recua um pouco (resposta de Kernell)
	if _touch > 0.5 and decision != "desviar" and decision != "pupar" and hidden < 0.5:
		speed = -0.3 * size_mm
		behavior = "recuando (tocada)"
	_update_hidden(dt)
	# enterrada nao anda: primeiro sai do buraco
	if hidden > 0.25 and _hide_goal < hidden and decision != "comer":
		speed = 0.0
		behavior = "saindo do esconderijo"
	elif hidden > 0.6 and decision != "comer":
		speed = 0.0
	_crawl(dt, speed, turn)
	_animate(dt, speed / maxf(size_mm, 0.1))


func _update_size() -> void:
	var sz: Array = LifeManager.INSTAR_SIZE[instar - 1]
	var need: float = LifeManager.INSTAR_FOOD[instar - 1]
	size_mm = lerpf(float(sz[0]), float(sz[1]), clampf(instar_food / need, 0.0, 1.0)) * genome.get_gene("size")
	_body_root.scale = Vector3.ONE * size_mm


func _finish_molt() -> void:
	# deixa a cuticula velha (exuvia) para tras
	var ex := MeshInstance3D.new()
	var cap := CapsuleMesh.new()
	cap.radius = size_mm * 0.12
	cap.height = size_mm * 0.9
	ex.mesh = cap
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.95, 0.93, 0.85, 0.35)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.roughness = 0.2
	ex.material_override = m
	var parent: Node = surface_body if is_instance_valid(surface_body) else get_parent()
	parent.add_child(ex)
	ex.global_transform = Transform3D(global_basis * Basis(Vector3.RIGHT, PI * 0.5), global_position + _up * size_mm * 0.1)
	get_tree().create_timer(LifeManager.DAY * 0.5, false).timeout.connect(ex.queue_free)
	instar += 1
	instar_t = 0.0
	instar_food = 0.0
	last_lesson = "trocou de pele: agora e L%d" % instar


## Enterra/desenterra aos poucos (na polpa ou na terra).
func _update_hidden(dt: float) -> void:
	var prev := hidden
	hidden = move_toward(hidden, _hide_goal, dt / (12.0 if _on_soil else 6.0))
	_body_root.position.y = -hidden * size_mm * 0.3
	if _on_soil and hidden > 0.3 and _mound == null:
		_mound = MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 1.0
		sm.height = 0.5
		sm.radial_segments = 10
		sm.rings = 4
		_mound.mesh = sm
		var mm := StandardMaterial3D.new()
		mm.albedo_color = Color(0.3, 0.22, 0.14)
		mm.roughness = 1.0
		_mound.material_override = mm
		add_child(_mound)
	if _mound:
		_mound.scale = Vector3(size_mm * 0.45, size_mm * 0.35, size_mm * 0.6) * clampf(hidden * 1.5, 0.0, 1.0)
		if hidden < 0.1 and prev >= 0.1:
			# saiu: fica o buraco
			if LifeManager.instance:
				LifeManager.instance.make_hole(global_position, _up, size_mm)
			_mound.queue_free()
			_mound = null


## L3 errante: escolhe um lugar seguro, vai ate la e pupa (enterrada, se for
## terra). Retorna [velocidade, giro] enquanto procura, ou [] se ja pupou.
func _pupation(dt: float) -> Array:
	_wander_t += dt
	_site_t -= dt
	if _site == Vector3.INF or _site_t <= 0.0:
		_site = _choose_site()
		_site_t = 90.0
	var to := _site - global_position
	to.y = 0.0
	var crawl := 0.35 * size_mm * genome.get_gene("speed")
	if to.length() > size_mm * 2.0 and _wander_t < 0.4 * LifeManager.DAY and _dig_t <= 0.0:
		behavior = "L3 errante: indo ate um lugar seguro para pupar"
		_leave_fruit_towards(_site)
		return [crawl * 2.0, _steer_to(_site) * 2.0 + _turn_noise * 0.2]
	if _on_soil:
		_hide_goal = 0.7
		behavior = "cavando para pupar enterrada"
		_dig_t += dt
		if hidden >= 0.65:
			_become_pupa()
			return []
	else:
		behavior = "grudando na superficie para pupar"
		_dig_t += dt
		if _dig_t > 20.0:
			_become_pupa()
			return []
	return [0.0, 0.0]


## Na lateral de uma fruta, querendo ir para outro lugar: se solta e cai no
## chao (larvas fazem isso) em vez de ficar dando voltas na fruta.
func _leave_fruit_towards(goal: Vector3) -> void:
	var fr := surface_body as Fruit
	if fr == null or _up.y > 0.35:
		return
	if goal.distance_to(fr.global_position) < fr.radius + 5.0:
		return
	var q := PhysicsRayQueryParameters3D.create(global_position, global_position + Vector3.DOWN * 3000.0, WORLD_MASK, [fr.get_rid()])
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if hit:
		var fwd := goal - global_position
		fwd.y = 0.0
		_up = hit.normal
		global_transform = Transform3D(Fly._basis_from(_up, fwd if fwd.length() > 0.1 else Vector3.FORWARD), hit.position)
		_attach(hit.collider)


func _become_pupa() -> void:
	if LifeManager.instance:
		LifeManager.instance.pupate(self)
	queue_free()


## Lugar para pupar: longe de perigos lembrados, fora da area onde caem
## frutas das arvores (pesa mais com o medo aprendido), fora da comida
## (vai ser pisada e comida), na sombra e perto.
func _choose_site() -> Vector3:
	var gw := GardenWorld.instance
	var best := global_position
	var best_s := -INF
	var hanging: Array = []
	for n in get_tree().get_nodes_in_group("grabbable"):
		if n is Fruit and (n as Fruit).hanging:
			hanging.append((n as Fruit).global_position)
	var fruits := get_tree().get_nodes_in_group("odor_source")
	for k in 13:
		var p := global_position
		if k > 0:
			var a := _rng.randf() * TAU
			p += Vector3(cos(a), 0, sin(a)) * _rng.randf_range(40.0, 320.0)
		if Vector2(p.x, p.z).length() > 2400.0:
			continue
		if gw:
			p.y = gw.height_at(p.x, p.z)
		var sc := -2.0 * mind.danger_at(p) - global_position.distance_to(p) / 700.0
		var risk := 0.0
		for h: Vector3 in hanging:
			if h.y > p.y and Vector2(h.x - p.x, h.z - p.z).length() < 180.0:
				risk += 0.35
		sc -= minf(risk, 1.5) * (0.4 + 1.5 * mind.fall_fear)
		for f in fruits:
			if (f as Node3D).global_position.distance_to(p) < 70.0:
				sc -= 0.6
				break
		if gw and gw.sun:
			var q := PhysicsRayQueryParameters3D.create(p + Vector3.UP * 3.0, p + gw.sun.global_basis.z * 3000.0, WORLD_MASK)
			if get_world_3d().direct_space_state.intersect_ray(q):
				sc += 0.3   # sombra
		if sc > best_s:
			best_s = sc
			best = p
	return best


## Selecao de acao da larva (mesma ideia da mosca): fome, medo, memoria e
## sentidos dao a utilidade de cada opcao; o conectoma continua gerando o
## rastejar e a vontade de comer (DN-SEZ).
func _decide(dt: float, fruit: Fruit, on_food: bool) -> void:
	# ameaca: algo caindo onde ela esta (sente a sombra/vibracao)
	var th := Hazards.threat(global_position, size_mm + 6.0)
	if not th.is_empty() and th["obj"] != _threat_obj:
		_threat_obj = th["obj"]
		_last_threat_t = age
		var p_react := clampf(0.12 + 0.85 * mind.fall_fear, 0.0, 0.95)
		if hidden < 0.6 and _rng.randf() < p_react:
			decision = "desviar"
			_dodge_t = 1.5
			_dodge_dir = th["away"]
	if decision == "desviar" and _dodge_t > 0.0:
		return
	_decide_t -= dt
	if _decide_t > 0.0 and decision != "desviar":
		return
	_decide_t = 0.5
	var ready := instar == 3 and instar_t >= float(LifeManager.INSTAR_DAYS[2]) * LifeManager.DAY \
			and instar_food >= float(LifeManager.INSTAR_FOOD[2])
	var hunger := clampf(1.0 - energy, 0.0, 1.0)
	var need: float = LifeManager.INSTAR_FOOD[instar - 1]
	var sc := {"explorar": 0.25}
	if ready:
		sc["pupar"] = 1.4
	var sweet := on_food and float(fruit.taste().get("sugar", 0.0)) > 0.0 and float(fruit.taste().get("bitter", 0.0)) <= 0.0
	if sweet and not ready:
		# larvas comem quase sem parar: precisam de dias de comida para crescer
		sc["comer"] = 0.7 + hunger + 0.4 * m_feed + (0.4 if instar_food < need else 0.0)
	if not ready and (not on_food or not sweet):
		var best := _best_food()
		_target = best[0] if best.size() > 0 else null
		sc["procurar comida"] = (0.4 + hunger) * (1.0 if _target else 0.6)
	var dz := mind.danger_at(global_position)
	var bad := 0.0
	if on_food and float(fruit.taste().get("bitter", 0.0)) > 0.0:
		bad = 1.0
	sc["evitar"] = maxf(dz * 1.2, bad)
	if _on_soil and not ready:
		# cavar e se esconder: medo aprendido, ameaca recente e luz (fotofobia);
		# a fome e o tempo escondida tiram a vontade
		var recent := 0.6 if age - _last_threat_t < 20.0 else 0.0
		sc["esconder"] = 0.9 * mind.fall_fear + recent + 0.2 * float(sense["light"]) / 80.0 + dz * 0.5 \
			- 0.8 * hunger - _hide_t / 120.0
	var pick := decision if sc.has(decision) else "explorar"
	var pick_v := float(sc.get(pick, 0.0)) + 0.1
	for k: String in sc:
		if float(sc[k]) > pick_v:
			pick_v = sc[k]
			pick = k
	decision = pick
	decision_scores = sc


func _best_food() -> Array:
	var best: Node3D = null
	var best_v := 0.02
	for src in get_tree().get_nodes_in_group("odor_source"):
		var fr := src as Fruit
		if fr == null or fr.hanging or fr.flesh <= 0.02:
			continue
		var d := fr.global_position.distance_to(global_position)
		if d > 700.0:
			continue
		var pr := mind.predict(fr.memory_key())
		var expected := pr.x * pr.y + (1.0 - pr.y) * 0.4
		var v := expected - d / 1200.0 - 1.2 * mind.danger_at(fr.global_position)
		if v > best_v:
			best_v = v
			best = fr
	return [best, best_v] if best else []


func _steer_to(p: Vector3) -> float:
	var to := p - global_position
	to -= _up * to.dot(_up)
	if to.length() < 0.01:
		return 0.0
	return clampf(-global_basis.x.normalized().dot(to.normalized()) * 2.0, -1.5, 1.5)


func _learn_rate() -> float:
	return clampf(0.3 * genome.get_gene("learning"), 0.05, 0.8)


func sight_range() -> float:
	return 150.0   # olhinhos de Bolwig + vibracao do substrato


func observe_death(pos: Vector3, reason: String, _obj: Object, _victim: Node) -> void:
	if reason.begins_with("esmagad"):
		mind.scare(0.45)
		mind.add_danger(pos, 120.0, 0.8, "sentiu alguem ser esmagado")
		last_lesson = "sentiu um vizinho ser esmagado: agora desvia de coisas caindo"
	elif reason.begins_with("ferimentos"):
		mind.add_danger(pos, 100.0, 0.5, "viu alguem se ferir")


func observe_taste(fruit: Node3D, us: float) -> void:
	if is_instance_valid(fruit):
		mind.learn_odor(fruit.call("memory_key"), us, _learn_rate() * 0.3, str(fruit.get("display_name")), true)


## Metabolismo em escala de dias: a reserva (corpo gorduroso) dura ~1-2 dias
## sem comer; a larva cresce so comendo (ver _update_size).
func _physiology(dt: float) -> void:
	energy -= 0.0006 * size_mm * genome.get_gene("metabolism") * dt
	var d := minf(gut, 0.005 * dt)
	gut -= d
	energy = minf(energy + d, 1.0)
	waste += d * 0.3
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
		if _starve_t > 0.2 * LifeManager.DAY:
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
	if Engine.get_physics_frames() < 180:
		return  # frutas ainda se acomodando no inicio do mundo
	if hidden >= 0.6:
		return  # enterrada na polpa ou na terra: protegida
	Hazards.refresh(get_tree())
	var r := Hazards.check(global_position, size_mm * 0.25, size_mm * 0.5, surface_body)
	if r.is_empty():
		return
	if r.has("crush"):
		crush(r["crush"])
		return
	if age - _hit_t < 0.6:
		return   # a mesma batida nao conta a cada tick
	_hit_t = age
	hurt(float(r["hit"]))
	mind.add_danger(global_position, 100.0, float(r["hit"]), "levou uma batida")
	mind.scare(float(r["hit"]) * 0.5)


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
	var bitter := 0.0
	if surface_body is Fruit:
		taste = 150.0 * float((surface_body as Fruit).taste().get("sugar", 0.0))
		bitter = 150.0 * float((surface_body as Fruit).taste().get("bitter", 0.0))
		if bitter > 0.0:
			_taste_t -= 0.1
			if _taste_t <= 0.0:
				_taste_t = 2.0
				mind.learn_odor((surface_body as Fruit).memory_key(), -1.0, _learn_rate(), (surface_body as Fruit).display_name)
				last_lesson = "provou %s: amargo!" % (surface_body as Fruit).display_name
	sense["taste"] = taste
	sense["bitter"] = bitter
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
	var light := clampf(_up.y, 0.0, 1.0) * 80.0 * (GardenWorld.instance.daylight() if GardenWorld.instance else 1.0)
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


## Encostou (ou esta por baixo) de uma fruta: sobe nela pelo ponto mais
## proximo da superficie, em vez de ficar rodando embaixo.
func _try_climb(fr: Fruit) -> bool:
	if surface_body == fr or not is_instance_valid(fr):
		return false
	var from := global_position + _up * 0.3
	var q := PhysicsRayQueryParameters3D.create(from, fr.global_position, WORLD_MASK)
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if not hit or hit.collider != fr:
		return false
	if from.distance_to(hit.position) > size_mm * 1.5 + 3.0:
		return false
	var fwd := -global_basis.z
	_up = (hit.normal as Vector3).normalized()
	global_transform = Transform3D(Fly._basis_from(_up, fwd - _up * fwd.dot(_up) if absf(fwd.dot(_up)) < 0.95 else _up.cross(Vector3.RIGHT)), hit.position)
	_attach(fr)
	return true


func _crawl(dt: float, speed: float, turn: float) -> void:
	_last_speed = speed
	var up := _up.normalized()
	var b := Basis(up, turn * dt) * global_basis.orthonormalized()
	var fwd := -b.z
	var pos := global_position
	# obstaculo na frente (lateral de fruta, pedra): sobe nele, como a mosca
	if speed > 0.0:
		var probe := _ray(pos + up * size_mm * 0.3, pos + up * size_mm * 0.3 + fwd * (speed * dt + size_mm * 0.6))
		if probe and (probe.normal as Vector3).dot(up) < 0.7:
			_up = (probe.normal as Vector3).normalized()
			global_transform = Transform3D(Fly._basis_from(_up, up), probe.position)
			_attach(probe.collider)
			return
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


func _die(reason: String, cause: Object = null) -> void:
	if dead:
		return
	dead = true
	behavior = "morta (" + reason + ")"
	if LifeManager.instance:
		LifeManager.instance.report_death(self, reason, cause)
	if brain and brain.has_method("free_gpu"):
		brain.free_gpu()
	_mat_dark()
	get_tree().create_timer(40.0).timeout.connect(queue_free)


func _mat_dark() -> void:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.45, 0.38, 0.28)
	for s in _segs:
		s.material_override = m


func crush(obj: Object = null) -> void:
	if not dead:
		_die("esmagada (larva)", obj)
		_body_root.scale = Vector3(_body_root.scale.x * 1.3, _body_root.scale.y * 0.25, _body_root.scale.z)
		if LifeManager.instance:
			LifeManager.instance.splat(global_position, _up)


# manipulacao pelo espectador
func grab() -> void:
	hidden = 0.0
	_hide_goal = 0.0
	_body_root.position.y = 0.0
	if _mound:
		_mound.queue_free()
		_mound = null
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
	return "Larva L%d (geracao %d, %.1f mm, dia %.1f do estagio) — %s" % [instar, generation, size_mm, instar_t / LifeManager.DAY, behavior]


func loom_radius() -> float:
	return size_mm


func _exit_tree() -> void:
	if brain and brain.has_method("free_gpu"):
		brain.free_gpu()
