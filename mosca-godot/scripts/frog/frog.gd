class_name Frog
extends Node3D
## Ra adulta com o conectoma sintetico da ra (brain/full/ra.*, ver
## tools/build_amphibian_brain.py) na GPU, corpo com orgaos e musculos
## (FrogModel + AmphibianOrgans) e olhos de raios (AmphibianRetina).
##
## Nada aqui e animacao pronta. O ciclo, a cada tick:
##   olhos (raios) + ouvidos + orgaos + pele -> canais sensoriais do conectoma
##   conectoma -> motoneuronios: extensores de cada perna (hop_L/R),
##     orientacao (orient_L/R), fuga, hipoglosso (lingua), gerador
##     respiratorio (bomba bucal), simpatico/vago (coracao), vocal (canto)
##   medula: o comando continuo de salto do tronco encefalico vira surtos
##     dos extensores (gerador de salto espinhal) com uma fase de recolher
##   musculos: a ativacao dos extensores estica as pernas; perna esticando
##     com os pes no chao empurra o corpo -> o pulo sai da forca do musculo;
##     diferenca entre esquerda e direita vira giro; na agua os mesmos chutes
##     dao impulso
##   orgaos: coracao bate no ritmo do simpatico/vago, a garganta bombeia ar
##     para os pulmoes, o O2 do sangue cai com o esforco; o estomago digere
## A "decisao" (fome, sede de agua, medo, parceiro) so entra como impulso
## nos canais de exploracao do cerebro (vontade de ir para um lado), como os
## sinais que o prosencefalo manda para o tronco encefalico.

enum State { SIT, AIR, SWIM, CARRIED, DEAD }

const WORLD_MASK := 1 | 2
const GRAV := 9800.0
const SVL := 45.0
const PREY_KEYS := {
	"mosca": [1.0, 0.0, 0.0, 0.0, 0.0, 0.0],
	"larva": [0.0, 1.0, 0.0, 0.0, 0.0, 0.0],
	"pedra": [0.0, 0.0, 1.0, 0.0, 0.0, 0.0],
	"fruta": [0.0, 0.0, 0.0, 1.0, 0.0, 0.0],
	"girino": [0.0, 0.0, 0.0, 0.0, 0.0, 1.0],
}

var uid := 0
var fly_name := "Ra"
var genome: Genome
var sex := "F"
var generation := 1
var lineage := 0
var parents: Array = []
var wiring: Array = []
var mind: CreatureMemory
var brain
var chem := NeuroChem.new()
var org := AmphibianOrgans.new()
var retina := AmphibianRetina.new()
var model: FrogModel
var state := State.SIT
var behavior := "sentada"
var decision := "explorar"
var decision_scores := {}
var last_lesson := ""
var age := 0.0
var growth := 1.0
var energy := 0.7
var hydration := 1.0
var health := 1.0
var pain := 0.0
var dead := false
var death_reason := ""
var eggs_cooldown := 0.0
var velocity := Vector3.ZERO
var sense := {"presa_L": 0.0, "presa_R": 0.0, "sombra_L": 0.0, "sombra_R": 0.0, "presa_perto": 0.0, "som_L": 0.0, "som_R": 0.0}
var ext := {"L": 0.0, "R": 0.0}          # extensao das pernas (0 dobrada, 1 esticada)
var ext_v := {"L": 0.0, "R": 0.0}
var act := {"L": 0.0, "R": 0.0}          # ativacao dos extensores
var tongue_act := 0.0

var _rng := RandomNumberGenerator.new()
var _decide_t := 0.0
var _look_t := 0.0
var _steer := 0.0                        # -1 esquerda .. 1 direita (vontade)
var _drive := 0.0                        # 0..1 vontade de se mover
var _goal := Vector3.INF
var _tongue_t := -1.0
var _tongue_cd := 0.0
var _tongue_hit: Node3D = null
var _tongue_tip := Vector3.ZERO
var _tongue_kind := ""
var _swallow_t := 0.0
var _reward_t := 0.0
var _punish_t := 0.0
var _taste_good := 0.0
var _taste_bad := 0.0
var _carry_t := Transform3D.IDENTITY
var _call := 0.0
var _call_t := 0.0
var _amplexus: Frog = null
var _dead_t := 0.0
var _hit_t := -99.0
var _blink := 0.0
var _jaw := 0.0
var _launch_cd := 0.0
var _dive_t := 0.0
# forrageio (senta-e-espera com tempo de desistencia, depois muda de lugar)
var _no_prey_t := 0.0                    # tempo sem ver presa
var _pause_t := 0.0                      # parada para olhar em volta depois de uns pulos
var _hops := 0
var _hops_goal := 2
var _forage_goal := Vector3.INF
var _food_spots: Array = []              # [posicao, forca] onde ja comeu
var _land_vy := 0.0
var _hop_ref := 0.0
var _hop_burst := 0.0
var _hop_amp := 1.0
var _hop_scale := 1.0        # pulo longo (viagem/fuga) ou curto (aproximar da presa)
var defects := {}                        # defeitos visiveis/funcionais (genetica)
var _last_yaw := 0.0
var _last_cam := Vector3.ZERO
var _irritate_t := 0.0                   # algo ruim na boca/pele: reflexo de limpar
var _wipe := {"L": 0.0, "R": 0.0}
var _dark := 0.0
var _walking := 0.0


func _ready() -> void:
	_rng.randomize()
	add_to_group("frogs")
	add_to_group("creatures")
	add_to_group("loomer")
	if genome == null:
		genome = Genome.random_founder(_rng)
	if uid == 0:
		uid = LifeManager.instance.next_uid() if LifeManager.instance else randi()
	if wiring.size() < 3:
		wiring = LifeManager.instance.random_wiring() if LifeManager.instance else [randi(), randi(), randi()]
	if mind == null:
		mind = CreatureMemory.new()
	brain = GpuBrain.create("ra")
	if brain == null:
		brain = FlyBrain.from_dict(DefaultCircuit.build())
	brain.set_wiring(int(wiring[0]), int(wiring[1]), int(wiring[2]), genome.get_gene("wiring_var"))
	brain.set_mode(1)
	defects = _defects()
	org.heart_defect = genome.has_defect("cardiopatia")
	model = FrogModel.new()
	add_child(model)
	model.set_defects(defects)
	model.build(SVL, sex == "M", genome.get_gene("hue"), uid)
	_apply_scale()
	var area := Area3D.new()
	area.collision_layer = 4
	area.collision_mask = 0
	area.monitoring = false
	var cs := CollisionShape3D.new()
	var sh := SphereShape3D.new()
	sh.radius = SVL * 0.45
	cs.shape = sh
	cs.position.y = SVL * 0.2
	area.add_child(cs)
	area.set_meta("creature", self)
	model.add_child(area)
	_snap.call_deferred()


