class_name Frog
extends Node3D
## Ra adulta (anuro) com o conectoma sintetico da ra (brain/full/ra.*, ver
## tools/build_amphibian_brain.py) na GPU.
##
## Como uma ra de verdade:
##  - caca "senta e espera": objetos PEQUENOS em movimento (moscas, larvas,
##    ate uma pedrinha rolando) ativam a retina R2 -> teto T5.2 -> ela vira o
##    corpo (orient), se aproxima em pulinhos e dispara a lingua (hipoglosso)
##    quando a presa esta a ~1 corpo de distancia e bem na frente
##  - objetos GRANDES se aproximando (sua mao/camera, fruta caindo) ativam o
##    pre-teto -> suprime a caca e dispara a fuga (pulo, de preferencia na agua)
##  - engole piscando: os olhos afundam na boca e ajudam a empurrar a presa
##  - aprende: gosto bom (mosca) -> dopamina de recompensa; gosto ruim
##    (pedrinha) -> cospe e passa a ignorar esse tipo de "presa"; lembra
##    lugares perigosos e ve os outros morrerem
##  - pele umida: fora d'agua desidrata (mais rapido no sol), volta para o lago
##  - de noite os machos cantam na beira do lago (saco vocal); a femea vai ate
##    o canto, amplexo, e ela bota os ovos na agua

enum State { SIT, HOP, SWIM, CARRIED, DEAD }

const WORLD_MASK := 1 | 2
const GRAV := 9800.0
const SVL := 45.0          # comprimento focinho-cloaca (mm) do adulto
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
var state := State.SIT
var behavior := "sentada"
var decision := "explorar"
var decision_scores := {}
var last_lesson := ""
var age := 0.0
var growth := 1.0            # recem-metamorfoseada ~0.35 -> adulta 1
var energy := 0.7
var hydration := 1.0
var health := 1.0
var pain := 0.0
var dead := false
var death_reason := ""
var mated := false
var eggs_cooldown := 0.0
var velocity := Vector3.ZERO   # usado pelo looming das moscas
var sense := {"presa_L": 0.0, "presa_R": 0.0, "sombra_L": 0.0, "sombra_R": 0.0}

var _rng := RandomNumberGenerator.new()
var _decide_t := 0.0
var _scan_t := 0.0
var _target: Node3D = null
var _target_kind := ""
var _threat_dir := Vector3.ZERO
var _hop_cool := 0.0
var _tongue_t := -1.0
var _tongue_hit: Node3D = null
var _tongue_target := Vector3.ZERO
var _tongue_kind := ""
var _swallow_t := 0.0
var _reward_t := 0.0
var _punish_t := 0.0
var _taste_good := 0.0
var _taste_bad := 0.0
var _carry_t := Transform3D.IDENTITY
var _call_t := 0.0
var _amplexus: Frog = null
var _amplexus_t := 0.0
var _dead_t := 0.0
var _hit_t := -99.0
var _hop_ext := 0.0
var _swim_ph := 0.0
var _breath := 0.0

# corpo
var _body: Node3D
var _eyes: Array[Node3D] = []
var _sac: MeshInstance3D
var _legs := {}              # nome -> Node3D (juntas)
var _tongue: Node3D
var _tongue_mesh: MeshInstance3D
var _skin: StandardMaterial3D


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
	_build_body()
	var area := Area3D.new()
	area.collision_layer = 4
	area.collision_mask = 0
	area.monitoring = false
	var cs := CollisionShape3D.new()
	var sh := SphereShape3D.new()
	sh.radius = size() * 0.45
	cs.shape = sh
	cs.position.y = size() * 0.2
	area.add_child(cs)
	area.set_meta("creature", self)
	add_child(area)
	_snap.call_deferred()


func size() -> float:
	return SVL * genome.get_gene("size") * lerpf(0.35, 1.0, growth)


func _exit_tree() -> void:
	if brain and brain.has_method("free_gpu"):
		brain.free_gpu()


