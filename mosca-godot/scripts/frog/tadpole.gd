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
var model: TadpoleModel
var org := AmphibianOrgans.new()
var _cpg := 0.0                      # fase do meio-centro medular
var _angles := PackedFloat32Array()
var _act_l := PackedFloat32Array()
var _act_r := PackedFloat32Array()
var _steer := 0.0
var _drive := 0.0
var _pitch_goal := 0.0


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
	model = TadpoleModel.new()
	add_child(model)
	model.build(uid)
	if genome.has_defect("albinismo"):
		model.skin.set_shader_parameter("dorsal", Color(0.85, 0.72, 0.55))
		model.skin.set_shader_parameter("belly", Color(0.95, 0.88, 0.75))
	_angles.resize(TadpoleModel.SEGS)
	_act_l.resize(TadpoleModel.SEGS)
	_act_r.resize(TadpoleModel.SEGS)


func set_xray(on: bool) -> void:
	model.set_xray(on)


# ---------------------------------------------------------------- principal
func _physics_process(dt: float) -> void:
	if dead or dt <= 0.0:
		return
	age += dt
	if _carried:
		global_transform = global_transform.interpolate_with(_carry_t, 1.0 - exp(-dt * 20.0))
		pain = maxf(pain, 0.2)
		# segurado: Rohon-Beard + dor -> circuito de se debater (ritmo lento e forte)
		brain.set_input("tato_L", 150.0)
		brain.set_input("tato_R", 150.0)
		brain.set_input("dor", 200.0 * clampf(pain, 0.0, 1.0))
		brain.advance(dt)
		var st := clampf((brain.output("debater_L") + brain.output("debater_R")) * 0.8, 0.0, 1.5)
		_cpg += dt * TAU * 4.0
		for i in _angles.size():
			_angles[i] = sin(_cpg - i * 0.5) * 0.35 * st * (0.4 + 0.6 * float(i) / _angles.size())
		model.set_tail(_angles, _act_l, _act_r, climax)
		behavior = "se debatendo (segurado)" if st > 0.2 else "sendo carregado!"
		return
	var cam := get_viewport().get_camera_3d() as Spectator
	var followed := cam != null and cam.follow == self
	brain.focused = followed
	brain.set_mode(1)   # conectoma sintetico calibrado no campo medio
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
	# alelo letal em dose dupla: o girino nao se desenvolve
	if genome.has_defect("letal_ra") and age > (0.3 + fposmod(uid * 0.618, 1.0)) * DAY:
		_die("defeito genetico letal (girino)")
		return
	energy -= dt / (1.5 * DAY) * genome.get_gene("metabolism") * (1.0 + org.work * 0.5)
	# branquias sempre; o pulmao se forma na segunda metade do girino e ele
	# passa a subir para engolir ar na superficie
	org.has_gills = climax < 0.7
	org.has_lungs = growth > 0.5
	var at_surface := pond != null and global_position.y > pond.level - body_len() * 0.25
	energy = minf(1.0, energy + org.step(dt, brain, at_surface, true, 1.0, 18.0))
	if org.o2 < 0.12:
		health -= dt / 90.0
		if health <= 0.0:
			_die("asfixia (girino)")
			return
	pain = maxf(0.0, pain - dt)
	health = minf(1.0, health + dt / 600.0)
	if growth >= 1.0 and climax < 1.0:
		# metamorfose: a cauda e reabsorvida (energia vem dela), nao come
		# o ritmo da metamorfose vem do eixo TRH -> tireoide do proprio cerebro
		var th := clampf(0.6 + brain.output("tsh") * 3.0, 0.6, 1.8) if brain is GpuBrain else 1.0
		climax = minf(1.0, climax + dt / (CLIMAX_DAYS * DAY) * th)
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
	model.rotation.z = PI
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
	for k in 8:
		brain.set_input("sombra_s%d" % k, shadow * 0.6)   # sombra por cima: todos os setores
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
	var inp := org.brain_inputs()
	brain.set_input("oxigenio_baixo", inp["oxigenio_baixo"])
	brain.set_input("pulmao_cheio", inp["pulmao_cheio"])
	# vontade da decisao -> reticulospinais de cada lado (girar para o alvo)
	var base := 15.0 + 75.0 * _drive
	brain.set_input("explore_L", base * (1.0 + clampf(-_steer, 0.0, 1.0)) * (1.0 - 0.85 * clampf(_steer, 0.0, 1.0)) + _rng.randf() * 8.0)
	brain.set_input("explore_R", base * (1.0 + clampf(_steer, 0.0, 1.0)) * (1.0 - 0.85 * clampf(-_steer, 0.0, 1.0)) + _rng.randf() * 8.0)
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
	if org.has_lungs:
		sc["subir para respirar"] = (0.75 - org.o2) * 4.0
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


