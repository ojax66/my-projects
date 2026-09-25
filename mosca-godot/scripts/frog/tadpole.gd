class_name Tadpole
extends Node3D
## Girino com o conectoma sintetico do girino (brain/full/girino.*, regras de
## Roberts et al. para o Xenopus) na GPU.
##
##  - nada ondulando a cauda: motoneuronios esquerdo/direito (swim_L/R) dao a
##    forca e a curva; o reticulospinal inicia, o MHR para (cabeca encostou)
##  - linha lateral sente ondas na agua (algo caindo, uma ra nadando, sua mao);
##    a celula de Mauthner dispara a fuga em C para o lado oposto
##  - sombra por cima (pineal/retina) tambem faz nadar e fugir
##  - raspa algas com o bico corneo (CPG da boca); cresce so comendo
##  - metamorfose em dias: patas traseiras, depois dianteiras, a cauda e
##    reabsorvida, sai do lago e vira uma ra jovem (parte da memoria fica)

const DAY := GardenWorld.DAY_LENGTH
const GROW_DAYS := 6.0           # minimo de dias ate estar pronto
const CLIMAX_DAYS := 1.0         # metamorfose final (nao come)

var pond: Pond
var uid := 0
var genome: Genome
var generation := 1
var lineage := 0
var parents: Array = []
var wiring: Array = []
var mind: CreatureMemory
var brain
var age := 0.0
var growth := 0.0                # 0 recem-eclodido .. 1 pronto para a metamorfose
var climax := 0.0                # 0..1 durante a metamorfose
var energy := 0.6
var health := 1.0
var pain := 0.0
var dead := false
var behavior := "nadando"
var decision := "explorar"
var decision_scores := {}
var last_lesson := ""
var velocity := Vector3.ZERO
var sense := {"linha_lateral_L": 0.0, "linha_lateral_R": 0.0, "sombra": 0.0}

var _rng := RandomNumberGenerator.new()
var _decide_t := 0.0
var _target: Node3D = null
var _escape_t := 0.0
var _escape_dir := Vector3.ZERO
var _tail_ph := 0.0
var _carried := false
var _carry_t := Transform3D.IDENTITY
var _reward_t := 0.0
var _punish_t := 0.0
var _bump := 0.0
var _feeding := 0.0
var _last_ll := 0.0
var _hit_t := -99.0
var _body: Node3D
var _tail: Array[MeshInstance3D] = []
var _legs_h: Array[MeshInstance3D] = []
var _legs_f: Array[MeshInstance3D] = []
static var _mat: StandardMaterial3D


func _ready() -> void:
	_rng.randomize()
	add_to_group("tadpoles")
	add_to_group("creatures")
	if genome == null:
		genome = Genome.random_founder(_rng)
	if uid == 0:
		uid = LifeManager.instance.next_uid() if LifeManager.instance else randi()
	if wiring.size() < 3:
		wiring = LifeManager.instance.random_wiring() if LifeManager.instance else [randi(), randi(), randi()]
	if mind == null:
		mind = CreatureMemory.new()
	if pond == null:
		pond = Pond.nearest(global_position)
	brain = GpuBrain.create("girino")
	if brain == null:
		brain = FlyBrain.from_dict(DefaultCircuit.build())
	brain.set_wiring(int(wiring[0]), int(wiring[1]), int(wiring[2]), genome.get_gene("wiring_var"))
	brain.set_mode(1)
	_build_body()
	var area := Area3D.new()
	area.collision_layer = 4
	area.collision_mask = 0
	area.monitoring = false
	var cs := CollisionShape3D.new()
	var sh := SphereShape3D.new()
	sh.radius = 6.0
	cs.shape = sh
	area.add_child(cs)
	area.set_meta("creature", self)
	add_child(area)


func body_len() -> float:
	# comprimento total (cauda inclusa): 8 mm recem-eclodido ate ~40 mm
	return lerpf(8.0, 40.0, growth) * genome.get_gene("size") * (1.0 - 0.45 * climax)


func _exit_tree() -> void:
	if brain and brain.has_method("free_gpu"):
		brain.free_gpu()