## Defeitos geneticos (alelo recessivo em dose dupla). O lado afetado sai
## do numero do individuo, entao e sempre o mesmo para a mesma ra.
func _defects() -> Dictionary:
	var side := "L" if uid % 2 == 0 else "R"
	var d := {}
	if genome.has_defect("ectromelia"):
		d["membro_ausente"] = ["femur_" + side]
		d["perna_ausente"] = side
	if genome.has_defect("polimelia"):
		d["polimelia"] = true
	if genome.has_defect("anoftalmia"):
		d["anoftalmia"] = "R" if side == "L" else "L"
	if genome.has_defect("albinismo"):
		d["albinismo"] = true
	if genome.has_defect("escoliose"):
		d["escoliose"] = true
	return d


func life_expectancy() -> float:
	return genome.get_gene("lifespan") * 4.0 * (0.6 if genome.has_defect("cardiopatia") else 1.0)


## Forca do corpo: cai com a velhice e com defeitos de locomocao.
func vigor() -> float:
	var v := Mortality.vigor(age, life_expectancy())
	if defects.has("escoliose"):
		v *= 0.7
	if defects.has("polimelia"):
		v *= 0.85
	return v


func size() -> float:
	return SVL * genome.get_gene("size") * lerpf(0.35, 1.0, growth)


func _apply_scale() -> void:
	model.scale = Vector3.ONE * size() / SVL
	retina.near_range = size() * 1.25


func _exit_tree() -> void:
	if brain and brain.has_method("free_gpu"):
		brain.free_gpu()


## saida do conectoma (ou reflexo simples se nao ha GPU)
func _out(n: String) -> float:
	if brain is GpuBrain:
		return brain.output(n)
	match n:
		"hop_L", "hop_R":
			return _drive * 0.8 + 1.2 * maxf(sense["sombra_L"], sense["sombra_R"]) / 150.0
		"orient_L":
			return clampf(-_steer, 0.0, 1.0) + sense["presa_L"] / 160.0
		"orient_R":
			return clampf(_steer, 0.0, 1.0) + sense["presa_R"] / 160.0
		"snap":
			return sense["presa_perto"] / 150.0 * (1.0 - energy)
		"respirar":
			return (0.9 - org.o2) * 3.0
		"escape_L":
			return sense["sombra_L"] / 150.0
		"escape_R":
			return sense["sombra_R"] / 150.0
	return 0.0


# ---------------------------------------------------------------- principal
func _physics_process(dt: float) -> void:
	if dt <= 0.0:
		return
	if dead:
		_dead_t += dt
		if _dead_t > LifeManager.DAY * 0.5:
			queue_free()
		return
	age += dt
	var cam := get_viewport().get_camera_3d() as Spectator
	var followed := cam != null and cam.follow == self
	brain.focused = followed
	brain.set_mode(1)   # conectoma sintetico calibrado no campo medio
	mind.decay(dt)
	_reward_t = maxf(0.0, _reward_t - dt)
	_punish_t = maxf(0.0, _punish_t - dt)
	_tongue_cd = maxf(0.0, _tongue_cd - dt)
	_launch_cd = maxf(0.0, _launch_cd - dt)
	eggs_cooldown = maxf(0.0, eggs_cooldown - dt)
	_physiology(dt)
	if dead:
		return
	if state == State.CARRIED:
		global_transform = global_transform.interpolate_with(_carry_t, 1.0 - exp(-dt * 20.0))
		pain = maxf(pain, 0.6)
		# segurada: grito de socorro; macho da o canto de soltura; pele solta muco
		if _out("grito") > 0.4:
			behavior = "gritando por socorro (segurada)"
		elif sex == "M" and _out("canto_soltura") > 0.3:
			behavior = "canto de soltura (me larga!)"
		else:
			behavior = "sendo carregada! (se debatendo)"
	else:
		_check_crush()
		if dead:
			return
	_sense(dt)
	brain.advance(dt)
	chem.update(dt, brain, energy, 0.5, _taste_good, _taste_bad)
	brain.learning_gain = genome.get_gene("learning")
	if state != State.CARRIED:
		_decide(dt)
		_muscles(dt)
		_body_physics(dt)
		_tongue_update(dt)
	_draw_state(dt)


func _physiology(dt: float) -> void:
	var day := LifeManager.DAY
	var dl := GardenWorld.instance.daylight() if GardenWorld.instance else 1.0
	var pd := Pond.at(global_position)
	var in_water := state == State.SWIM or (pd != null and pd.depth_at(global_position) > size() * 0.2)
	var nostril_out := not in_water or (pd != null and global_position.y > pd.level - size() * 0.2 and _dive_t <= 0.0)
	var temp := 16.0 + 10.0 * dl
	# metabolismo basal (ectotermo) + digestao pelo estomago/intestino
	energy -= dt / (4.0 * day) * genome.get_gene("metabolism") * (1.0 + org.work)
	energy = minf(1.0, energy + org.step(dt, brain, nostril_out, in_water, hydration, temp))
	if in_water:
		hydration = minf(1.0, hydration + dt / 60.0)
	else:
		hydration -= dt / (0.6 * day) * (0.4 + 1.2 * dl) * (1.6 if defects.has("albinismo") else 1.0)   # pele resseca, mais no sol
	pain = maxf(0.0, pain - dt * 0.6)
	health = minf(1.0, health + dt / 600.0)
	if growth < 1.0:
		growth = minf(1.0, growth + dt / (4.0 * day) * clampf(energy * 1.5, 0.1, 1.0))
		_apply_scale()
	if energy <= 0.0:
		energy = 0.0
		health -= dt / (0.3 * day)
		if health <= 0.0:
			die("fome (ra)")
	if hydration <= 0.0:
		hydration = 0.0
		health -= dt / (0.1 * day)
		if health <= 0.0:
			die("desidratada")
	if org.o2 < 0.15:
		health -= dt / 120.0
		if health <= 0.0:
			die("asfixia (ra)")
	if org.heart_defect and org.work > 0.8:
		health -= dt / 400.0          # coracao fraco nao aguenta esforco
		if health <= 0.0:
			die("insuficiencia cardiaca (ra)")
			return
	# velhice (Gompertz): risco cresce com a idade; a velha fica fraca
	if Mortality.dies_of_age(age, life_expectancy(), dt, _rng):
		die("velhice (ra)")


