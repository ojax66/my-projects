class_name Fly
extends Node3D
## Mosca completa: corpo NeuroMechFly + CPG + cerebro spiking + sensores.
##
## Ciclo por tick de fisica:
##   sensores (odor, paladar, looming, vento, fome) -> taxas de Poisson
##   cerebro LIF -> neuronios descendentes (DNp09, DNa02, MDN, GF, MN9, aDN)
##   DNs -> sinal descendente esquerdo/direito do CPG (como no flygym)
##   CPG -> angulos das juntas (passadas reais) + deslocamento do corpo
## A mosca anda "grudada" em qualquer superficie com colisao (chao, frutas,
## pedras, troncos), usando raycasts ao longo da normal.

enum State { WALK, FLY, CARRIED, DEAD }

const WORLD_MASK := 1 | 2          # camadas "mundo" e "objetos"
const STRIDE := 1.5                 # mm por ciclo de passada com amplitude 1
const TRACK := 1.9                  # distancia lateral entre as pernas (mm)
const FLIGHT_SPEED := 320.0         # mm/s
const ODOR_LAMBDA := 160.0          # alcance do odor (mm)
const ODOR_BASELINE := 4.0          # Hz espontaneo dos ORNs

signal state_changed(fly: Fly, state: int)

@export var fly_name := "Mosca"
@export var brain_path := "res://brain/connectome.json"
@export var world_radius := 2600.0

var body: FlyBody
var cpg: FlyCPG
var brain: FlyBrain
var chem := NeuroChem.new()
var state := State.WALK
var behavior := "explorando"

# vida
var genome: Genome
var inherited_memory := PackedFloat32Array()
var sex := "F"                  # "F" femea, "M" macho
var generation := 1
var lineage := 0
var age := 0.0
var energy := 0.7               # reserva (acucar/gordura) 0..1
var gut := 0.0                  # conteudo do papo/intestino
var waste := 0.0                # residuo a excretar
var dead := false
var death_reason := ""
var mated := false
var sperm_genome: Genome
var sperm_memory := PackedFloat32Array()
var sperm_generation := 1
var eggs_to_lay := 0
var eggs_laid := 0
var meals := 0.0
var _egg_timer := 0.0
var _starve_t := 0.0
var _dead_t := 0.0
var _ingest := 0.0
var _punish_t := 0.0
var _court_target: Fly = null
var _court_t := 0.0
var _copulating_with: Fly = null
var _copula_t := 0.0
var _last_mate_t := -999.0
var _courted_until := -1.0
var courtship := 0.0
var valence := 0.0
var _valence_raw := 0.0

# estado interno
var hunger := 0.7
var arousal := 0.6
var turn_noise := 0.0
var satiety_timer := 0.0
var escape_cooldown := 3.0
var puff := 0.0
var surface_body: Node3D = null
var _surface_local := Transform3D.IDENTITY
var _up := Vector3.UP
var _no_odor_time := 0.0
var _odor_adapt := 0.3
var _c_fast := 0.0
var _c_slow := 0.0
var _since_meal := 0.0
var _innate_pref := 0.0
var _rng := RandomNumberGenerator.new()

# saidas suavizadas
var m_fwd_l := 0.0
var m_fwd_r := 0.0
var m_turn := 0.0
var m_back := 0.0
var m_prob := 0.0
var m_groom := 0.0
var speed := 0.0

# sensores (para o painel)
var sense := {"odor_L": 0.0, "odor_R": 0.0, "sugar": 0.0, "bitter": 0.0, "loom_L": 0.0, "loom_R": 0.0, "mechano": 0.0}

# voo
var _vel := Vector3.ZERO
var _flight_target := Vector3.ZERO
var _flight_target_node: Node3D = null
var _flight_time := 0.0
var _wing_phase := 0.0
var _t := 0.0
var carrier_target := Transform3D.IDENTITY

var pick_area: Area3D


func _ready() -> void:
	_rng.randomize()
	add_to_group("flies")
	add_to_group("creatures")
	if genome == null:
		genome = Genome.random_founder(_rng)
	body = FlyBody.new()
	body.name = "Body"
	add_child(body)
	_apply_genome_visuals()
	cpg = FlyCPG.new()
	cpg.intrinsic_freq = 12.0 * genome.get_gene("speed")
	brain = _load_brain()
	if not inherited_memory.is_empty():
		brain.set_memory(inherited_memory)

	pick_area = Area3D.new()
	pick_area.name = "Pick"
	pick_area.collision_layer = 4
	pick_area.collision_mask = 0
	pick_area.monitoring = false
	var cs := CollisionShape3D.new()
	var sh := SphereShape3D.new()
	sh.radius = 3.0
	cs.shape = sh
	cs.position = Vector3(0, 1.0, 0)
	pick_area.add_child(cs)
	pick_area.set_meta("fly", self)
	add_child(pick_area)
	_snap_to_ground.call_deferred()


func _load_brain() -> FlyBrain:
	if brain_path != "" and FileAccess.file_exists(brain_path):
		var b := FlyBrain.from_json_file(brain_path)
		if b and b.n > 0:
			print("[%s] cerebro carregado: %s (%d neuronios, %d conexoes)" % [fly_name, b.name, b.n, b.total_edges])
			return b
	return FlyBrain.from_dict(DefaultCircuit.build())


func reload_brain(use_connectome: bool) -> void:
	var mem := brain.get_memory()
	brain_path = "res://brain/connectome.json" if use_connectome else ""
	brain = _load_brain()
	brain.set_memory(mem)