# ---------------------------------------------------------------- corpo
func _build_body() -> void:
	_body = Node3D.new()
	add_child(_body)
	var hue := genome.get_gene("hue")
	_skin = StandardMaterial3D.new()
	_skin.albedo_color = Color.from_hsv(fposmod(0.28 + hue * 0.5, 1.0), 0.55, 0.5)
	var nt := NoiseTexture2D.new()
	var nz := FastNoiseLite.new()
	nz.seed = uid
	nz.frequency = 0.06
	nt.noise = nz
	nt.color_ramp = Gradient.new()
	nt.color_ramp.set_color(0, Color(0.35, 0.3, 0.15))
	nt.color_ramp.set_color(1, Color(1, 1, 1))
	nt.color_ramp.add_point(0.45, Color(0.95, 0.95, 0.9))
	_skin.albedo_texture = nt
	_skin.roughness = 0.35
	_skin.specular_mode = BaseMaterial3D.SPECULAR_SCHLICK_GGX
	_skin.clearcoat_enabled = true
	_skin.clearcoat = 0.6    # pele umida
	var belly := StandardMaterial3D.new()
	belly.albedo_color = Color(0.9, 0.88, 0.7)
	belly.roughness = 0.5
	var sph := SphereMesh.new()
	sph.radius = 0.5
	sph.height = 1.0
	sph.radial_segments = 18
	sph.rings = 10
	# unidades: 1 = SVL; o no raiz e escalado por size()
	_part(_body, sph, _skin, Vector3(0, 0.2, 0.05), Vector3(0.52, 0.32, 0.62))          # tronco
	_part(_body, sph, belly, Vector3(0, 0.12, 0.05), Vector3(0.48, 0.2, 0.58))           # ventre
	_part(_body, sph, _skin, Vector3(0, 0.25, -0.3), Vector3(0.46, 0.24, 0.38))          # cabeca
	var mouth := StandardMaterial3D.new()
	mouth.albedo_color = Color(0.25, 0.18, 0.1)
	_part(_body, sph, mouth, Vector3(0, 0.2, -0.36), Vector3(0.44, 0.02, 0.3))           # linha da boca
	_sac = _part(_body, sph, belly, Vector3(0, 0.12, -0.36), Vector3(0.22, 0.08, 0.18))  # saco vocal / garganta
	var iris := StandardMaterial3D.new()
	iris.albedo_color = Color(0.75, 0.55, 0.15)
	iris.metallic_specular = 1.0
	iris.roughness = 0.1
	var pupil := StandardMaterial3D.new()
	pupil.albedo_color = Color(0.02, 0.02, 0.02)
	pupil.roughness = 0.05
	for s in [-1, 1]:
		var eye := Node3D.new()
		eye.position = Vector3(0.14 * s, 0.36, -0.36)
		_body.add_child(eye)
		_part(eye, sph, iris, Vector3.ZERO, Vector3(0.13, 0.13, 0.13))
		_part(eye, sph, pupil, Vector3(0.03 * s, 0.02, -0.035), Vector3(0.07, 0.045, 0.07))
		_eyes.append(eye)
		# membro anterior
		var sh := _joint("braco_%d" % s, _body, Vector3(0.18 * s, 0.12, -0.15))
		_limb(sh, sph, Vector3(0.05, -0.08, 0), Vector3(0.07, 0.18, 0.07))
		var el := _joint("antebraco_%d" % s, sh, Vector3(0.0, -0.16, 0.0))
		_limb(el, sph, Vector3(0, -0.07, -0.02), Vector3(0.06, 0.15, 0.06))
		_limb(el, sph, Vector3(0, -0.14, -0.05), Vector3(0.1, 0.03, 0.1))
		# membro posterior: coxa, canela, pe (dobrados em Z no repouso)
		var hip := _joint("quadril_%d" % s, _body, Vector3(0.2 * s, 0.17, 0.3))
		_limb(hip, sph, Vector3(0, 0, -0.14), Vector3(0.12, 0.11, 0.32))
		var knee := _joint("joelho_%d" % s, hip, Vector3(0, 0, -0.28))
		_limb(knee, sph, Vector3(0, 0, 0.14), Vector3(0.09, 0.08, 0.3))
		var ankle := _joint("tornozelo_%d" % s, knee, Vector3(0, 0, 0.27))
		_limb(ankle, sph, Vector3(0, -0.02, -0.14), Vector3(0.1, 0.03, 0.32))
	# lingua (presa na frente da mandibula, estende ate a presa)
	_tongue = Node3D.new()
	_tongue.position = Vector3(0, 0.18, -0.46)
	_body.add_child(_tongue)
	_tongue_mesh = MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.025
	cyl.bottom_radius = 0.035
	cyl.height = 1.0
	_tongue_mesh.mesh = cyl
	var tm := StandardMaterial3D.new()
	tm.albedo_color = Color(0.9, 0.45, 0.5)
	tm.roughness = 0.2
	_tongue_mesh.material_override = tm
	_tongue_mesh.visible = false
	_tongue.add_child(_tongue_mesh)
	_apply_scale()
	_pose(0.0)