func _build_body() -> void:
	if _mat == null:
		_mat = StandardMaterial3D.new()
		_mat.albedo_color = Color(0.22, 0.2, 0.12)
		_mat.roughness = 0.3
		_mat.clearcoat_enabled = true
		_mat.clearcoat = 0.7
	_body = Node3D.new()
	add_child(_body)
	var sph := SphereMesh.new()
	sph.radius = 0.5
	sph.height = 1.0
	sph.radial_segments = 14
	sph.rings = 7
	var head := MeshInstance3D.new()
	head.mesh = sph
	head.material_override = _mat
	head.scale = Vector3(0.28, 0.22, 0.36)
	head.position = Vector3(0, 0, -0.3)
	head.name = "cabeca"
	_body.add_child(head)
	var eye_m := StandardMaterial3D.new()
	eye_m.albedo_color = Color(0.7, 0.6, 0.3)
	for s in [-1, 1]:
		var e := MeshInstance3D.new()
		e.mesh = sph
		e.material_override = eye_m
		e.scale = Vector3.ONE * 0.06
		e.position = Vector3(0.1 * s, 0.07, -0.4)
		_body.add_child(e)
	var fin := StandardMaterial3D.new()
	fin.albedo_color = Color(0.35, 0.33, 0.25, 0.7)
	fin.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	for i in 7:
		var t := MeshInstance3D.new()
		t.mesh = sph
		t.material_override = _mat if i < 2 else fin
		_body.add_child(t)
		_tail.append(t)
	var leg_m := _mat
	for s in [-1, 1]:
		var lh := MeshInstance3D.new()
		lh.mesh = sph
		lh.material_override = leg_m
		_body.add_child(lh)
		_legs_h.append(lh)
		var lf := MeshInstance3D.new()
		lf.mesh = sph
		lf.material_override = leg_m
		_body.add_child(lf)
		_legs_f.append(lf)


# ---------------------------------------------------------------- principal
func _physics_process(dt: float) -> void:
	if dead or dt <= 0.0:
		return
	age += dt
	if _carried:
		global_transform = global_transform.interpolate_with(_carry_t, 1.0 - exp(-dt * 20.0))
		pain = maxf(pain, 0.2)
		_animate(dt, 3.0)
		return
	var cam := get_viewport().get_camera_3d() as Spectator
	var followed := cam != null and cam.follow == self
	brain.focused = followed
	brain.set_mode(0 if followed and Engine.time_scale <= 1.0 else 1)
	mind.decay(dt)
	_reward_t = maxf(0.0, _reward_t - dt)
	_punish_t = maxf(0.0, _punish_t - dt)
	_physiology(dt)
	if dead:
		return
	if pond == null or not is_instance_valid(pond):
		pond = Pond.nearest(global_position)
	if pond == null or not pond.contains(global_position):
		# fora d'agua: resseca e morre (se nao for a hora da metamorfose)
		health -= dt / 60.0
		behavior = "fora d'agua!"
		if health <= 0.0:
			_die("fora d'agua (girino)")
		return
	_sense(dt)
	brain.advance(dt)
	_decide(dt)
	_move(dt)


func _physiology(dt: float) -> void:
	energy -= dt / (1.5 * DAY) * genome.get_gene("metabolism")
	pain = maxf(0.0, pain - dt)
	health = minf(1.0, health + dt / 600.0)
	if growth >= 1.0 and climax < 1.0:
		# metamorfose: a cauda e reabsorvida (energia vem dela), nao come
		climax = minf(1.0, climax + dt / (CLIMAX_DAYS * DAY))
		energy = maxf(energy, 0.3)
		if climax >= 1.0:
			_become_frog()
			return
	if energy <= 0.0:
		energy = 0.0
		health -= dt / (0.3 * DAY)
		if health <= 0.0:
			_die("fome (girino)")


func _become_frog() -> void:
	if LifeManager.instance:
		LifeManager.instance.tadpole_metamorphosis(self)
	queue_free()


func _die(reason: String, cause: Object = null) -> void:
	if dead:
		return
	dead = true
	behavior = "morto (%s)" % reason
	_body.rotation.z = PI
	if LifeManager.instance:
		LifeManager.instance.report_death(self, reason, cause)
	get_tree().create_timer(DAY * 0.3, false).timeout.connect(queue_free)


func eaten(by: Node) -> void:
	_die("comido por uma ra", by)
	set_physics_process(false)