## Genes que aparecem no corpo: tamanho, cor da cuticula e dos olhos; machos
## tem a ponta do abdome escura.
func _apply_genome_visuals() -> void:
	var sc := genome.get_gene("size") * (1.08 if sex == "F" else 0.94)
	body.scale = Vector3.ONE * sc
	var hue := genome.get_gene("hue")
	for seg_name: String in body.segments:
		var mi: MeshInstance3D = (body.segments[seg_name] as Node3D).get_node("mesh")
		var base := mi.material_override as StandardMaterial3D
		if base == null or seg_name.ends_with("_wing"):
			continue
		var m := base.duplicate() as StandardMaterial3D
		var c := m.albedo_color
		if seg_name.ends_with("_eye"):
			m.albedo_color = Color(c.r * genome.get_gene("eye_red"), c.g, c.b, c.a)
		else:
			m.albedo_color = Color.from_hsv(fposmod(c.h + hue, 1.0), c.s, c.v, c.a) if c.s > 0.01 else c
			if sex == "M" and (seg_name == "c_abdomen5" or seg_name == "c_abdomen6"):
				m.albedo_color = Color(0.12, 0.08, 0.05)
				m.albedo_texture = null
			if not seg_name.ends_with("_eye") and m.albedo_texture:
				m.albedo_color = Color.from_hsv(fposmod(hue, 1.0), 0.0, 1.0).lerp(Color.from_hsv(fposmod(0.08 + hue, 1.0), 0.35, 1.0), 0.5)
		mi.material_override = m


func using_connectome() -> bool:
	return brain.source != "DefaultCircuit.gd"


func _snap_to_ground() -> void:
	var hit := _ray(global_position + Vector3.UP * 500.0, global_position + Vector3.DOWN * 2000.0)
	if hit:
		_set_on_surface(hit.position, hit.normal, hit.collider)


# ---------------------------------------------------------------- principal
func _physics_process(dt: float) -> void:
	if dt <= 0.0:
		return
	_t += dt
	if dead:
		_dead_process(dt)
		return
	escape_cooldown = maxf(0.0, escape_cooldown - dt)
	puff = maxf(0.0, puff - dt * 1.6)
	_punish_t = maxf(0.0, _punish_t - dt)
	# a mosca que voce segue roda o LIF com spikes; as outras, o campo medio
	var cam := get_viewport().get_camera_3d() as Spectator
	brain.set_mode(FlyBrain.Mode.SPIKE if cam and cam.follow == self else FlyBrain.Mode.RATE)
	_update_internal(dt)
	_physiology(dt)
	if dead:
		return
	_sense(dt)
	brain.advance(dt)
	chem.update(dt, brain, energy, arousal, _ingest, 1.0 if _punish_t > 0.0 else 0.0)
	brain.learning_gain = genome.get_gene("learning") * (0.6 + 0.8 * clampf(chem.get_level("octopamina"), 0.0, 1.5))
	_read_motor(dt)
	_mating(dt)
	match state:
		State.WALK: _walk(dt)
		State.FLY: _fly(dt)
		State.CARRIED: _carried(dt)
	_animate(dt)


func _update_internal(dt: float) -> void:
	_since_meal += dt
	hunger = clampf(1.0 - energy, 0.0, 1.0)
	# processos de Ornstein-Uhlenbeck: nivel de atividade e vies de giro
	arousal += (0.55 - arousal) * dt * 0.08 + _rng.randfn() * sqrt(dt) * 0.18
	arousal = clampf(arousal, 0.0, 1.0)
	turn_noise += -turn_noise * dt * 0.8 + _rng.randfn() * sqrt(dt) * 0.9
	turn_noise = clampf(turn_noise, -1.0, 1.0)


# ---------------------------------------------------------------- fisiologia
## Metabolismo: gasta energia andando/voando, come a polpa (vai para o papo),
## digere (vira energia) e excreta o residuo. Morre de fome ou de velhice.
func _physiology(dt: float) -> void:
	age += dt
	var met := genome.get_gene("metabolism")
	var burn := 1.0 / 600.0 + absf(speed) / 20.0 / 400.0
	if state == State.FLY:
		burn = 1.0 / 90.0
	energy -= burn * met * dt
	# comer: probocide estendida sobre polpa doce
	_ingest = 0.0
	var feed_th := 0.45 + 0.3 * clampf(chem.get_level("serotonina"), 0.0, 1.0)
	if state == State.WALK and surface_body is Fruit and sense["sugar"] > 0.0 and m_prob > feed_th and gut < 0.5:
		var got := (surface_body as Fruit).consume(0.03 * dt)
		gut += got
		meals += got
		_ingest = 1.0 if got > 0.0 else 0.0
		_since_meal = 0.0
	# digestao
	var d := minf(gut, 0.012 * dt)
	gut -= d
	energy = minf(energy + d * 1.6, 1.0)
	waste += d * 0.6
	if waste > 0.05 and state == State.WALK and _rng.randf() < dt * 0.5:
		waste = 0.0
		if LifeManager.instance:
			var tail := body.segment_position("c_abdomen6")
			LifeManager.instance.drop_spot(tail - _up * 0.4, _up, surface_body)
	if energy <= 0.0:
		energy = 0.0
		_starve_t += dt
		if _starve_t > 25.0:
			die("fome")
	else:
		_starve_t = 0.0
	if age > genome.get_gene("lifespan"):
		die("velhice")
	# postura de ovos: femea fecundada em cima de fruta
	if sex == "F" and eggs_to_lay > 0 and state == State.WALK and surface_body is Fruit and energy > 0.25:
		_egg_timer += dt
		if _egg_timer > 3.5:
			_egg_timer = 0.0
			eggs_to_lay -= 1
			eggs_laid += 1
			energy -= 0.03
			behavior = "botando ovo"
			if LifeManager.instance:
				LifeManager.instance.lay_egg(self, body.segment_position("c_abdomen6") - _up * 0.3, _up, surface_body)