func _part(parent: Node3D, mesh: Mesh, mat: Material, pos: Vector3, sc: Vector3) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	mi.scale = sc
	parent.add_child(mi)
	return mi


func _limb(parent: Node3D, mesh: Mesh, pos: Vector3, sc: Vector3) -> void:
	_part(parent, mesh, _skin, pos, sc)


func _joint(n: String, parent: Node3D, pos: Vector3) -> Node3D:
	var j := Node3D.new()
	j.name = n
	j.position = pos
	parent.add_child(j)
	_legs[n] = j
	return j


func _apply_scale() -> void:
	_body.scale = Vector3.ONE * size()


## Postura: ext 0 = sentada (pernas dobradas), 1 = pernas esticadas (pulo).
func _pose(ext: float) -> void:
	for s in [-1, 1]:
		var hip: Node3D = _legs["quadril_%d" % s]
		var knee: Node3D = _legs["joelho_%d" % s]
		var ankle: Node3D = _legs["tornozelo_%d" % s]
		# repouso: coxa para frente-fora, canela para tras, pe para frente
		hip.rotation = Vector3(lerpf(-0.25, 0.9, ext), lerpf(0.9, 0.25, ext) * s, 0)
		knee.rotation = Vector3(lerpf(0.2, -0.05, ext), lerpf(-2.4, -0.2, ext) * s, 0)
		ankle.rotation = Vector3(lerpf(-0.1, 0.4, ext), lerpf(2.2, 0.3, ext) * s, 0)
		var arm: Node3D = _legs["braco_%d" % s]
		arm.rotation = Vector3(lerpf(0.35, -0.9, ext), 0, 0.25 * s)


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
	brain.set_mode(0 if followed and Engine.time_scale <= 1.0 else 1)
	mind.decay(dt)
	_hop_cool = maxf(0.0, _hop_cool - dt)
	_reward_t = maxf(0.0, _reward_t - dt)
	_punish_t = maxf(0.0, _punish_t - dt)
	eggs_cooldown = maxf(0.0, eggs_cooldown - dt)
	if state == State.CARRIED:
		global_transform = global_transform.interpolate_with(_carry_t, 1.0 - exp(-dt * 20.0))
		pain = maxf(pain, 0.3)
		_sense(dt)
		brain.advance(dt)
		_animate(dt)
		return
	_physiology(dt)
	if dead:
		return
	_check_crush()
	if dead:
		return
	_sense(dt)
	brain.advance(dt)
	chem.update(dt, brain, energy, 0.5, _taste_good, _taste_bad)
	brain.learning_gain = genome.get_gene("learning")
	_decide(dt)
	match state:
		State.SIT: _sit(dt)
		State.HOP: _hop(dt)
		State.SWIM: _swim(dt)
	_tongue_update(dt)
	_animate(dt)


func _physiology(dt: float) -> void:
	var day := LifeManager.DAY
	var dl := GardenWorld.instance.daylight() if GardenWorld.instance else 1.0
	# ectotermo: gasta pouco; uma reserva cheia dura ~4 dias
	energy -= dt / (4.0 * day) * genome.get_gene("metabolism") * (1.5 if state == State.HOP else 1.0)
	var pd := Pond.at(global_position)
	if state == State.SWIM or (pd and pd.depth_at(global_position) > 1.0):
		hydration = minf(1.0, hydration + dt / 60.0)
	else:
		# pele permeavel: resseca fora d'agua, mais rapido ao sol
		hydration -= dt / (0.6 * day) * (0.4 + 1.2 * dl)
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
	if age > genome.get_gene("lifespan") * 4.0:
		die("velhice (ra)")


func die(reason: String, cause: Object = null) -> void:
	if dead:
		return
	dead = true
	death_reason = reason
	behavior = "morta (%s)" % reason
	state = State.DEAD
	_body.rotation.z = PI * 0.9
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
		var rb: RigidBody3D = r["crush"]
		if rb.mass >= 0.15 * genome.get_gene("size"):
			die("esmagada (ra)", rb)
			_body.scale.y *= 0.35
			return
		r = {"hit": 0.3, "obj": rb}
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
func _eye_pos() -> Vector3:
	return global_position + global_basis.y * size() * 0.36 - global_basis.z * size() * 0.3