func die(reason: String, cause: Object = null) -> void:
	if dead:
		return
	dead = true
	death_reason = reason
	behavior = "morta (%s)" % reason
	state = State.DEAD
	model.rotation.z = PI * 0.9
	model.hide_tongue()
	if LifeManager.instance:
		LifeManager.instance.report_death(self, reason, cause)


func _check_crush() -> void:
	if Engine.get_physics_frames() < 180:
		return
	Hazards.refresh(get_tree())
	var r := Hazards.check(global_position, size() * 0.35, size() * 0.4, null)
	if r.is_empty():
		return
	if r.has("crush"):
		# uma fruta caindo so da um susto e uma pancada numa ra (ela e grande
		# e o corpo e elastico); ela foge pulando
		r = {"hit": 0.15, "obj": r["crush"]}
		_dive_t = 4.0
		_pause_t = 0.0
	if age - _hit_t < 0.6:
		return
	_hit_t = age
	hurt(float(r["hit"]))
	mind.add_danger(global_position, size() * 4.0, float(r["hit"]), "levou uma batida")


func hurt(amount: float) -> void:
	pain = clampf(pain + amount, 0.0, 2.0)
	health -= amount * 0.3
	_punish_t = maxf(_punish_t, 0.5)
	if health <= 0.0:
		die("ferimentos (ra)")


# ---------------------------------------------------------------- sentidos
func _eyes() -> Array:
	var ep := model.eye_positions()
	var up := global_basis.y.normalized()
	var fwd := (-global_basis.z).normalized()
	var right := global_basis.x.normalized()
	return [[ep[0], (fwd * 0.55 - right * 0.8 + up * 0.25), "L"], [ep[1], (fwd * 0.55 + right * 0.8 + up * 0.25), "R"]]


func _sense(dt: float) -> void:
	_look_t -= dt
	if _look_t <= 0.0:
		retina.look(self, _eyes(), maxf(0.066, -_look_t + 0.066), _prey_candidates())
		_look_t = 0.066
		sense["presa_L"] = retina.prey["L"]
		sense["presa_R"] = retina.prey["R"]
		sense["presa_perto"] = retina.prey_near
		sense["sombra_L"] = retina.threat["L"]
		sense["sombra_R"] = retina.threat["R"]
		var no_eye: String = defects.get("anoftalmia", "")
		if no_eye != "":
			sense["presa_" + no_eye] = 0.0
			sense["sombra_" + no_eye] = 0.0
			retina.light[no_eye] = 0.0
		_hear()
		if maxf(sense["presa_L"], sense["presa_R"]) > 15.0 or sense["presa_perto"] > 10.0:
			_no_prey_t = 0.0
	_no_prey_t += dt
	_pause_t = maxf(0.0, _pause_t - dt)
	var hunger := clampf(1.0 - energy, 0.0, 1.0)
	var inp := org.brain_inputs()
	brain.set_input("presa_L", sense["presa_L"])
	brain.set_input("presa_R", sense["presa_R"])
	brain.set_input("presa_perto", sense["presa_perto"])
	brain.set_input("sombra_L", sense["sombra_L"])
	brain.set_input("sombra_R", sense["sombra_R"])
	brain.set_input("luz_L", retina.light["L"])
	brain.set_input("luz_R", retina.light["R"])
	brain.set_input("som_L", sense["som_L"])
	brain.set_input("som_R", sense["som_R"])
	brain.set_input("fome", 100.0 * hunger)
	brain.set_input("glicose", 110.0 * energy)
	brain.set_input("paladar_bom", 150.0 * _taste_good)
	brain.set_input("paladar_ruim", 150.0 * _taste_bad)
	brain.set_input("reward", 120.0 if _reward_t > 0.0 else 0.0)
	brain.set_input("punish", 140.0 if _punish_t > 0.0 else 0.0)
	brain.set_input("dor", 200.0 * clampf(pain, 0.0, 1.0))
	brain.set_input("tato", 150.0 if state == State.CARRIED else 0.0)
	brain.set_input("equilibrio", 100.0 if state == State.AIR else 10.0)
	brain.set_input("temperatura", 40.0 + 60.0 * (GardenWorld.instance.daylight() if GardenWorld.instance else 1.0))
	brain.set_input("oxigenio_baixo", inp["oxigenio_baixo"])
	brain.set_input("pulmao_cheio", inp["pulmao_cheio"])
	# retina em 8 setores (mapa retinotopico no teto); sem um olho, metade apaga
	var no_eye: String = defects.get("anoftalmia", "")
	for k in 8:
		var blind := (no_eye == "L" and k < 4) or (no_eye == "R" and k >= 4)
		brain.set_input("presa_s%d" % k, 0.0 if blind else retina.prey_sector[k])
		brain.set_input("sombra_s%d" % k, 0.0 if blind else retina.threat_sector[k])
	var dl := GardenWorld.instance.daylight() if GardenWorld.instance else 1.0
	# fluxo optico do proprio giro (optocinetico)
	var yaw_now := global_rotation.y
	var yaw_rate := wrapf(yaw_now - _last_yaw, -PI, PI) / maxf(dt, 1e-3)
	_last_yaw = yaw_now
	brain.set_input("fluxo_L", clampf(yaw_rate * 60.0, 0.0, 150.0))
	brain.set_input("fluxo_R", clampf(-yaw_rate * 60.0, 0.0, 150.0))
	brain.set_input("luz_pineal", 100.0 * dl)
	brain.set_input("escuro_pineal", 100.0 * (1.0 - dl))
	brain.set_input("pele_seca", 150.0 * clampf(1.0 - hydration, 0.0, 1.0))
	brain.set_input("estomago_cheio", 300.0 * clampf(org.stomach, 0.0, 0.5))
	brain.set_input("pressao", 20.0 + org.heart_rate * 0.8)
	brain.set_input("vibracao", _vibration())
	brain.set_input("tato_cabeca", 150.0 if _irritate_t > 0.0 else 0.0)
	brain.set_input("irritante_L", 150.0 if _irritate_t > 0.0 else 0.0)
	brain.set_input("irritante_R", 150.0 if _irritate_t > 0.0 else 0.0)
	brain.set_input("polegar", 150.0 if _amplexus and sex == "M" else 0.0)
	for sd in ["L", "R"]:
		brain.set_input("proprio_" + sd, clampf(absf(ext_v[sd]) * 8.0, 0.0, 150.0))
	# epoca de reproducao: hormonios sexuais dos adultos maduros, mais a noite
	var mature := age > LifeManager.DAY * 3.0 and growth >= 0.95
	var repro := 0.0
	if mature and (sex == "M" or eggs_cooldown <= 0.0):
		repro = 120.0 * (0.35 + 0.65 * (1.0 - dl)) * clampf(energy * 1.6, 0.0, 1.0)
	brain.set_input("reproducao", repro)
	_irritate_t = maxf(0.0, _irritate_t - dt)
	# vontade vinda da decisao -> reticular (lado para onde quer ir)
	var base := 10.0 + 90.0 * _drive
	brain.set_input("explore_L", base * (1.0 + clampf(-_steer, 0.0, 1.0)) * (1.0 - 0.8 * clampf(_steer, 0.0, 1.0)) + _rng.randf() * 6.0)
	brain.set_input("explore_R", base * (1.0 + clampf(_steer, 0.0, 1.0)) * (1.0 - 0.8 * clampf(-_steer, 0.0, 1.0)) + _rng.randf() * 6.0)
	_taste_good = maxf(0.0, _taste_good - dt * 0.8)
	_taste_bad = maxf(0.0, _taste_bad - dt * 0.8)