func die(reason: String) -> void:
	if dead:
		return
	dead = true
	death_reason = reason
	behavior = "morta (%s)" % reason
	state = State.DEAD
	surface_body = null
	if LifeManager.instance:
		LifeManager.instance.record_death(reason)
	_dead_t = 0.0
	state_changed.emit(self, state)


func _dead_process(dt: float) -> void:
	_dead_t += dt
	# cai ate o chao e fica de pernas encolhidas
	var hit := _ray(global_position + Vector3.UP * 0.5, global_position + Vector3.DOWN * 3000.0)
	if hit and global_position.y - hit.position.y > 0.2:
		global_position = global_position.move_toward(hit.position, dt * 600.0)
	elif hit:
		global_transform = global_transform.interpolate_with(Transform3D(_basis_from(Vector3.DOWN.lerp(Vector3.RIGHT, 0.3), -global_basis.z), hit.position + Vector3.UP * 0.9), minf(1.0, dt * 3.0))
	for i in 6:
		var leg: String = FlyCPG.LEGS[i]
		body.set_joint(leg + "_trochanterfemur", 0.0, deg_to_rad(-160.0), 0.0)
		body.set_joint(leg + "_tibia", 0.0, deg_to_rad(150.0), 0.0)
	body.set_joint("l_wing", 0.0, 0.0, deg_to_rad(-60.0))
	body.set_joint("r_wing", 0.0, 0.0, deg_to_rad(-60.0))
	body.apply_pose()
	if _dead_t > 120.0:
		queue_free()


## Objeto rapido batendo na mosca = esmagada.
func _check_crush() -> void:
	for item: Array in _loomers:
		var o = item[0]
		if not is_instance_valid(o) or o is Spectator or o == surface_body:
			continue
		var v: Vector3 = item[1]
		if v.length() < 350.0:
			continue
		var r: float = o.loom_radius()
		if (o.global_position as Vector3).distance_to(global_position + _up) < r + 1.2:
			die("esmagada")
			return


# ---------------------------------------------------------------- corte e acasalamento
## Macho maduro perto de femea: feromonios excitam os pC1/P1 (courtship_cue);
## se a atividade de corte passa do limiar ele segue a femea, "canta" com uma
## asa e copula. A femea fica fecundada e passa a botar ovos nas frutas.
func _mating(dt: float) -> void:
	if _copulating_with:
		_copula_t += dt
		behavior = "acasalando"
		if not is_instance_valid(_copulating_with) or _copulating_with.dead:
			_copulating_with = null
		elif _copula_t > 7.0:
			if sex == "M":
				_copulating_with._receive_sperm(self)
				_copulating_with._copulating_with = null
			_last_mate_t = age
			_copulating_with = null
		return
	if sex != "M" or age < LifeManager.ADULT_MATURE or state != State.WALK or age - _last_mate_t < 60.0:
		courtship = 0.0
		_court_target = null
		return
	var best: Fly = null
	var best_d := 90.0
	for n in get_tree().get_nodes_in_group("flies"):
		var f := n as Fly
		if f == self or f.dead or f.sex != "F" or f.age < LifeManager.ADULT_MATURE or f.mated or f.state != State.WALK:
			continue
		var d := f.global_position.distance_to(global_position)
		if d < best_d:
			best_d = d
			best = f
	_court_target = best
	if best:
		_court_t += dt


func _receive_sperm(male: Fly) -> void:
	mated = true
	sperm_genome = male.genome
	sperm_memory = male.brain.get_memory()
	sperm_generation = male.generation
	eggs_to_lay = int(genome.get_gene("fecundity"))
	_last_mate_t = age