func _sense(dt: float) -> void:
	_scan_t -= dt
	if _scan_t <= 0.0:
		_scan_t = 0.05
		_scan_prey()
		_scan_threat()
	var dl := GardenWorld.instance.daylight() if GardenWorld.instance else 1.0
	var hunger := clampf(1.0 - energy, 0.0, 1.0)
	brain.set_input("presa_L", sense["presa_L"])
	brain.set_input("presa_R", sense["presa_R"])
	brain.set_input("sombra_L", sense["sombra_L"])
	brain.set_input("sombra_R", sense["sombra_R"])
	# de noite a retina dos anuros ainda ve (bastonetes muito sensiveis)
	brain.set_input("luz_L", 20.0 + 90.0 * dl)
	brain.set_input("luz_R", 20.0 + 90.0 * dl)
	brain.set_input("fome", 100.0 * hunger)
	brain.set_input("glicose", 110.0 * energy)
	brain.set_input("paladar_bom", 150.0 * _taste_good)
	brain.set_input("paladar_ruim", 150.0 * _taste_bad)
	brain.set_input("reward", 120.0 if _reward_t > 0.0 else 0.0)
	brain.set_input("punish", 140.0 if _punish_t > 0.0 else 0.0)
	brain.set_input("dor", 200.0 * clampf(pain, 0.0, 1.0))
	brain.set_input("tato", 150.0 if state == State.CARRIED else 0.0)
	brain.set_input("equilibrio", 100.0 if state == State.HOP else 10.0)
	var calls := 0.0
	for f in get_tree().get_nodes_in_group("calling_frogs"):
		if f != self and (f as Node3D).global_position.distance_to(global_position) < 1500.0:
			calls += 60.0
	brain.set_input("som", minf(calls, 180.0))
	brain.set_input("temperatura", 40.0 + 60.0 * dl)
	var ex := 25.0 if decision == "explorar" else 8.0
	brain.set_input("explore_L", ex + _rng.randf() * 10.0)
	brain.set_input("explore_R", ex + _rng.randf() * 10.0)
	_taste_good = maxf(0.0, _taste_good - dt * 0.8)
	_taste_bad = maxf(0.0, _taste_bad - dt * 0.8)


## Retina R2 / teto T5.2: objetos pequenos que se mexem (o formato "minhoca"
## de Ewert: pequeno, em movimento na direcao do comprimento).
func _scan_prey() -> void:
	var eye := _eye_pos()
	var right := global_basis.x.normalized()
	var fwd := -global_basis.z.normalized()
	var pl := 0.0
	var pr := 0.0
	var best: Node3D = null
	var best_s := 0.0
	var best_kind := ""
	var view := size() * 9.0
	for c in _prey_candidates():
		var node: Node3D = c[0]
		var kind: String = c[1]
		var spd: float = c[2]
		var r: float = c[3]
		var to := node.global_position - eye
		var d := to.length()
		if d > view or d < 1.0 or spd < 1.5:
			continue
		var ang := r / d
		if ang > 0.35:
			continue   # grande demais para ser presa
		var side := to.dot(right)
		var front := to.dot(fwd)
		if front < -d * 0.6:
			continue   # atras (ponto cego)
		var rate := 160.0 * clampf(spd / 25.0, 0.25, 1.0) * clampf(1.0 - d / view, 0.0, 1.0) * clampf(ang * 25.0, 0.3, 1.0)
		if side < 0.0:
			pl = maxf(pl, rate)
		else:
			pr = maxf(pr, rate)
		var pv := mind.predict(PackedFloat32Array(PREY_KEYS[kind]))
		var value := rate * (1.0 + pv.x * pv.y * 1.5 + (1.0 - pv.y) * 0.3)
		if value > best_s:
			best_s = value
			best = node
			best_kind = kind
	sense["presa_L"] = pl
	sense["presa_R"] = pr
	_target = best
	_target_kind = best_kind