## Saculo: vibracao do chao (fruta ou pedra caindo por perto, o jogador
## andando perto).
func _vibration() -> float:
	var v := 0.0
	for item: Array in Hazards.falling:
		if is_instance_valid(item[0]):
			var d := (item[1] as Vector3).distance_to(global_position)
			v = maxf(v, 160.0 * clampf(1.0 - d / 1500.0, 0.0, 1.0))
	var cam := get_viewport().get_camera_3d()
	if cam:
		var d := cam.global_position.distance_to(global_position)
		var sp := cam.global_position.distance_to(_last_cam) / maxf(get_physics_process_delta_time(), 1e-3)
		_last_cam = cam.global_position
		if d < 400.0 and sp > 150.0 and cam.global_position.y - global_position.y < 150.0:
			v = maxf(v, 90.0 * clampf(1.0 - d / 400.0, 0.0, 1.0))
	return v


## Ouvido (timpano de cada lado): canto das outras ras.
func _hear() -> void:
	var right := global_basis.x.normalized()
	var sl := 0.0
	var sr := 0.0
	for f in get_tree().get_nodes_in_group("calling_frogs"):
		if f == self:
			continue
		var to := (f as Node3D).global_position - global_position
		var d := to.length()
		if d > 2500.0:
			continue
		var lvl := 180.0 * clampf(1.0 - d / 2500.0, 0.0, 1.0)
		var side := right.dot(to.normalized())
		sl = maxf(sl, lvl * clampf(0.6 - side * 0.5, 0.1, 1.0))
		sr = maxf(sr, lvl * clampf(0.6 + side * 0.5, 0.1, 1.0))
	sense["som_L"] = sl
	sense["som_R"] = sr


func _prey_candidates() -> Array:
	var out: Array = []
	for n in get_tree().get_nodes_in_group("flies"):
		var f := n as Fly
		if not f.dead and f.state != Fly.State.CARRIED:
			out.append([f, "mosca", 1.3])
	for n in get_tree().get_nodes_in_group("larvae"):
		var l := n as Larva
		if not l.dead and l.hidden < 0.5:
			out.append([l, "larva", l.size_mm * 0.3])
	for n in get_tree().get_nodes_in_group("tadpoles"):
		if not n.get("dead"):
			out.append([n, "girino", float(n.call("body_len")) * 0.25])
	for n in get_tree().get_nodes_in_group("grabbable"):
		var rb := n as RigidBody3D
		if rb and not rb.freeze:
			var rad: float = rb.call("loom_radius") if rb.has_method("loom_radius") else 20.0
			if rad <= 14.0:
				out.append([rb, "fruta" if rb is Fruit else "pedra", rad])
	return out


# ---------------------------------------------------------------- decisao (vontade)
func _decide(dt: float) -> void:
	_decide_t -= dt
	if _decide_t <= 0.0:
		_decide_t = 0.35
		_choose()
	# direcao da vontade -> lado (esquerda/direita) para o reticular
	_steer = 0.0
	if _goal != Vector3.INF:
		var to := _goal - global_position
		to.y = 0.0
		if to.length() > size() * 0.6:
			var ang := (-global_basis.z).signed_angle_to(to, Vector3.UP)   # + = esquerda
			_steer = clampf(-ang * 1.2, -1.0, 1.0)
		else:
			_drive *= 0.3