# ---------------------------------------------------------------- sensores
func _sense(dt: float) -> void:
	_refresh_cache()
	var head := body.segment_position("c_head")
	var right := global_basis.x.normalized()
	var fwd := -global_basis.z.normalized()
	# as antenas estao a ~0.4 mm; usamos uma separacao efetiva maior para que
	# a comparacao bilateral funcione na escala do jardim
	var v_l := _odor_vec(head - right * 45.0 + fwd * 20.0)
	var v_r := _odor_vec(head + right * 45.0 + fwd * 20.0)
	var c_l := 0.0
	var c_r := 0.0
	for i in v_l.size():
		c_l += v_l[i]
		c_r += v_r[i]
	c_l /= v_l.size()
	c_r /= v_l.size()
	# adaptacao dos ORNs: a sensibilidade acompanha a concentracao media
	_odor_adapt = lerpf(_odor_adapt, (c_l + c_r) * 0.5, 1.0 - exp(-dt / 2.5))
	var k := (0.08 + 0.9 * _odor_adapt) / genome.get_gene("odor_gain")
	# insulina (saciedade) reduz a sensibilidade olfativa; DH44/AKH (fome) aumentam
	k *= 1.0 + 0.5 * chem.get_level("insulina") - 0.3 * clampf(chem.get_level("AKH"), 0.0, 1.0)
	var r_l := _orn_rate(c_l / k)
	var r_r := _orn_rate(c_r / k)
	sense["odor_L"] = r_l
	sense["odor_R"] = r_r
	# cada glomerulo (DM1, DM2, ...) recebe seu proprio canal no conectoma
	var pref := 0.0
	for i in v_l.size():
		var gl: String = Fruit.GLOMS[i]
		var rl := _orn_rate(v_l[i] / k)
		var rr := _orn_rate(v_r[i] / k)
		brain.set_input("odor_%s_L" % gl, rl)
		brain.set_input("odor_%s_R" % gl, rr)
		pref += genome.get_gene("pref_" + gl) * (rl + rr - 2.0 * ODOR_BASELINE) / 340.0
	_innate_pref = pref
	if c_l + c_r < 0.05:
		_no_odor_time += dt
	else:
		_no_odor_time = 0.0
	# comparacao temporal (klinocinese): concentracao caindo -> gira mais
	var c_mean := (c_l + c_r) * 0.5
	_c_fast = lerpf(_c_fast, c_mean, 1.0 - exp(-dt / 0.25))
	_c_slow = lerpf(_c_slow, c_mean, 1.0 - exp(-dt / 1.5))
	var dc := (_c_fast - _c_slow) / maxf(_c_slow, 0.02)

	var sugar := 0.0
	var bitter := 0.0
	if state == State.WALK and is_instance_valid(surface_body) and surface_body.has_method("taste"):
		var taste: Dictionary = surface_body.call("taste")
		# sensibilidade dos GRNs de acucar cai com a saciedade (insulina)
		sugar = 150.0 * float(taste.get("sugar", 0.0)) * (0.25 + 0.75 * hunger) * genome.get_gene("sugar_gain")
		sugar *= 1.0 - 0.4 * clampf(chem.get_level("insulina"), 0.0, 1.0)
		bitter = 150.0 * float(taste.get("bitter", 0.0)) * genome.get_gene("bitter_gain")
	sense["sugar"] = sugar
	sense["bitter"] = bitter

	var loom := _looming(dt, head) * (1.0 / genome.get_gene("boldness")) * (1.0 + 0.5 * clampf(chem.get_level("octopamina"), 0.0, 1.0))
	_check_crush()
	if dead:
		return
	sense["loom_L"] = loom.x
	sense["loom_R"] = loom.y
	var mech := puff * 220.0
	if state == State.CARRIED:
		mech = maxf(mech, 60.0)
	sense["mechano"] = mech

	brain.set_input("odor_L", r_l)
	brain.set_input("odor_R", r_r)
	brain.set_input("sugar_L", sugar)
	brain.set_input("sugar_R", sugar)
	brain.set_input("bitter_L", bitter)
	brain.set_input("bitter_R", bitter)
	brain.set_input("sugar", sugar)
	brain.set_input("bitter", bitter)
	# sinais internos: acucar na hemolinfa (IPC), fome (ISN/DH44, AKH),
	# dopamina de recompensa (comer) e de punicao (amargo, ser agarrada, susto)
	brain.set_input("glucose", 60.0 * energy)
	brain.set_input("reward", 110.0 * _ingest)
	brain.set_input("punish", maxf(bitter * 0.8, 130.0 if _punish_t > 0.0 else 0.0))
	var cue := 0.0
	if is_instance_valid(_court_target):
		cue = 150.0 * clampf(1.0 - _court_target.global_position.distance_to(global_position) / 90.0, 0.0, 1.0)
	brain.set_input("courtship_cue", cue)
	brain.set_input("loom_L", loom.x)
	brain.set_input("loom_R", loom.y)
	brain.set_input("mechano", mech)
	brain.set_input("hunger", 70.0 * hunger * (1.0 + 0.5 * chem.get_level("AKH")))

	# exploracao espontanea
	var fwd_rate := 0.0 if arousal < 0.22 else 15.0 + 55.0 * arousal
	# octopamina e AKH (jejum) aumentam a locomocao; leucocinina acalma
	fwd_rate *= (0.75 + 0.5 * clampf(chem.get_level("octopamina"), 0.0, 1.5) + 0.4 * chem.get_level("AKH")) * (1.0 - 0.3 * clampf(chem.get_level("leucocinina"), 0.0, 1.0))
	var steer := turn_noise
	var d := global_position.length()
	if d > world_radius:
		# volta para o centro do jardim
		var to_center := -global_position.normalized()
		steer = clampf(steer + 2.0 * signf(right.dot(to_center)), -1.0, 1.0)
	brain.set_input("explore_fwd", fwd_rate)
	var focus := 1.0 - 0.75 * clampf((r_l + r_r - 40.0) / 120.0, 0.0, 1.0) * hunger
	focus *= clampf(1.0 - dc * 12.0, 0.3, 3.0)
	brain.set_input("explore_L", 55.0 * focus * maxf(0.0, -steer))
	brain.set_input("explore_R", 55.0 * focus * maxf(0.0, steer))
	brain.set_input("explore_back", 0.0)


# cache compartilhado por todas as moscas, refeito uma vez por tick de fisica
static var _cache_frame := -1
static var _odor_pos := PackedVector3Array()
static var _odor_k := PackedFloat32Array()
static var _odor_prof: Array[PackedFloat32Array] = []
static var _loomers: Array = []


func _refresh_cache() -> void:
	var fr := Engine.get_physics_frames()
	if fr == _cache_frame:
		return
	_cache_frame = fr
	_odor_pos.clear()
	_odor_k.clear()
	_odor_prof.clear()
	for src in get_tree().get_nodes_in_group("odor_source"):
		var k: float = src.odor_strength()
		if k > 0.0:
			_odor_pos.append(src.global_position)
			_odor_k.append(k)
			_odor_prof.append(src.odor_profile() if src.has_method("odor_profile") else PackedFloat32Array([k, k, k, k, k, k]))
	_loomers.clear()
	for obj in get_tree().get_nodes_in_group("loomer"):
		var v: Vector3 = obj.cam_velocity if obj is Spectator else (obj.linear_velocity if obj is RigidBody3D else Vector3.ZERO)
		if v.length_squared() > 900.0:
			_loomers.append([obj, v])