# ---------------------------------------------------------------- sentidos
func _sense(dt: float) -> void:
	var right := global_basis.x.normalized()
	var ll_l := 0.0
	var ll_r := 0.0
	var shadow := 0.0
	# linha lateral: qualquer coisa se mexendo rapido na agua perto
	var movers: Array = []
	for n in get_tree().get_nodes_in_group("frogs"):
		var f := n as Node3D
		movers.append([f.global_position, f.get("velocity") as Vector3, f.call("loom_radius")])
	for n in get_tree().get_nodes_in_group("grabbable"):
		var rb := n as RigidBody3D
		if rb and not rb.freeze and rb.linear_velocity.length() > 40.0:
			movers.append([rb.global_position, rb.linear_velocity, rb.call("loom_radius") if rb.has_method("loom_radius") else 20.0])
	var cam := get_viewport().get_camera_3d() as Spectator
	if cam and cam.follow != self:
		movers.append([cam.global_position, cam.cam_velocity, 40.0])
	for m: Array in movers:
		var p: Vector3 = m[0]
		var v: Vector3 = m[1]
		var r: float = m[2]
		var d := maxf(p.distance_to(global_position) - r, 1.0)
		if d > 300.0:
			continue
		var in_water := pond.contains(p) and p.y < pond.level + r
		var k := v.length() * (1.0 if in_water else 0.25) * (60.0 / (d + 30.0))
		if right.dot(p - global_position) < 0.0:
			ll_l = maxf(ll_l, k)
		else:
			ll_r = maxf(ll_r, k)
		if p.y > global_position.y and Vector2(p.x - global_position.x, p.z - global_position.z).length() < r * 2.0 + 30.0:
			shadow = maxf(shadow, clampf(r / d * 200.0, 0.0, 200.0))
	ll_l = clampf(ll_l, 0.0, 200.0)
	ll_r = clampf(ll_r, 0.0, 200.0)
	sense["linha_lateral_L"] = ll_l
	sense["linha_lateral_R"] = ll_r
	sense["sombra"] = shadow
	var dl := GardenWorld.instance.daylight() if GardenWorld.instance else 1.0
	var hunger := clampf(1.0 - energy, 0.0, 1.0)
	brain.set_input("linha_lateral_L", ll_l)
	brain.set_input("linha_lateral_R", ll_r)
	brain.set_input("sombra_L", shadow)
	brain.set_input("sombra_R", shadow)
	brain.set_input("escuro_pineal", shadow * 0.8)
	brain.set_input("luz_L", 20.0 + 80.0 * dl)
	brain.set_input("luz_R", 20.0 + 80.0 * dl)
	brain.set_input("fome", 90.0 * hunger)
	brain.set_input("glicose", 100.0 * energy)
	brain.set_input("paladar_bom", 140.0 * _feeding)
	brain.set_input("paladar_ruim", 0.0)
	brain.set_input("reward", 120.0 if _reward_t > 0.0 else 0.0)
	brain.set_input("punish", 140.0 if _punish_t > 0.0 else 0.0)
	brain.set_input("dor", 200.0 * clampf(pain, 0.0, 1.0))
	brain.set_input("tato_cabeca", 150.0 * _bump)
	brain.set_input("tato_L", 0.0)
	brain.set_input("tato_R", 0.0)
	var ex := 60.0 if decision in ["comer", "esconder", "subir para a margem"] else 30.0
	brain.set_input("explore_L", ex + _rng.randf() * 15.0)
	brain.set_input("explore_R", ex + _rng.randf() * 15.0)
	_bump = maxf(0.0, _bump - dt * 3.0)
	# o que chega na linha lateral de repente assusta (e ensina o lugar)
	var ll := maxf(ll_l, ll_r)
	if ll > 120.0 and _last_ll <= 120.0:
		mind.add_danger(global_position, 80.0, 0.15, "agitacao na agua")
	_last_ll = ll