func _choose() -> void:
	var dl := GardenWorld.instance.daylight() if GardenWorld.instance else 1.0
	var hunger := clampf(1.0 - energy, 0.0, 1.0)
	# ras sao senta-e-espera, mas desistem de um lugar sem presa (tempo de
	# desistencia: mais curto com fome) e vao procurar em outro; caçam mais
	# no crepusculo e a noite, e no sol forte do meio-dia se abrigam
	var give_up := lerpf(45.0, 12.0, hunger)
	var stay := exp(-_no_prey_t / give_up)
	var sees: bool = maxf(sense["presa_L"], sense["presa_R"]) > 15.0 or float(sense["presa_perto"]) > 10.0
	# relogio: a melatonina da pineal marca a noite (ras caçam mais a noite);
	# a corticosterona do estresse tira a fome; a vasotocina e o GnRH dao
	# vontade de cantar; a sede (pele seca) manda para a agua
	var night := maxf(1.0 - dl, clampf(_out("melatonina"), 0.0, 1.0))
	var stress := clampf(_out("cort") * 1.5, 0.0, 1.0)
	var sc := {"explorar": 0.12, "esperar presa": (0.25 + 0.55 * hunger) * stay + (0.9 if sees else 0.0)}
	sc["forragear"] = (0.15 + hunger) * (0.35 + 0.9 * (1.0 - stay)) * (0.6 + 0.6 * night) * (1.0 - 0.5 * stress) if not sees else 0.0
	sc["esperar presa"] = float(sc["esperar presa"]) * (1.0 - 0.4 * stress)
	sc["ir para a agua"] = (1.0 - hydration) * 1.6 + 0.3 * mind.danger_at(global_position) + 1.2 * _out("sede")
	sc["respirar"] = (0.6 - org.o2) * 3.0 if state == State.SWIM else 0.0
	sc["evitar"] = mind.danger_at(global_position) * 1.1
	sc["descansar"] = (0.15 + 0.3 * dl) * (1.0 - hunger) * (1.0 - hunger)
	if dl > 0.75 and state != State.SWIM:
		sc["abrigar"] = (dl - 0.75) * 2.4 * (0.4 + (1.0 - hydration)) * (1.0 - 0.6 * hunger)
	var mature := age > LifeManager.DAY * 3.0 and growth >= 0.95
	var pd := Pond.nearest(global_position)
	var near_water := pd != null and pd.dist_to_water(global_position) < 120.0
	if mature and sex == "M" and dl < 0.35 and hunger < 0.6:
		sc["cantar"] = 0.8 * (1.0 - dl) + (0.3 if near_water else -0.2) + 0.3 * _out("call") + 0.6 * _out("avt") + 0.4 * _out("gnrh")
	if mature and sex == "F" and eggs_cooldown <= 0.0 and dl < 0.4 and hunger < 0.6 and _nearest_caller():
		sc["procurar parceiro"] = 0.9 + (sense["som_L"] + sense["som_R"]) / 400.0
	var pick := decision if sc.has(decision) else "explorar"
	var pick_v := float(sc.get(pick, 0.0)) + 0.1
	for k: String in sc:
		if float(sc[k]) > pick_v:
			pick_v = sc[k]
			pick = k
	decision = pick
	decision_scores = sc
	_goal = Vector3.INF
	_drive = 0.0
	if decision != "cantar":
		remove_from_group("calling_frogs")
	match decision:
		"ir para a agua":
			if pd:
				_goal = Vector3(pd.center.x, 0, pd.center.y)
				_drive = 0.9
		"evitar":
			var dz := mind.nearest_danger(global_position)
			if dz != Vector3.INF:
				_goal = global_position + (global_position - dz).normalized() * 400.0
				_drive = 0.8
		"cantar":
			if pd and pd.dist_to_water(global_position) > 60.0 and state != State.SWIM:
				_goal = pd.shore_point(global_position)
				_drive = 0.7
			elif _out("call") > 0.12:
				add_to_group("calling_frogs")      # o gerador vocal (DTAM) esta ligado: canta
			else:
				remove_from_group("calling_frogs")
		"procurar parceiro":
			var m := _nearest_caller()
			if m:
				_goal = m.global_position
				_drive = 0.8
				if m.global_position.distance_to(global_position) < size() * 1.3:
					_start_amplexus(m)
		"explorar":
			if _rng.randf() < 0.15:
				var a := _rng.randf() * TAU
				_goal = global_position + Vector3(cos(a), 0, sin(a)) * size() * 4.0
				_drive = 0.5
		"forragear":
			if _pause_t > 0.0:
				_drive = 0.0      # parada, olhos varrendo a volta
			else:
				if _forage_goal == Vector3.INF or _forage_goal.distance_to(global_position) < size() * 1.5:
					_forage_goal = _pick_forage_goal()
				_goal = _forage_goal
				_drive = 0.65 * vigor()
		"abrigar":
			var sh := _shade_spot()
			if sh != Vector3.INF:
				_goal = sh
				_drive = 0.6
		"respirar":
			_dive_t = 0.0


## Para onde ir procurar comida: lugares onde ja comeu (memoria), frutas no
## chao (moscas se juntam ali), a beira do lago (insetos), ou um rumo novo.
func _pick_forage_goal() -> Vector3:
	var best := Vector3.INF
	var best_s := 0.0
	for fs: Array in _food_spots:
		var p: Vector3 = fs[0]
		var d := p.distance_to(global_position)
		var sc: float = float(fs[1]) * 1.2 / (1.0 + d / 800.0)
		if d > size() * 2.0 and sc > best_s:
			best_s = sc
			best = p
	for n in get_tree().get_nodes_in_group("odor_source"):
		var fr := n as Fruit
		if fr == null or fr.hanging:
			continue
		var d := fr.global_position.distance_to(global_position)
		if d < 2500.0 and d > size() * 2.0:
			var sc := 0.9 / (1.0 + d / 600.0) * (1.0 - 0.5 * minf(mind.danger_at(fr.global_position), 1.0))
			if sc > best_s:
				best_s = sc
				best = fr.global_position + Vector3(_rng.randf_range(-1, 1), 0, _rng.randf_range(-1, 1)) * size() * 1.5
	var pd := Pond.nearest(global_position)
	if pd and _rng.randf() < 0.3:
		var sp := pd.shore_point(global_position)
		if sp.distance_to(global_position) > size() * 3.0 and 0.35 > best_s:
			best = sp
			best_s = 0.35
	if best == Vector3.INF or _rng.randf() < 0.25:
		var a := _rng.randf() * TAU
		best = global_position + Vector3(cos(a), 0, sin(a)) * size() * _rng.randf_range(4.0, 9.0)
	return best


## Sombra mais perto (debaixo de uma arvore) ou a beira d'agua.
func _shade_spot() -> Vector3:
	var best := Vector3.INF
	var bd := 3000.0
	for t in get_tree().get_nodes_in_group("trees"):
		var p := (t as Node3D).global_position
		var d := p.distance_to(global_position)
		if d < bd:
			bd = d
			best = p + (global_position - p).normalized() * 150.0
	if bd < 250.0:
		return Vector3.INF   # ja esta na sombra
	return best


func _nearest_caller() -> Frog:
	var best: Frog = null
	var bd := 2500.0
	for f in get_tree().get_nodes_in_group("calling_frogs"):
		var fr := f as Frog
		if fr == self or fr.dead:
			continue
		var d := fr.global_position.distance_to(global_position)
		if d < bd:
			bd = d
			best = fr
	return best