func _prey_candidates() -> Array:
	var out: Array = []
	for n in get_tree().get_nodes_in_group("flies"):
		var f := n as Fly
		if f.dead or f.state == Fly.State.CARRIED:
			continue
		out.append([f, "mosca", maxf(absf(f.speed), f._vel.length() * 0.3) + 3.0 * float(f.m_groom > 0.3), 1.2])
	for n in get_tree().get_nodes_in_group("larvae"):
		var l := n as Larva
		if l.dead or l.hidden > 0.5:
			continue
		out.append([l, "larva", absf(l._last_speed) * 3.0, l.size_mm * 0.3])
	for n in get_tree().get_nodes_in_group("tadpoles"):
		var t := n as Node3D
		if t.get("dead"):
			continue
		out.append([t, "girino", (t.get("velocity") as Vector3).length(), float(t.call("body_len")) * 0.25])
	for n in get_tree().get_nodes_in_group("grabbable"):
		var rb := n as RigidBody3D
		if rb == null or rb.freeze:
			continue
		var rad: float = rb.call("loom_radius") if rb.has_method("loom_radius") else 20.0
		if rad > 14.0:
			continue
		out.append([rb, "fruta" if rb is Fruit else "pedra", rb.linear_velocity.length(), rad])
	return out


## Pre-teto TH3: coisas grandes chegando perto (mao/camera, fruta caindo).
func _scan_threat() -> void:
	var eye := _eye_pos()
	var right := global_basis.x.normalized()
	var tl := 0.0
	var tr := 0.0
	_threat_dir = Vector3.ZERO
	var cam := get_viewport().get_camera_3d() as Spectator
	var things: Array = []
	if cam and cam.follow != self:
		things.append([cam.global_position, cam.cam_velocity, 40.0])
	for n in get_tree().get_nodes_in_group("grabbable"):
		var rb := n as RigidBody3D
		if rb and not rb.freeze and rb.linear_velocity.length() > 60.0:
			things.append([rb.global_position, rb.linear_velocity, rb.call("loom_radius") if rb.has_method("loom_radius") else 20.0])
	for t: Array in things:
		var p: Vector3 = t[0]
		var v: Vector3 = t[1]
		var r: float = t[2]
		var to := eye - p
		var d := maxf(to.length() - r, 1.0)
		if d > 600.0:
			continue
		var appr := v.dot(to.normalized())
		var ang := r / d
		if ang < 0.2:
			continue
		var rate := clampf(ang * 120.0 + maxf(appr, 0.0) * 0.4, 0.0, 220.0) * (1.0 / genome.get_gene("boldness"))
		if rate < 30.0:
			continue
		if right.dot(p - eye) < 0.0:
			tl = maxf(tl, rate)
		else:
			tr = maxf(tr, rate)
		_threat_dir += to.normalized() * rate
	sense["sombra_L"] = tl
	sense["sombra_R"] = tr


# ---------------------------------------------------------------- decisao
func _decide(dt: float) -> void:
	# fuga imediata: pre-teto -> reticular de fuga (do conectoma) ou ameaca forte
	var esc := maxf(brain.output("escape_L"), brain.output("escape_R"))
	var threat := maxf(sense["sombra_L"], sense["sombra_R"])
	if (esc > 0.5 or threat > 120.0) and _hop_cool <= 0.0 and state != State.HOP and _tongue_t < 0.0:
		decision = "fugir"
		_flee()
		return
	_decide_t -= dt
	if _decide_t > 0.0:
		_act(dt)
		return
	_decide_t = 0.35
	var dl := GardenWorld.instance.daylight() if GardenWorld.instance else 1.0
	var hunger := clampf(1.0 - energy, 0.0, 1.0)
	var sc := {"explorar": 0.2}
	if is_instance_valid(_target):
		var pv := mind.predict(PackedFloat32Array(PREY_KEYS[_target_kind]))
		var val := pv.x * pv.y + (1.0 - pv.y) * 0.5
		# ras cacam mais no crepusculo e de noite
		sc["cacar"] = (0.3 + 1.3 * hunger) * (0.3 + val) * (1.2 - 0.4 * dl) + 0.4 * brain.output("snap")
	sc["ir para a agua"] = (1.0 - hydration) * 1.6 + 0.3 * mind.danger_at(global_position)
	sc["evitar"] = mind.danger_at(global_position) * 1.1
	sc["descansar"] = 0.25 + 0.35 * dl * (1.0 - hunger)
	var mature := age > LifeManager.DAY * 3.0 and growth >= 0.95
	var pd := Pond.nearest(global_position)
	var near_water := pd != null and pd.dist_to_water(global_position) < 120.0
	if mature and sex == "M" and dl < 0.35 and hunger < 0.6:
		sc["cantar"] = 0.8 * (1.0 - dl) + (0.3 if near_water else -0.2) + 0.3 * brain.output("call")
	if mature and sex == "F" and eggs_cooldown <= 0.0 and dl < 0.4 and hunger < 0.6:
		var caller := _nearest_caller()
		if caller:
			sc["procurar parceiro"] = 0.9 + 0.2 * clampf(float(brain.output_rate_hz("call")) / 20.0, 0.0, 1.0)
	var pick := decision if sc.has(decision) else "explorar"
	var pick_v := float(sc.get(pick, 0.0)) + 0.1
	for k: String in sc:
		if float(sc[k]) > pick_v:
			pick_v = sc[k]
			pick = k
	decision = pick
	decision_scores = sc
	_act(dt)