# ---------------------------------------------------------------- decisao
func _decide(dt: float) -> void:
	var esc_l: float = brain.output("escape_L")
	var esc_r: float = brain.output("escape_R")
	if (esc_l > 0.6 or esc_r > 0.6 or maxf(sense["linha_lateral_L"], sense["linha_lateral_R"]) > 150.0) and _escape_t <= 0.0:
		# C-start: Mauthner de um lado contrai o lado oposto -> vira para longe
		var side := -1.0 if (esc_l > esc_r or sense["linha_lateral_L"] > sense["linha_lateral_R"]) else 1.0
		_escape_dir = (global_basis.x * side * 1.0 - global_basis.z * 0.3).normalized()
		_escape_t = 0.6
		decision = "fugir"
		behavior = "FUGA (Mauthner)!"
		mind.scare(0.05)
		return
	_decide_t -= dt
	if _decide_t > 0.0:
		return
	_decide_t = 0.5
	var hunger := clampf(1.0 - energy, 0.0, 1.0)
	var sc := {"explorar": 0.25}
	if climax <= 0.0:
		var best := _best_food()
		_target = best[0] if best.size() > 0 else null
		if _target:
			var d := _target.global_position.distance_to(global_position)
			sc["comer"] = (0.5 + hunger * 1.2) * (1.5 if d < body_len() * 0.8 else 1.0)
	else:
		sc["subir para a margem"] = climax * 2.0
	sc["esconder"] = mind.fall_fear * 0.8 + mind.danger_at(global_position) * 0.8
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
	var best_v := 0.05
	for a: Algae in pond.algae:
		if a.biomass < 0.05:
			continue
		var d := a.global_position.distance_to(global_position)
		var pv := mind.predict(a.food_key())
		var v := a.biomass * (0.6 + pv.x * pv.y) - d / 1200.0 - mind.danger_at(a.global_position)
		if v > best_v:
			best_v = v
			best = a
	# restos de fruta caidos na agua tambem sao comida
	for n in get_tree().get_nodes_in_group("odor_source"):
		var fr := n as Fruit
		if fr and not fr.hanging and pond.contains(fr.global_position) and fr.flesh > 0.05:
			var d := fr.global_position.distance_to(global_position)
			var v := 0.5 - d / 1200.0
			if v > best_v:
				best_v = v
				best = fr
	return [best, best_v] if best else []


# ---------------------------------------------------------------- nado
func _move(dt: float) -> void:
	var len := body_len()
	var mn_l: float = brain.output("swim_L")
	var mn_r: float = brain.output("swim_R")
	var drive := clampf(mn_l + mn_r, 0.0, 2.0)
	var goal := Vector3.INF
	var spd := 0.0
	_feeding = maxf(0.0, _feeding - dt)
	match decision:
		"fugir":
			_escape_t -= dt
			spd = len * 9.0
			goal = global_position + _escape_dir * 100.0
			if _escape_t <= 0.0:
				decision = "esconder"
		"comer":
			if is_instance_valid(_target):
				goal = _target.global_position + Vector3.UP * 2.0
				var d := goal.distance_to(global_position)
				if d < len * 0.6:
					spd = len * 0.3
					var got := 0.0
					if _target is Algae:
						got = (_target as Algae).graze(0.00006 * len * dt * (0.5 + brain.output("feed")))
					elif _target is Fruit:
						got = (_target as Fruit).consume(0.00003 * len * dt)
					if got > 0.0:
						_eat(got, dt)
					behavior = "raspando algas" if _target is Algae else "comendo fruta na agua"
				else:
					spd = len * (1.2 + drive)
					behavior = "nadando ate a comida"
		"subir para a margem":
			behavior = "metamorfose: saindo do lago (%d%%)" % int(climax * 100)
			goal = pond.shore_point(global_position)
			spd = len * 0.8
			if pond.depth_at(global_position) < len * 0.4 and climax > 0.95:
				_become_frog()
				return
		"esconder":
			behavior = "escondido no fundo"
			var deep := Vector3(pond.center.x, pond.level - pond.depth * 0.9, pond.center.y)
			goal = deep
			spd = len * 0.8
		_:
			behavior = "nadando" if drive > 0.2 else "parado na agua"
			spd = len * (0.4 + drive * 1.5)
	# o conectoma curva a cauda: diferenca entre os lados vira giro
	var turn: float = (mn_r - mn_l) * 0.8
	var fwd := -global_basis.z
	if goal != Vector3.INF:
		var to := (goal - global_position)
		if to.length() > 0.5:
			var tn := to.normalized()
			var yaw := fwd.signed_angle_to(Vector3(tn.x, 0, tn.z), Vector3.UP)
			turn = clampf(yaw * 3.0, -4.0, 4.0) + turn * 0.3
			var pitch_goal := asin(clampf(tn.y, -0.8, 0.8))
			rotation.x = lerpf(rotation.x, pitch_goal, 1.0 - exp(-dt * 3.0))
	rotate_y(turn * dt)
	fwd = -global_basis.z
	velocity = velocity.lerp(fwd * spd, 1.0 - exp(-dt * 4.0))
	var np := global_position + velocity * dt
	# fica dentro d'agua: entre o fundo e a superficie, longe da margem
	var ground := GardenWorld.instance.height_at(np.x, np.z) if GardenWorld.instance else pond.level - pond.depth
	var lo := ground + len * 0.12
	var hi := pond.level - len * 0.1
	if hi - lo < len * 0.15 and decision != "subir para a margem":
		_bump = 1.0   # encostou na margem: MHR para, vira
		rotate_y(PI * 0.6 * dt * 5.0)
		np = global_position
	np.y = clampf(np.y, lo, maxf(hi, lo))
	global_position = np
	_animate(dt, spd / maxf(len, 0.1))