func _odor_vec(p: Vector3) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	out.resize(Fruit.GLOMS.size())
	for i in _odor_pos.size():
		var d := p.distance_to(_odor_pos[i])
		if d < ODOR_LAMBDA * 8.0:
			var w := exp(-d / ODOR_LAMBDA)
			var prof: PackedFloat32Array = _odor_prof[i]
			for j in out.size():
				out[j] += prof[j] * w
	return out


func _orn_rate(x: float) -> float:
	return ODOR_BASELINE + 170.0 * x * x / (x * x + 1.0)


func _odor_at(p: Vector3) -> float:
	var c := 0.0
	for i in _odor_pos.size():
		var d := p.distance_to(_odor_pos[i])
		if d < ODOR_LAMBDA * 8.0:
			c += _odor_k[i] * exp(-d / ODOR_LAMBDA)
	return c


## Detector de looming (LPLC2): taxa de expansao angular de objetos que vem
## na direcao da mosca (dθ/dt = 2 r v / (d² + r²)). So conta o movimento do
## objeto, nao o da propria mosca. Retorna taxas (Hz) esquerda/direita.
func _looming(_dt: float, head: Vector3) -> Vector2:
	var out := Vector2.ZERO
	var right := global_basis.x.normalized()
	for item: Array in _loomers:
		var o = item[0]
		if not is_instance_valid(o):
			continue
		if o is Spectator and (o as Spectator).follow == self:
			continue  # a camera que nos segue nao assusta
		if o == surface_body:
			continue  # a fruta onde estamos nao "vem" em nossa direcao
		var v: Vector3 = item[1]
		var r: float = o.loom_radius()
		var opos: Vector3 = o.global_position
		var to_fly := head - opos
		var d := maxf(to_fly.length() - r, 0.5)
		if d > 1500.0:
			continue
		var approach := v.dot(to_fly.normalized())
		if approach <= 0.0:
			continue
		var theta := 2.0 * atan(r / d)
		if theta < 0.08:
			continue
		var dtheta := 2.0 * r * approach / (d * d + r * r)
		var rate := clampf((dtheta - 0.8) * 70.0, 0.0, 260.0)
		if right.dot(opos - head) < 0.0:
			out.x = maxf(out.x, rate)
		else:
			out.y = maxf(out.y, rate)
	return out


func air_puff(strength: float) -> void:
	puff = clampf(puff + strength, 0.0, 1.5)


# ---------------------------------------------------------------- motor
func _read_motor(dt: float) -> void:
	var a := 1.0 - exp(-dt / 0.15)
	var mg := genome.get_gene("motor_gain")
	m_fwd_l = lerpf(m_fwd_l, brain.output("forward_L") * mg, a)
	m_fwd_r = lerpf(m_fwd_r, brain.output("forward_R") * mg, a)
	# memoria do corpo cogumelo: valencia aprendida do cheiro atual
	if Engine.get_physics_frames() % 5 == get_instance_id() % 5:
		_valence_raw = brain.learned_valence()
	valence = lerpf(valence, _valence_raw, a)
	# atracao pelo gradiente de odor = inata (genes) x fome + aprendida
	var tropism := genome.get_gene("tropism") * (0.3 + hunger) * (0.5 + _innate_pref) + 2.5 * valence
	var od_l: float = sense["odor_L"]
	var od_r: float = sense["odor_R"]
	var grad := (od_l - od_r) / (od_l + od_r + 1.0)
	var turn_cmd := (brain.output("turn_L") - brain.output("turn_R")) * mg + tropism * grad * 2.0
	# corte: o macho segue a femea
	if is_instance_valid(_court_target) and courtship > 0.25:
		var to := _court_target.global_position - global_position
		var side := global_basis.x.dot(to)
		turn_cmd = clampf(-side * 0.4, -1.5, 1.5)
	m_turn = lerpf(m_turn, turn_cmd, a)
	var court_raw := brain.output("courtship") if brain.has_output("courtship") else (1.0 if is_instance_valid(_court_target) else 0.0)
	courtship = lerpf(courtship, court_raw * 3.0, a)
	m_back = lerpf(m_back, brain.output("backward"), a)
	m_prob = lerpf(m_prob, brain.output("proboscis"), a)
	m_groom = lerpf(m_groom, brain.output("groom"), a)

	if brain.output("escape") > 0.35 and escape_cooldown <= 0.0 and state == State.WALK and not _copulating_with:
		_escape()
		_punish_t = 0.4  # susto tambem ensina um pouco (PPL1)


func _descending() -> Vector2:
	# sinal descendente por lado (flygym TurningController): virar a esquerda
	# = passadas menores do lado esquerdo e maiores do lado direito
	var f := 0.3 * (m_fwd_l + m_fwd_r)
	var dl := f - 0.7 * m_turn - 1.0 * m_back
	var dr := f + 0.7 * m_turn - 1.0 * m_back
	if m_groom > 0.35 or (m_prob > 0.45 and sense["sugar"] > 0.0):
		dl *= 0.1
		dr *= 0.1
	# femea receptiva desacelera quando um macho a corteja
	if sex == "F" and not mated and Engine.get_physics_frames() < _courted_until:
		dl *= 0.2
		dr *= 0.2
	var mag := maxf(absf(dl), absf(dr))
	if mag < 0.12:
		return Vector2.ZERO
	return Vector2(clampf(dl, -1.2, 1.2), clampf(dr, -1.2, 1.2))