func _nearest_caller() -> Frog:
	var best: Frog = null
	var bd := 2000.0
	for f in get_tree().get_nodes_in_group("calling_frogs"):
		var fr := f as Frog
		if fr == self or fr.dead:
			continue
		var d := fr.global_position.distance_to(global_position)
		if d < bd:
			bd = d
			best = fr
	return best


func _act(_dt: float) -> void:
	if state == State.HOP or _tongue_t >= 0.0 or _swallow_t > 0.0:
		return
	if decision != "cantar":
		remove_from_group("calling_frogs")
	if _amplexus:
		return
	match decision:
		"cacar":
			if not is_instance_valid(_target):
				return
			var tp := _target.global_position
			var to := tp - _eye_pos()
			var d := to.length()
			var fwd := -global_basis.z
			var ang := fwd.signed_angle_to(Vector3(to.x, 0, to.z), Vector3.UP)
			behavior = "cacando %s" % _target_kind
			var reach := size() * 1.1
			if absf(ang) > 0.3:
				_turn_towards(tp, 0.35)   # orienta o corpo (reticular de orientacao)
			elif d > reach:
				if _hop_cool <= 0.0:
					_jump_to(global_position + Vector3(to.x, 0, to.z).normalized() * minf(d - reach * 0.7, size() * 3.0), 0.5)
			elif brain.output("snap") > 0.08 or clampf(1.0 - energy, 0.0, 1.0) > 0.25:
				_strike(tp)
		"ir para a agua":
			var pd := Pond.nearest(global_position)
			if pd and state != State.SWIM:
				behavior = "indo para a agua (pele secando)"
				var goal := Vector3(pd.center.x, 0, pd.center.y)
				_hop_along(goal)
			elif state == State.SWIM:
				behavior = "na agua, se hidratando"
		"evitar":
			behavior = "saindo de um lugar perigoso"
			var dz := mind.nearest_danger(global_position)
			if dz != Vector3.INF:
				_hop_along(global_position + (global_position - dz).normalized() * 300.0)
		"cantar":
			var pd := Pond.nearest(global_position)
			if pd and pd.dist_to_water(global_position) > 60.0 and state != State.SWIM:
				behavior = "indo cantar na beira do lago"
				_hop_along(pd.shore_point(global_position))
			else:
				behavior = "cantando (saco vocal)"
				add_to_group("calling_frogs")
				_call_t += _dt
		"procurar parceiro":
			var m := _nearest_caller()
			if m:
				behavior = "seguindo o canto de %s" % m.fly_name
				if m.global_position.distance_to(global_position) < size() * 1.2:
					_start_amplexus(m)
				else:
					_hop_along(m.global_position)
		"descansar":
			behavior = "descansando" if state != State.SWIM else "boiando"
		"explorar":
			behavior = "explorando"
			if _hop_cool <= 0.0 and _rng.randf() < 0.02:
				var a := _rng.randf() * TAU
				_jump_to(global_position + Vector3(cos(a), 0, sin(a)) * size() * 2.5, 0.4)


func _hop_along(goal: Vector3) -> void:
	var to := goal - global_position
	to.y = 0.0
	if to.length() < size() * 0.5:
		return
	var fwd := -global_basis.z
	if absf(fwd.signed_angle_to(to, Vector3.UP)) > 0.4:
		_turn_towards(goal, 0.5)
	elif _hop_cool <= 0.0:
		_jump_to(global_position + to.normalized() * minf(to.length(), size() * 3.5), 0.6)


func _turn_towards(p: Vector3, amount: float) -> void:
	var to := p - global_position
	to.y = 0.0
	if to.length() < 0.01:
		return
	var fwd := -global_basis.z
	var ang := fwd.signed_angle_to(to, Vector3.UP)
	rotate_y(clampf(ang, -amount, amount))