# ---------------------------------------------------------------- nado (musculos)
## Medula: os motoneuronios esquerdo/direito (swim_L/R do conectoma) dao a
## forca de cada lado; o meio-centro alterna os lados e a contracao desce a
## cauda com atraso (onda rostro-caudal). O angulo de cada segmento sai da
## diferenca de contracao direita x esquerda; a onda empurra a agua (empuxo)
## e a curvatura media gira o corpo. A Mauthner contrai um lado inteiro de
## uma vez (curva em C) e o girino dispara para o outro lado.
func _move(dt: float) -> void:
	var len := body_len()
	_feeding = maxf(0.0, _feeding - dt)
	_plan(dt)
	var mn_l := clampf(brain.output("swim_L") if brain is GpuBrain else _drive + clampf(-_steer, 0, 1) * 0.5, 0.0, 2.0)
	var mn_r := clampf(brain.output("swim_R") if brain is GpuBrain else _drive + clampf(_steer, 0, 1) * 0.5, 0.0, 2.0)
	var esc_l: float = brain.output("escape_L") if brain is GpuBrain else 0.0
	var esc_r: float = brain.output("escape_R") if brain is GpuBrain else 0.0
	var drive := clampf((mn_l + mn_r) * 0.5, 0.0, 1.5)
	var freq := 2.0 + 14.0 * drive                      # Hz (girinos: 10-25 Hz nadando forte)
	_cpg += dt * freq * TAU
	var n := TadpoleModel.SEGS
	var mean_bend := 0.0
	var tip := 0.0
	for i in n:
		var ph := _cpg - float(i) * 0.55
		var s := sin(ph)
		var al := mn_l * maxf(s, 0.0) + esc_r * 1.5      # Mauthner D contrai a esquerda
		var ar := mn_r * maxf(-s, 0.0) + esc_l * 1.5     # Mauthner E contrai a direita
		_act_l[i] = lerpf(_act_l[i], clampf(al, 0.0, 2.0), 1.0 - exp(-dt / 0.01))
		_act_r[i] = lerpf(_act_r[i], clampf(ar, 0.0, 2.0), 1.0 - exp(-dt / 0.01))
		var goal := (_act_r[i] - _act_l[i]) * 0.35 * (0.6 + float(i) / n)
		_angles[i] = lerpf(_angles[i], clampf(goal, -0.9, 0.9), 1.0 - exp(-dt / 0.015))
		mean_bend += _angles[i]
		if i >= n - 3:
			tip += absf(_angles[i])
	mean_bend /= n
	tip /= 3.0
	org.work = maxf(org.work, drive)
	# empuxo pela onda da cauda (~ frequencia x amplitude^2) e arrasto
	var thrust := len * freq * tip * tip * 6.0 * (1.0 - climax * 0.8) * (0.55 if genome.has_defect("escoliose") else 1.0)
	var fwd := -global_basis.z
	velocity += fwd * thrust * dt
	velocity *= exp(-dt * 3.0)
	# curvatura media para a direita -> o corpo gira para a direita
	rotate_y(-mean_bend * 9.0 * dt)
	rotation.x = lerpf(rotation.x, _pitch_goal, 1.0 - exp(-dt * 2.5))
	var np := global_position + velocity * dt
	var ground := GardenWorld.instance.height_at(np.x, np.z) if GardenWorld.instance else pond.level - pond.depth
	var lo := ground + len * 0.12
	var hi := pond.level - len * 0.08
	if hi - lo < len * 0.15 and decision != "subir para a margem":
		_bump = 1.0   # encostou na margem: tato na cabeca -> MHR para
		velocity = -velocity * 0.3
		np = global_position
	np.y = clampf(np.y, lo, maxf(hi, lo))
	global_position = np
	model.scale = Vector3.ONE * len
	if genome.has_defect("escoliose"):
		for i in _angles.size():
			_angles[i] += 0.07 * sin(i * 0.9)     # coluna torta: a cauda nunca fica reta
	model.set_tail(_angles, _act_l, _act_r, climax)
	model.set_state(org, growth, climax, _feeding, energy)