# ---------------------------------------------------------------- caminhada
func _walk(dt: float) -> void:
	_follow_surface_body()
	if state != State.WALK:
		return
	var d := _descending()
	if _copulating_with:
		d = Vector2.ZERO
		if sex == "M" and is_instance_valid(_copulating_with):
			# macho sobe nas costas da femea
			global_transform = _copulating_with.global_transform.translated_local(Vector3(0, 0.9, 0.5))
			_up = _copulating_with._up
	elif is_instance_valid(_court_target) and courtship > 0.25:
		var dist := _court_target.global_position.distance_to(global_position)
		behavior = "cortejando %s" % _court_target.fly_name
		d = Vector2(1.0, 1.0) if dist > 3.0 else Vector2.ZERO
		_court_target._courted_until = Engine.get_physics_frames() + 60
		if dist <= 3.5:
			behavior = "cantando (asa vibrando)"
			if _rng.randf() < dt * 0.35:
				_copulating_with = _court_target
				_court_target._copulating_with = self
				_copula_t = 0.0
				_court_target._copula_t = 0.0
	cpg.set_descending(d.x, d.y)
	cpg.step(dt)
	var f := cpg.intrinsic_freq
	var v_l := STRIDE * f * cpg.mean_amp(0) * signf(d.x if d.x != 0.0 else 1.0)
	var v_r := STRIDE * f * cpg.mean_amp(1) * signf(d.y if d.y != 0.0 else 1.0)
	speed = (v_l + v_r) * 0.5
	var omega := (v_r - v_l) / TRACK
	_update_behavior(d)

	var up := _up
	var b := global_basis.orthonormalized()
	b = Basis(up.normalized(), omega * dt) * b
	var fwd := (-b.z).normalized()
	var step := fwd * speed * dt
	var pos := global_position

	# obstaculo a frente (parede): sobe nele
	var probe_len := absf(speed * dt) + 0.9
	var dir := fwd * signf(speed if speed != 0.0 else 1.0)
	var wall := _ray(pos + up * 0.7, pos + up * 0.7 + dir * probe_len)
	if wall and wall.normal.dot(up) < 0.6:
		# do chao pode subir em qualquer coisa (inclusive por baixo de uma fruta,
		# andando de cabeca para baixo); de um objeto so passa para outra
		# superficie se ela nao estiver "em balanco" em relacao a atual
		var ndot: float = wall.normal.dot(up)
		if surface_body == null or wall.collider == surface_body or ndot > -0.3:
			_set_on_surface(wall.position, wall.normal, wall.collider, b)
			return
	var p := pos + step
	var hit := _ray(p + up * 1.2, p - up * 2.5)
	if hit:
		_set_on_surface(hit.position, hit.normal, hit.collider, b)
		return
	# borda convexa: contorna a quina
	hit = _ray(p - up * 0.8, p - up * 0.8 - dir * 3.0)
	if hit:
		_set_on_surface(hit.position, hit.normal, hit.collider, b)
		return
	# perdeu a superficie: voa
	_take_off(global_position + Vector3.UP * 30.0 + fwd * 60.0)


func _set_on_surface(p: Vector3, n: Vector3, collider: Object, b := Basis()) -> void:
	if b == Basis():
		b = global_basis.orthonormalized()
	_up = _up.lerp(n.normalized(), 0.35).normalized() if _up.dot(n) > -0.5 else n.normalized()
	var fwd := (-b.z)
	fwd = (fwd - _up * fwd.dot(_up))
	if fwd.length() < 0.01:
		fwd = _up.cross(Vector3.RIGHT)
	fwd = fwd.normalized()
	var x := fwd.cross(_up).normalized()
	global_transform = Transform3D(Basis(x, _up, -fwd), p)
	if collider is Node3D and collider is RigidBody3D:
		surface_body = collider
		_surface_local = surface_body.global_transform.affine_inverse() * global_transform
	elif collider is Node3D and (collider as Node3D).has_method("taste"):
		surface_body = collider
		_surface_local = surface_body.global_transform.affine_inverse() * global_transform
	else:
		surface_body = null


func _follow_surface_body() -> void:
	if not is_instance_valid(surface_body):
		surface_body = null
		return
	var target := surface_body.global_transform * _surface_local
	# se a fruta for arremessada / sacudida, a mosca se assusta e voa
	if surface_body is RigidBody3D:
		var rb := surface_body as RigidBody3D
		if rb.linear_velocity.length() > 250.0 or rb.angular_velocity.length() > 6.0:
			global_transform = target
			if escape_cooldown <= 0.0:
				_escape(rb.linear_velocity)
			return
	global_transform = target
	_up = global_basis.y.normalized()


func _update_behavior(d: Vector2) -> void:
	if _copulating_with:
		behavior = "acasalando"
		return
	if behavior.begins_with("cortejando") or behavior.begins_with("cantando") or (behavior == "botando ovo" and _egg_timer < 1.5):
		return
	if valence < -0.35 and (sense["odor_L"] + sense["odor_R"]) > 40.0:
		behavior = "evitando cheiro (memoria ruim)"
		return
	if m_groom > 0.35:
		behavior = "limpando as antenas"
	elif sense["sugar"] > 0.0 and m_prob > 0.45:
		behavior = "comendo"
	elif sense["bitter"] > 0.0 or m_back > 0.4:
		behavior = "recuando (amargo)" if sense["bitter"] > 0.0 else "andando para tras"
	elif d == Vector2.ZERO:
		behavior = "parada"
	elif (sense["odor_L"] + sense["odor_R"]) > 60.0 and hunger > 0.3:
		behavior = "seguindo cheiro"
	else:
		behavior = "explorando"