func _flee() -> void:
	var away := _threat_dir
	away.y = 0.0
	if away.length() < 0.01:
		away = global_basis.z
	# prefere pular para dentro d'agua se o lago estiver perto
	var pd := Pond.nearest(global_position)
	var goal := global_position + away.normalized() * size() * 5.0
	if pd and pd.dist_to_water(global_position) < size() * 6.0 and state != State.SWIM:
		goal = Vector3(pd.center.x, 0, pd.center.y)
		goal = global_position + (goal - global_position).normalized() * size() * 5.0
	behavior = "FUGA! (pulo)"
	look_at(Vector3(goal.x, global_position.y, goal.z), Vector3.UP)
	_jump_to(goal, 1.0)
	_punish_t = 0.3


# ---------------------------------------------------------------- movimento
func _ground(p: Vector3) -> Dictionary:
	var q := PhysicsRayQueryParameters3D.create(p + Vector3.UP * 200.0, p + Vector3.DOWN * 3000.0, WORLD_MASK)
	return get_world_3d().direct_space_state.intersect_ray(q)


func _snap() -> void:
	var pd := Pond.at(global_position)
	if pd and pd.depth_at(global_position) > size() * 0.3:
		state = State.SWIM
		global_position.y = pd.level - size() * 0.12
		return
	var hit := _ground(global_position)
	if hit:
		global_position = hit.position


func _jump_to(goal: Vector3, power: float) -> void:
	var to := goal - global_position
	to.y = 0.0
	var dist := clampf(to.length(), size() * 0.8, size() * (6.0 + 4.0 * power) * genome.get_gene("speed"))
	var dir := to.normalized() if to.length() > 0.01 else -global_basis.z
	look_at(global_position + dir, Vector3.UP)
	# balistico a ~45 graus: v = sqrt(g * d)
	var v := sqrt(GRAV * dist)
	velocity = dir * v * 0.707 + Vector3.UP * v * 0.707
	if state == State.SWIM:
		velocity = dir * v * 0.5 + Vector3.UP * v * 0.35
	state = State.HOP
	_hop_cool = 0.4 + _rng.randf() * 0.5
	remove_from_group("calling_frogs")


func _hop(dt: float) -> void:
	velocity.y -= GRAV * dt
	var np := global_position + velocity * dt
	var pd := Pond.at(np)
	if pd and pd.depth_at(np) > size() * 0.3 and np.y <= pd.level:
		global_position = Vector3(np.x, pd.level - size() * 0.12, np.z)
		velocity = Vector3.ZERO
		state = State.SWIM
		behavior = "caiu n'agua (splash)"
		return
	if velocity.y < 0.0:
		var hit := _ground(np)
		if hit and np.y <= (hit.position as Vector3).y:
			global_position = hit.position
			velocity = Vector3.ZERO
			state = State.SIT
			return
	global_position = np


func _sit(_dt: float) -> void:
	velocity = Vector3.ZERO
	var pd := Pond.at(global_position)
	if pd and pd.depth_at(global_position) > size() * 0.35:
		state = State.SWIM


func _swim(dt: float) -> void:
	var pd := Pond.at(global_position)
	if pd == null or pd.depth_at(global_position) < size() * 0.25:
		state = State.SIT
		_snap()
		return
	# boia com o focinho na superficie; a perna empurra em chutes
	global_position.y = lerpf(global_position.y, pd.level - size() * 0.12, 1.0 - exp(-dt * 4.0))
	velocity *= exp(-dt * 2.0)
	global_position += Vector3(velocity.x, 0, velocity.z) * dt
	_swim_ph += dt * velocity.length() * 0.1


# ---------------------------------------------------------------- lingua
## Lingua projetil (Nishikawa): sai em ~70 ms, gruda e volta com a presa.
func _strike(p: Vector3) -> void:
	_tongue_t = 0.0
	_tongue_target = p
	_tongue_kind = _target_kind
	_tongue_hit = null
	behavior = "LINGUA!"