func _eat(got: float, dt: float) -> void:
	energy = minf(1.0, energy + got * 18.0)
	# cresce so com comida e com o tempo (comendo sempre: ~GROW_DAYS dias)
	growth = minf(1.0, growth + minf(got * 6.0, dt / (GROW_DAYS * DAY) * 1.2))
	_feeding = 1.0
	if _rng.randf() < 0.02:
		_reward_t = 0.5
		mind.learn_odor((_target as Node).call("food_key") if _target.has_method("food_key") else (_target as Fruit).memory_key(), 1.0, 0.1, "alga" if _target is Algae else "fruta")


# ---------------------------------------------------------------- animacao
func _animate(dt: float, rel_speed: float) -> void:
	var len := body_len()
	_body.scale = Vector3.ONE * len
	_tail_ph += dt * (3.0 + rel_speed * 2.5)
	var tail_len := 0.62 * (1.0 - climax)
	var n := _tail.size()
	for i in n:
		var t := float(i + 1) / n
		var amp := 0.06 + 0.12 * t
		var z := -0.12 + t * tail_len
		var x := sin(_tail_ph * TAU * 0.5 - t * 4.0) * amp * clampf(rel_speed * 0.3, 0.2, 1.0)
		var mi := _tail[i]
		mi.position = Vector3(x, 0.0, z)
		var w := lerpf(0.14, 0.02, t) * (1.0 - climax * 0.8)
		mi.scale = Vector3(0.03 + 0.03 * (1.0 - t), w * 2.2, tail_len / n * 1.6)
		mi.visible = tail_len > 0.02
	var lh := smoothstep(0.55, 0.85, growth)
	var lf := smoothstep(0.85, 1.0, growth) * 0.8 + climax * 0.2
	for i in 2:
		var s := -1.0 if i == 0 else 1.0
		_legs_h[i].visible = lh > 0.01
		_legs_h[i].position = Vector3(0.12 * s, -0.06, -0.05)
		_legs_h[i].scale = Vector3(0.05, 0.05, 0.25) * lh
		_legs_h[i].rotation.y = 0.5 * s
		_legs_f[i].visible = lf > 0.01
		_legs_f[i].position = Vector3(0.13 * s, -0.07, -0.3)
		_legs_f[i].scale = Vector3(0.04, 0.04, 0.14) * lf


# ---------------------------------------------------------------- manipulacao
func grab() -> void:
	_carried = true
	_punish_t = 1.0
	behavior = "sendo carregado!"


func carry_to(t: Transform3D) -> void:
	_carry_t = t


func release(_vel: Vector3) -> void:
	_carried = false
	var pd := Pond.at(global_position)
	if pd:
		pond = pd
		global_position.y = minf(global_position.y, pd.level - 2.0)


func sight_range() -> float:
	return 150.0


func observe_death(pos: Vector3, reason: String, _obj: Object, _victim: Node) -> void:
	if reason.begins_with("comido") or reason.begins_with("esmagad"):
		mind.add_danger(pos, 150.0, 0.7, "viu um girino morrer")
		mind.scare(0.3)
		last_lesson = "viu outro girino morrer: se esconde mais"


func observe_taste(_f: Node3D, _us: float) -> void:
	pass


func loom_radius() -> float:
	return body_len() * 0.3


func describe() -> String:
	var st := "girino"
	if climax > 0.0:
		st = "metamorfose %d%%" % int(climax * 100)
	elif growth > 0.85:
		st = "girino com 4 patas"
	elif growth > 0.55:
		st = "girino com patas traseiras"
	return "Girino (%s, geracao %d, %.0f mm) — %s" % [st, generation, body_len(), behavior]