# ---------------------------------------------------------------- voo
func _escape(threat_vel := Vector3.ZERO) -> void:
	escape_cooldown = 4.0
	var away := -global_basis.z
	var loom_dir: float = sense["loom_R"] - sense["loom_L"]
	away += global_basis.x * -signf(loom_dir) * 0.8
	if threat_vel.length() > 1.0:
		away += threat_vel.normalized()
	away.y = 0.0
	if away.length() < 0.1:
		away = Vector3(_rng.randf_range(-1, 1), 0, _rng.randf_range(-1, 1))
	var target := global_position + away.normalized() * _rng.randf_range(250.0, 600.0)
	behavior = "FUGA! (Giant Fiber)"
	_take_off(target)
	_vel = (_up * 1.0 + away.normalized() * 0.4).normalized() * FLIGHT_SPEED * 0.8


## Decola em direcao a um ponto; pousa na superficie mais proxima dele.
func _take_off(target: Vector3, target_node: Node3D = null) -> void:
	if state == State.FLY:
		return
	state = State.FLY
	surface_body = null
	_flight_target = target
	_flight_target_node = target_node
	_flight_time = 0.0
	_vel = _up * FLIGHT_SPEED * 0.5
	state_changed.emit(self, state)


func _fly(dt: float) -> void:
	_flight_time += dt
	behavior = "voando" if not behavior.begins_with("FUGA") or _flight_time > 1.0 else behavior
	var target := _flight_target
	if is_instance_valid(_flight_target_node):
		var tr: float = _flight_target_node.call("loom_radius") if _flight_target_node.has_method("loom_radius") else 5.0
		target = _flight_target_node.global_position + Vector3.UP * tr
	var to_t := target - global_position
	var dist := to_t.length()
	var desired := to_t.normalized() * minf(FLIGHT_SPEED, dist * 2.5 + 40.0)
	# pequena oscilacao de voo
	desired += Vector3(sin(_t * 3.1), sin(_t * 4.3) * 0.6, cos(_t * 2.7)) * 25.0
	_vel = _vel.lerp(desired, 1.0 - exp(-dt * 2.8))
	var p := global_position
	var np := p + _vel * dt
	if _flight_time > 0.35:
		var hit := _ray(p, np + _vel.normalized() * 2.0)
		if hit:
			_land(hit.position, hit.normal, hit.collider)
			return
	if dist < 6.0:
		var down := _ray(target + Vector3.UP * 40.0, target + Vector3.DOWN * 400.0)
		if down:
			_land(down.position, down.normal, down.collider)
			return
	if _flight_time > 25.0:
		_flight_target = Vector3(global_position.x, 0, global_position.z)
	var look := _vel if _vel.length() > 1.0 else -global_basis.z
	global_transform = Transform3D(_basis_from(Vector3.UP, look), np)
	_up = Vector3.UP
	cpg.set_descending(0.0, 0.0)
	cpg.step(dt)


func _land(p: Vector3, n: Vector3, collider: Object) -> void:
	state = State.WALK
	_up = n.normalized()
	_set_on_surface(p, n, collider, _basis_from(_up, _vel))
	_vel = Vector3.ZERO
	behavior = "pousou"
	state_changed.emit(self, state)


func fly_to(node: Node3D) -> void:
	if state == State.WALK:
		_take_off(node.global_position, node)


# ---------------------------------------------------------------- carregada
func grab() -> void:
	if dead:
		return
	_punish_t = 3.0  # ser agarrada e aversivo: PPL1 ensina a evitar o cheiro de agora
	_copulating_with = null
	state = State.CARRIED
	surface_body = null
	behavior = "sendo carregada!"
	state_changed.emit(self, state)


func carry_to(t: Transform3D) -> void:
	carrier_target = t


func release(vel: Vector3) -> void:
	if dead:
		state = State.DEAD
		return
	state = State.WALK
	_up = Vector3.UP
	var ang := _rng.randf() * TAU
	_take_off(global_position + Vector3(cos(ang), 0, sin(ang)) * _rng.randf_range(200, 500))
	_vel = vel + Vector3.UP * 80.0
	_flight_time = 0.0


func _carried(dt: float) -> void:
	global_transform = global_transform.interpolate_with(carrier_target, 1.0 - exp(-dt * 20.0))
	cpg.set_descending(1.3, 1.3, 1.6)
	cpg.step(dt)