# ---------------------------------------------------------------- musculos
## Motoneuronios -> ativacao dos musculos (dinamica de ativacao ~20 ms) ->
## extensao das pernas. Extensores fortes esticam rapido; sem ativacao os
## flexores e a elasticidade dobram a perna de volta.
func _muscles(dt: float) -> void:
	var gain := genome.get_gene("motor_gain")
	# gerador de salto da medula: um comando continuo do tronco encefalico
	# (hop_L/R) vira surtos dos extensores (~90 ms), seguidos da fase em que os
	# flexores recolhem as pernas (refratario); com mais comando, surto mais forte
	var cmd := (_out("hop_L") + _out("hop_R")) * 0.5 * gain
	_hop_ref = maxf(0.0, _hop_ref - dt)
	_hop_burst = maxf(0.0, _hop_burst - dt)
	# o salto sai quando ha motivo: fuga, presa a frente, ou indo para um lugar
	# ja virada para ele (a ra gira primeiro, depois pula)
	var fleeing: bool = _out("escape_L") + _out("escape_R") > 0.4 or _dive_t > 0.0 or pain > 0.5
	# presa vista mas fora do alcance da lingua: pulinhos curtos de aproximacao
	var in_reach: bool = float(sense["presa_perto"]) > 10.0
	var chasing: bool = not in_reach and maxf(sense["presa_L"], sense["presa_R"]) > 25.0 and energy < 0.9
	var going: bool = _drive > 0.2 and absf(_steer) < 0.45
	if in_reach and not fleeing:
		cmd = 0.0             # presa ao alcance: fica parada e usa a lingua
	if cmd > 0.3 and _hop_ref <= 0.0 and (state == State.SIT or state == State.SWIM) and _tongue_t < 0.0 and (fleeing or chasing or going or state == State.SWIM):
		_hop_scale = 1.0 if (fleeing or going or state == State.SWIM) else 0.32
		_hop_burst = 0.09
		_hop_ref = 0.09 + lerpf(0.9, 0.35, clampf(cmd, 0.0, 1.0)) / maxf(vigor(), 0.3)
		_hop_amp = clampf(0.7 + cmd * 0.6, 0.8, 1.35)
	for s in ["L", "R"]:
		var a_in := clampf(_out("hop_" + s) * gain, 0.0, 1.6) * 0.3       # tonus postural
		if _hop_burst > 0.0:
			a_in = _hop_amp * clampf(0.75 + 0.5 * _out("hop_" + s) / maxf(cmd, 0.05), 0.6, 1.25)
		if defects.get("perna_ausente", "") == s:
			a_in = 0.0            # sem a perna: nada a contrair
		act[s] = lerpf(act[s], a_in, 1.0 - exp(-dt / 0.02))
		var target := clampf((act[s] - 0.2) * 2.6, 0.0, 1.0)
		if state == State.AIR:
			target = maxf(target, 0.85)    # no ar as pernas ficam esticadas
		var tau := 0.035 if target > ext[s] else 0.16
		var ne := move_toward(ext[s], target, dt / tau * absf(target - ext[s]) + dt * 0.5)
		ext_v[s] = (ne - ext[s]) / dt
		ext[s] = ne
	org.work = maxf(org.work, (act["L"] + act["R"]) * 0.4)
	tongue_act = lerpf(tongue_act, _out("snap"), 1.0 - exp(-dt / 0.03))


# ---------------------------------------------------------------- corpo (fisica)
func _ground(p: Vector3) -> Dictionary:
	# raio levemente deslocado: um raio vertical exatamente numa linha da grade
	# do campo de alturas escapa pela fresta (bug do HeightMapShape3D)
	var o := Vector3(0.0137, 0.0, 0.0071)
	var q := PhysicsRayQueryParameters3D.create(p + o + Vector3.UP * 200.0, p + o + Vector3.DOWN * 3000.0, WORLD_MASK)
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if hit.is_empty() and GardenWorld.instance:
		var gy := GardenWorld.instance.height_at(p.x, p.z)
		if gy <= p.y + 200.0:
			hit = {"position": Vector3(p.x, gy, p.z), "normal": Vector3.UP}
	return hit


func _snap() -> void:
	var pd := Pond.at(global_position)
	if pd and pd.depth_at(global_position) > size() * 0.3:
		state = State.SWIM
		global_position.y = pd.level - size() * 0.12
		return
	var hit := _ground(global_position)
	if hit:
		global_position = hit.position


func _body_physics(dt: float) -> void:
	var leg := size() * 1.6                     # comprimento da perna esticada
	var push := (maxf(ext_v["L"], 0.0) + maxf(ext_v["R"], 0.0)) * 0.5
	var asym := maxf(ext_v["R"], 0.0) - maxf(ext_v["L"], 0.0)
	# orientacao: reticular de orientacao (presa/vontade) e fuga (vira para longe)
	var yaw := (_out("orient_L") - _out("orient_R")) * 5.0 + (_out("escape_R") - _out("escape_L")) * 2.5
	match state:
		State.SIT:
			velocity = Vector3.ZERO
			if _tongue_t < 0.0 and _swallow_t <= 0.0:
				rotate_y(clampf(yaw, -4.0, 4.0) * dt)
			# pernas esticando rapido com os pes no chao: decola
			if push > 6.0 and (ext["L"] + ext["R"]) * 0.5 > 0.55 and _launch_cd <= 0.0 and _tongue_t < 0.0:
				# ~2 m/s num pulo forte: 5-10 comprimentos do corpo, como uma ra de verdade
				var v := leg * minf(push, 30.0) * 0.95 * genome.get_gene("speed") * vigor() * _hop_scale
				if defects.has("perna_ausente"):
					v *= 1.4          # compensa um pouco com a perna que sobrou (o empurrao e de uma so)
				rotate_y(asym * 0.02)
				var fwd := -global_basis.z
				var pitch := deg_to_rad(38.0)
				velocity = fwd * v * cos(pitch) + Vector3.UP * v * sin(pitch)
				state = State.AIR
				_launch_cd = 0.25
				org.work = 1.2
				remove_from_group("calling_frogs")
			# andar: o sapo-banjo tambem anda devagar (passos alternados da medula)
			var walk := clampf((_out("andar_L") + _out("andar_R")) * 0.5 - 0.25, 0.0, 1.0)
			if walk > 0.0 and _drive > 0.2 and absf(_steer) < 0.6 and _tongue_t < 0.0 and state == State.SIT:
				var step := -global_basis.z * size() * 0.9 * walk * vigor() * dt
				var np := global_position + step
				var hit := _ground(np)
				if hit:
					global_position = hit.position
				_walking = walk
			else:
				_walking = 0.0
			var pd := Pond.at(global_position)
			if pd and pd.depth_at(global_position) > size() * 0.35:
				state = State.SWIM
		State.AIR:
			velocity.y -= GRAV * dt
			var np := global_position + velocity * dt
			var pd := Pond.at(np)
			if pd and pd.depth_at(np) > size() * 0.3 and np.y <= pd.level:
				global_position = Vector3(np.x, pd.level - size() * 0.12, np.z)
				velocity *= 0.3
				state = State.SWIM
				behavior = "mergulhou (splash)"
				return
			if velocity.y < 0.0:
				var hit := _ground(np)
				if hit and np.y <= (hit.position as Vector3).y:
					global_position = hit.position
					_landed(-velocity.y)
					velocity = Vector3.ZERO
					state = State.SIT
					return
			global_position = np
		State.SWIM:
			var pd := Pond.at(global_position)
			if pd == null or pd.depth_at(global_position) < size() * 0.25:
				state = State.SIT
				_snap()
				return
			rotate_y(clampf(yaw * 0.6, -3.0, 3.0) * dt)
			# chute sincrono das pernas: a extensao empurra a agua
			velocity += -global_basis.z * push * leg * 0.045 * dt * 60.0
			velocity *= exp(-dt * 2.2)
			_dive_t = maxf(0.0, _dive_t - dt)
			if maxf(_out("escape_L"), _out("escape_R")) > 0.5:
				_dive_t = 6.0             # assustada: mergulha e fica no fundo
			var depth_goal := pd.level - size() * 0.12
			if _dive_t > 0.0 and GardenWorld.instance:
				depth_goal = maxf(GardenWorld.instance.height_at(global_position.x, global_position.z) + size() * 0.3, pd.level - size() * 3.0)
			global_position.y = lerpf(global_position.y, depth_goal, 1.0 - exp(-dt * 2.0))
			global_position += Vector3(velocity.x, 0, velocity.z) * dt
			behavior = "mergulhada (no fundo)" if _dive_t > 0.0 else ("nadando" if push > 1.0 else "boiando")
	if state == State.SIT:
		behavior = _sit_label()