## Vontade: para onde ir (vira o lado do reticular) e em que profundidade.
func _plan(dt: float) -> void:
	var len := body_len()
	var goal := Vector3.INF
	_drive = 0.2
	match decision:
		"fugir":
			_escape_t -= dt
			goal = global_position + _escape_dir * 100.0
			_drive = 1.0
			if _escape_t <= 0.0:
				decision = "esconder"
		"comer":
			if is_instance_valid(_target):
				goal = _target.global_position + Vector3.UP * 2.0
				var d := goal.distance_to(global_position)
				if d < len * 0.6:
					_drive = 0.05
					# raspa com o bico: quanto o CPG da boca (feed) dispara
					var feed: float = brain.output("feed") if brain is GpuBrain else 0.8
					var got := 0.0
					if _target is Algae:
						got = (_target as Algae).graze(0.00008 * len * dt * clampf(feed, 0.1, 1.5))
					elif _target is Fruit:
						got = (_target as Fruit).consume(0.00003 * len * dt)
					if got > 0.0:
						_eat(got, dt)
						org.eat(got * 4.0, false)
					behavior = "raspando algas (bico corneo)" if _target is Algae else "comendo fruta na agua"
				else:
					_drive = 0.6
					behavior = "nadando ate a comida"
		"subir para respirar":
			goal = Vector3(global_position.x, pond.level, global_position.z) - global_basis.z * len
			_drive = 0.6
			behavior = "subindo para engolir ar"
		"subir para a margem":
			behavior = "metamorfose: saindo do lago (%d%%)" % int(climax * 100)
			goal = pond.shore_point(global_position)
			_drive = 0.5
			if pond.depth_at(global_position) < len * 0.4 and climax > 0.95:
				_become_frog()
				return
		"esconder":
			behavior = "escondido no fundo"
			goal = Vector3(pond.center.x, pond.level - pond.depth * 0.9, pond.center.y)
			_drive = 0.4
		_:
			behavior = "nadando" if _drive > 0.2 else "parado na agua"
	_steer = 0.0
	_pitch_goal = 0.0
	if goal != Vector3.INF:
		var to := goal - global_position
		if to.length() > 0.5:
			var ang := (-global_basis.z).signed_angle_to(Vector3(to.x, 0, to.z), Vector3.UP)
			_steer = clampf(-ang * 1.5, -1.0, 1.0)
			_pitch_goal = clampf(asin(clampf(to.normalized().y, -0.8, 0.8)), -0.6, 0.6)


func _eat(got: float, dt: float) -> void:
	energy = minf(1.0, energy + got * 18.0)
	# cresce so com comida e com o tempo (comendo sempre: ~GROW_DAYS dias)
	growth = minf(1.0, growth + minf(got * 6.0, dt / (GROW_DAYS * DAY) * 1.2))
	_feeding = 1.0
	if _rng.randf() < 0.02:
		_reward_t = 0.5
		mind.learn_odor((_target as Node).call("food_key") if _target.has_method("food_key") else (_target as Fruit).memory_key(), 1.0, 0.1, "alga" if _target is Algae else "fruta")


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