# ---------------------------------------------------------------- animacao
func _animate(dt: float) -> void:
	# pernas: CPG com passadas reais
	for i in 6:
		var leg: String = FlyCPG.LEGS[i]
		var a := cpg.leg_angles(i)
		body.set_joint(leg + "_coxa", a[2], a[0], a[1])
		body.set_joint(leg + "_trochanterfemur", 0.0, a[3], a[4])
		body.set_joint(leg + "_tibia", 0.0, a[5], 0.0)
		body.set_joint(leg + "_tarsus1", 0.0, a[6], 0.0)

	# limpeza das antenas (aDN): patas dianteiras esfregam a cabeca
	if m_groom > 0.2 and state == State.WALK:
		var w := clampf((m_groom - 0.2) * 3.0, 0.0, 1.0)
		var ph := _t * TAU * 5.0
		for leg in ["lf", "rf"]:
			var side := 0.0 if leg == "lf" else PI
			var c := body.get_joint(leg + "_coxa")
			body.set_joint(leg + "_coxa", c.x, lerpf(c.y, deg_to_rad(-22.0 + 8.0 * sin(ph + side)), w), c.z)
			var fe := body.get_joint(leg + "_trochanterfemur")
			body.set_joint(leg + "_trochanterfemur", 0.0, lerpf(fe.y, deg_to_rad(-145.0 + 12.0 * sin(ph + side)), w), fe.z)
			body.set_joint(leg + "_tibia", 0.0, lerpf(body.get_joint(leg + "_tibia").y, deg_to_rad(105.0 + 25.0 * sin(ph * 1.0 + side + 1.0)), w), 0.0)
		body.set_joint("c_head", 0.0, deg_to_rad(8.0 * w), deg_to_rad(10.0 * sin(ph * 0.5)) * w)
	else:
		# cabeca acompanha levemente o giro
		body.set_joint("c_head", 0.0, 0.0, clampf(m_turn * 0.25, -0.3, 0.3))

	# probocide (MN9)
	var pe := clampf(m_prob, 0.0, 1.0)
	var lick := sin(_t * TAU * 4.0) * 0.15 * pe
	body.set_joint("c_rostrum", 0.0, deg_to_rad(-50.0) * (pe + lick), 0.0)
	body.set_joint("c_haustellum", 0.0, deg_to_rad(50.0) * pe, 0.0)

	# asas
	if behavior.begins_with("cantando"):
		# canto de corte: uma asa estendida vibrando
		body.set_joint("l_wing", 0.0, 0.0, deg_to_rad(-80.0 + 8.0 * sin(_t * 90.0)))
		body.set_joint("r_wing", 0.0, 0.0, 0.0)
	elif state == State.FLY or (state == State.CARRIED and fmod(_t, 1.3) < 0.5):
		_wing_phase += dt * TAU * 38.0  # 200+ Hz real; aliasado para ser visivel
		var stroke := deg_to_rad(-85.0 + 65.0 * sin(_wing_phase))
		var rot := deg_to_rad(25.0 * cos(_wing_phase))
		body.set_joint("l_wing", 0.0, rot, stroke)
		body.set_joint("r_wing", 0.0, rot, stroke)
		body.set_joint("l_haltere", 0.0, 0.8 * sin(_wing_phase + PI), 0.0)
		body.set_joint("r_haltere", 0.0, 0.8 * sin(_wing_phase + PI), 0.0)
	else:
		for wg in ["l_wing", "r_wing"]:
			var cur := body.get_joint(wg)
			body.set_joint(wg, 0.0, lerpf(cur.y, 0.0, 0.2), lerpf(cur.z, 0.0, 0.2))

	# antenas tremem com odor forte
	var od := clampf((sense["odor_L"] + sense["odor_R"]) / 300.0, 0.0, 1.0)
	for s in ["l", "r"]:
		body.set_joint(s + "_pedicel", 0.0, deg_to_rad(6.0 * od * sin(_t * 23.0)), 0.0)
	body.apply_pose()


# ---------------------------------------------------------------- util
func _ray(from: Vector3, to: Vector3) -> Dictionary:
	var q := PhysicsRayQueryParameters3D.create(from, to, WORLD_MASK)
	q.collide_with_areas = false
	q.hit_back_faces = false
	return get_world_3d().direct_space_state.intersect_ray(q)


## Base ortonormal com +Y = up e -Z o mais proximo possivel de fwd_hint.
static func _basis_from(up: Vector3, fwd_hint: Vector3) -> Basis:
	up = up.normalized()
	var f := fwd_hint - up * fwd_hint.dot(up)
	if f.length() < 0.001:
		f = up.cross(Vector3.RIGHT)
		if f.length() < 0.001:
			f = up.cross(Vector3.FORWARD)
	f = f.normalized()
	return Basis(f.cross(up).normalized(), up, -f)


func head_position() -> Vector3:
	return body.segment_position("c_head")


## decisao de voar ate comida quando faminta e sem cheiro por perto
func _process(_dt: float) -> void:
	if dead or state != State.WALK or m_groom > 0.3 or _copulating_with:
		return
	# memoria ruim do cheiro da fruta onde esta: vai embora
	if valence < -0.35 and surface_body is Fruit and _rng.randf() < _dt * 0.3:
		behavior = "evitando (lembra de algo ruim)"
		var a := _rng.randf() * TAU
		_take_off(global_position + Vector3(cos(a), 0.3, sin(a)) * 400.0)
		return
	# saciada em cima da fruta: vai embora voando
	if hunger < 0.4 and m_prob < 0.4 and surface_body is Fruit and _rng.randf() < _dt * 0.06:
		var ang := _rng.randf() * TAU
		behavior = "saciada, indo embora"
		_take_off(global_position + Vector3(cos(ang), 0.3, sin(ang)) * _rng.randf_range(300.0, 900.0))
		return
	if hunger < 0.6 or _since_meal < 35.0:
		return
	if _rng.randf() < _dt * 0.08:
		# escolhe a fruta com mais "cheiro percebido" (forca x distancia)
		var best: Node3D = null
		var best_score := 0.0
		for src in get_tree().get_nodes_in_group("odor_source"):
			var s = src
			if s.has_method("taste") and float(s.taste().get("bitter", 0)) > 0:
				continue
			var dd: float = s.global_position.distance_to(global_position)
			var score: float = s.odor_strength() * exp(-dd / 900.0)
			if score > best_score and dd > 60.0:
				best_score = score
				best = s
		if best:
			_since_meal = 20.0
			behavior = "voando ate comida"
			_no_odor_time = 0.0
			fly_to(best)