## Pouso: pulos normais nao machucam; uma queda de muito alto (ou ser
## largada pelo jogador la de cima) machuca ou mata.
func _landed(vy: float) -> void:
	_land_vy = vy
	_hops += 1
	if decision == "forragear" and _hops >= _hops_goal:
		# busca aos saltos: uns pulos, depois para e olha em volta
		_hops = 0
		_hops_goal = _rng.randi_range(1, 3)
		_pause_t = _rng.randf_range(2.5, 7.0)
	var dmg := Mortality.impact_damage(Mortality.impact_speed(vy * vy / (2.0 * Mortality.G), 14000.0), 4000.0, 8500.0)
	if dmg >= 1.0:
		die("queda (ra)")
	elif dmg > 0.0:
		hurt(dmg * 2.5)
		mind.add_danger(global_position, size() * 3.0, dmg, "caiu de alto")
		last_lesson = "caiu de alto e se machucou"


func _sit_label() -> String:
	if _swallow_t > 0.0:
		return "engolindo (olhos afundam)"
	if maxf(_wipe["L"], _wipe["R"]) > 0.3:
		return "limpando a boca com as maos"
	if _out("inflar") > 0.4:
		return "inflada (defesa)"
	if _walking > 0.0:
		return "andando"
	if is_in_group("calling_frogs"):
		return "cantando (saco vocal)"
	if sense["presa_perto"] > 20.0:
		return "presa na frente (binocular)"
	if maxf(sense["presa_L"], sense["presa_R"]) > 15.0:
		return "de olho numa presa (%s)" % retina.target_kind
	return {"ir para a agua": "indo para a agua (pele secando)", "evitar": "saindo de um lugar perigoso",
		"procurar parceiro": "seguindo o canto", "descansar": "descansando", "esperar presa": "esperando presa (parada)",
		"cantar": "indo cantar na beira", "abrigar": "indo para a sombra (sol forte)",
		"forragear": "parada, olhando em volta (procurando presa)" if _pause_t > 0.0 else "procurando comida (mudando de lugar)"}.get(decision, "explorando")


# ---------------------------------------------------------------- lingua
## Hipoglosso: quando os motoneuronios da lingua disparam, a boca abre e a
## lingua e lancada (~70 ms) na direcao para onde os dois olhos estao fixos.
func _tongue_update(dt: float) -> void:
	if _swallow_t > 0.0:
		_swallow_t -= dt
		if _swallow_t <= 0.0:
			_swallowed()
	if _tongue_t < 0.0:
		if tongue_act > 0.22 and _tongue_cd <= 0.0 and _swallow_t <= 0.0 and state != State.AIR:
			_tongue_t = 0.0
			_tongue_cd = 0.6
			_tongue_hit = null
			var tg := retina.target
			if is_instance_valid(tg) and tg.global_position.distance_to(global_position) < size() * 1.6:
				_tongue_tip = tg.global_position
				_tongue_kind = retina.target_kind
			else:
				_tongue_tip = model.tongue_root.global_position - global_basis.z * size() * 1.0
				_tongue_kind = ""
			org.work = maxf(org.work, 0.6)
		else:
			model.hide_tongue()
			return
	_tongue_t += dt
	var out_t := 0.07
	var back_t := 0.12
	var k := 0.0
	if _tongue_t < out_t:
		k = _tongue_t / out_t
	elif _tongue_t < out_t + back_t:
		if _tongue_hit == null and _tongue_t - dt < out_t:
			_try_catch()
		k = 1.0 - (_tongue_t - out_t) / back_t
	else:
		_tongue_t = -1.0
		model.hide_tongue()
		if is_instance_valid(_tongue_hit):
			_swallow_t = 1.2
		return
	_jaw = 1.0
	if is_instance_valid(_tongue_hit):
		_tongue_hit.global_position = model.tongue_root.global_position.lerp(_tongue_tip, k)
	model.show_tongue(_tongue_tip, k)


func _try_catch() -> void:
	var tg := retina.target
	if _tongue_kind == "" or not is_instance_valid(tg):
		behavior = "lingua no vazio"
		return
	# a presa pode ter se mexido durante os 70 ms
	if tg.global_position.distance_to(_tongue_tip) > size() * 0.18 or _rng.randf() > 0.85:
		behavior = "errou a lingua"
		return
	_tongue_hit = tg
	if tg is Fly:
		(tg as Fly).die("comida por uma ra", self)
		(tg as Fly).set_physics_process(false)
	elif tg is Larva:
		(tg as Larva).call("_die", "comida por uma ra", self)
		(tg as Larva).set_physics_process(false)
	elif tg.has_method("eaten"):
		tg.call("eaten", self)
	elif tg is RigidBody3D:
		(tg as RigidBody3D).freeze = true