func _tongue_update(dt: float) -> void:
	if _swallow_t > 0.0:
		_swallow_t -= dt
		behavior = "engolindo (olhos afundam)"
		if _swallow_t <= 0.0:
			_swallowed()
	if _tongue_t < 0.0:
		_tongue_mesh.visible = false
		return
	_tongue_t += dt
	var out_t := 0.07
	var back_t := 0.12
	var root := _tongue.global_position
	var tip := _tongue_target
	var k := 0.0
	if _tongue_t < out_t:
		k = _tongue_t / out_t
	elif _tongue_t < out_t + back_t:
		if _tongue_hit == null and _tongue_t - dt < out_t:
			_try_catch()
		k = 1.0 - (_tongue_t - out_t) / back_t
	else:
		_tongue_t = -1.0
		_tongue_mesh.visible = false
		if is_instance_valid(_tongue_hit):
			_swallow_t = 1.2
		return
	if is_instance_valid(_tongue_hit):
		_tongue_hit.global_position = root.lerp(tip, k)
	var seg := (tip - root) * k
	_tongue_mesh.visible = seg.length() > 0.5
	if _tongue_mesh.visible:
		var y := seg.normalized()
		var x := y.cross(Vector3.UP if absf(y.y) < 0.95 else Vector3.RIGHT).normalized()
		var z := x.cross(y)
		var w := size() * 0.7
		_tongue_mesh.global_transform = Transform3D(Basis(x * w, y * seg.length(), z * w), root + seg * 0.5)


func _try_catch() -> void:
	if not is_instance_valid(_target):
		return
	var d := _target.global_position.distance_to(_tongue_target)
	var ok := d < size() * 0.2 and _rng.randf() < 0.85
	if not ok:
		behavior = "errou a lingua"
		return
	_tongue_hit = _target
	if _target is Fly:
		(_target as Fly).die("comida por uma ra", self)
		(_target as Fly).set_physics_process(false)
	elif _target is Larva:
		(_target as Larva).call("_die", "comida por uma ra", self)
		(_target as Larva).set_physics_process(false)
	elif _target.has_method("eaten"):
		_target.call("eaten", self)
	elif _target is RigidBody3D:
		(_target as RigidBody3D).freeze = true


func _swallowed() -> void:
	var prey := _tongue_hit
	_tongue_hit = null
	if not is_instance_valid(prey):
		return
	var key := PackedFloat32Array(PREY_KEYS[_tongue_kind])
	var rate := clampf(0.35 * genome.get_gene("learning") * (0.6 + chem.get_level("dopamina+")), 0.05, 0.8)
	if _tongue_kind in ["mosca", "larva", "girino"]:
		# engoliu: gosto bom -> dopamina de recompensa
		energy = minf(1.0, energy + (0.06 if _tongue_kind == "mosca" else 0.05) / maxf(growth, 0.4))
		_taste_good = 1.0
		_reward_t = 1.0
		mind.learn_odor(key, 1.0, rate, _tongue_kind)
		last_lesson = "comeu uma %s" % _tongue_kind
		prey.queue_free()
	else:
		# pedra/fruta: gosto ruim, cospe e aprende
		_taste_bad = 1.0
		_punish_t = 1.0
		mind.learn_odor(key, -1.0, rate, _tongue_kind)
		last_lesson = "pegou uma %s e cuspiu: nao e comida" % _tongue_kind
		if prey is RigidBody3D:
			var rb := prey as RigidBody3D
			rb.freeze = false
			rb.global_position = _tongue.global_position - global_basis.z * size() * 0.3
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
		m.behavior = "descansando depois do amplexo"
		m.decision = "descansar"
	behavior = "botando os ovos na agua"
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


# ---------------------------------------------------------------- animacao
func _animate(dt: float) -> void:
	var ext_goal := 1.0 if state == State.HOP else (0.5 + 0.5 * sin(_swim_ph * 6.0) if state == State.SWIM and velocity.length() > 20.0 else 0.0)
	_hop_ext = lerpf(_hop_ext, ext_goal, 1.0 - exp(-dt * 18.0))
	_pose(_hop_ext)
	# respiracao pela garganta; saco vocal inflando no canto
	_breath += dt * 5.0
	var sac := 1.0 + 0.12 * sin(_breath)
	if is_in_group("calling_frogs"):
		sac = 1.6 + 0.9 * maxf(0.0, sin(_call_t * 9.0))
	_sac.scale = Vector3(0.22, 0.08, 0.18) * sac
	# olhos afundam para ajudar a engolir
	for e in _eyes:
		e.position.y = lerpf(e.position.y, 0.26 if _swallow_t > 0.0 else 0.36, 1.0 - exp(-dt * 12.0))
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
	state = State.HOP
	velocity = vel
	global_rotation = Vector3(0, global_rotation.y, 0)


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