func _swallowed() -> void:
	var prey := _tongue_hit
	_tongue_hit = null
	if not is_instance_valid(prey):
		return
	var key := PackedFloat32Array(PREY_KEYS[_tongue_kind])
	var rate := clampf(0.35 * genome.get_gene("learning") * (0.6 + chem.get_level("dopamina+")), 0.05, 0.8)
	if _tongue_kind in ["mosca", "larva", "girino"]:
		# vai para o estomago; o gosto bom libera dopamina de recompensa
		var units: float = {"mosca": 0.06, "larva": 0.05, "girino": 0.12}[_tongue_kind]
		org.eat(units / maxf(growth, 0.4))
		_taste_good = 1.0
		_reward_t = 1.0
		mind.learn_odor(key, 1.0, rate, _tongue_kind)
		last_lesson = "comeu uma %s" % _tongue_kind
		_no_prey_t = 0.0
		_forage_goal = Vector3.INF
		# lembra do lugar que deu comida
		var merged := false
		for fs: Array in _food_spots:
			if (fs[0] as Vector3).distance_to(global_position) < size() * 4.0:
				fs[1] = minf(3.0, float(fs[1]) + 1.0)
				merged = true
		if not merged:
			_food_spots.append([global_position, 1.0])
			if _food_spots.size() > 6:
				_food_spots.pop_front()
		prey.queue_free()
	else:
		_taste_bad = 1.0
		_punish_t = 1.0
		_irritate_t = 2.0          # limpa a boca com as maos
		mind.learn_odor(key, -1.0, rate, _tongue_kind)
		last_lesson = "pegou uma %s e cuspiu: nao e comida" % _tongue_kind
		if prey is RigidBody3D:
			var rb := prey as RigidBody3D
			rb.freeze = false
			rb.global_position = model.tongue_root.global_position - global_basis.z * size() * 0.3
			rb.linear_velocity = -global_basis.z * 200.0


# ---------------------------------------------------------------- reproducao
func _start_amplexus(male: Frog) -> void:
	if male._amplexus or _amplexus:
		return
	_amplexus = male
	male._amplexus = self
	behavior = "amplexo"
	male.behavior = "amplexo"
	var tw := create_tween()
	tw.tween_interval(20.0)
	tw.tween_callback(_end_amplexus)


func _end_amplexus() -> void:
	var m := _amplexus
	_amplexus = null
	if is_instance_valid(m):
		m._amplexus = null
		m.remove_from_group("calling_frogs")
		m.decision = "descansar"
	decision = "descansar"
	if dead:
		return
	eggs_cooldown = LifeManager.DAY * 3.0
	var pd := Pond.nearest(global_position)
	if pd and LifeManager.instance:
		var p := pd.shore_point(global_position)
		var inward := Vector3(pd.center.x - p.x, 0, pd.center.y - p.z).normalized()
		p += inward * pd.radius * 0.12
		p.y = pd.level - 1.0
		LifeManager.instance.lay_frog_eggs(self, m if is_instance_valid(m) else null, p)
		last_lesson = "botou uma desova no lago"


# ---------------------------------------------------------------- corpo visivel
func _draw_state(dt: float) -> void:
	for s in ["L", "R"]:
		model.set_leg(s, ext[s], act[s])
		# bracos: esticados no salto; limpar o rosto e o abraco sao reflexos da medula
		_wipe[s] = lerpf(_wipe[s], clampf(_out("limpar_" + s) * 1.6, 0.0, 1.0) * (0.6 + 0.4 * sin(age * 14.0)), 1.0 - exp(-dt * 12.0))
		var clasp := clampf(_out("abraco_" + s) * 1.3, 0.0, 1.0) if _amplexus else 0.0
		model.set_arm(s, 1.0 if state == State.AIR else 0.0, _wipe[s], clasp)
	if is_in_group("calling_frogs"):
		_call_t += dt
		_call = maxf(0.0, sin(_call_t * 9.0)) * clampf(0.6 + _out("call") * 3.0, 0.0, 1.0)
	else:
		_call = move_toward(_call, 0.0, dt * 4.0)
	_blink = maxf(0.0, _blink - dt * 6.0)
	if _rng.randf() < dt * 0.3:
		_blink = 1.0
	_jaw = maxf(move_toward(_jaw, 0.0, dt * 8.0), _out("boca_abrir"))
	# olhos afundam para empurrar a presa (retrator do bulbo) e a membrana pisca
	var sw := maxf(1.0 if _swallow_t > 0.0 else 0.0, clampf(_out("engolir") * 1.5, 0.0, 1.0))
	_blink = maxf(_blink, clampf(_out("piscar") * 1.5, 0.0, 1.0))
	model.set_state(org, _call, sw, maxf(_blink, sw), _jaw, energy)
	model.set_skin(_out("secrecao") * 1.5, _dark, _out("inflar") * 1.4)
	_dark = lerpf(_dark, clampf(_out("escurecer") * 1.5, 0.0, 1.0), 1.0 - exp(-dt / 20.0))   # cor muda devagar
	# postura sentada: cabeca levantada; no ar: corpo esticado
	var pitch_goal := -0.25 if state == State.SIT else (0.1 if state == State.AIR else 0.05)
	model.rotation.x = lerpf(model.rotation.x, pitch_goal, 1.0 - exp(-dt * 10.0))
	if _amplexus and sex == "M" and is_instance_valid(_amplexus):
		global_transform = _amplexus.global_transform.translated_local(Vector3(0, _amplexus.size() * 0.3, _amplexus.size() * 0.08))


# ---------------------------------------------------------------- manipulacao / observacao
func grab() -> void:
	if dead:
		return
	state = State.CARRIED
	behavior = "sendo carregada! (se debatendo)"
	_punish_t = 2.0
	mind.add_danger(global_position, size() * 5.0, 0.5, "foi pega")
	remove_from_group("calling_frogs")


func carry_to(t: Transform3D) -> void:
	_carry_t = t


func release(vel: Vector3) -> void:
	if dead:
		return
	state = State.AIR
	velocity = vel
	global_rotation = Vector3(0, global_rotation.y, 0)


func set_xray(on: bool) -> void:
	model.set_xray(on)


func sight_range() -> float:
	return size() * 14.0


func observe_death(pos: Vector3, reason: String, _obj: Object, _victim: Node) -> void:
	if reason.begins_with("esmagad") or reason.begins_with("ferimentos"):
		mind.add_danger(pos, 250.0, 0.6, "viu alguem morrer")
		last_lesson = "viu alguem morrer (%s)" % reason


func observe_taste(_fruit: Node3D, _us: float) -> void:
	pass


func loom_radius() -> float:
	return size() * 0.5


func body_len() -> float:
	return size()


func describe() -> String:
	return "%s (ra %s, geracao %d, %.0f mm) — %s" % [fly_name, "macho" if sex == "M" else "femea", generation, size(), behavior]
