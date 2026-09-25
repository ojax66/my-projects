class_name LifeManager
extends Node3D
## Ciclo de vida da populacao: ovo -> larva -> pupa -> adulto -> morte.
## Guarda limites de populacao (para o jogo continuar rodando liso), conta
## geracoes, cria os excrementos e decide o que os filhotes herdam.
##
## Tempos comprimidos (na vida real: ovo 1 dia, larva 4 dias, pupa 4 dias,
## adulto ~30-60 dias).

const EGG_TIME := 25.0
const LARVA_MIN_TIME := 100.0
const LARVA_FOOD := 0.6          # comida que a larva precisa antes de virar pupa
const PUPA_TIME := 45.0
const ADULT_MATURE := 40.0       # idade adulta minima para acasalar
const MAX_ADULTS := 14
const MAX_LARVAE := 18
const MAX_EGGS := 40
const MAX_SPOTS := 400

static var instance: LifeManager

## Heranca do aprendizado (lamarckiana): na biologia real so os genes passam.
## Ligado, o filhote nasce com parte das memorias KC->MBON dos pais.
var inherit_learning := true
var inherit_fraction := 0.5

var births := 0
var uid_counter := 0
var fly_count := 0
var lineages := 0
var deaths := {}
var max_generation := 1
var _spots: Array[Node3D] = []
var _spot_mesh: Mesh
var _spot_mat: StandardMaterial3D
var _rng := RandomNumberGenerator.new()
var main: Node


func _ready() -> void:
	instance = self
	_rng.randomize()
	var sm := SphereMesh.new()
	sm.radius = 0.18
	sm.height = 0.12
	sm.radial_segments = 8
	sm.rings = 4
	_spot_mesh = sm
	_spot_mat = StandardMaterial3D.new()
	_spot_mat.albedo_color = Color(0.32, 0.22, 0.12)
	_spot_mat.roughness = 0.2
	_spot_mat.metallic_specular = 0.8


func count(group: String) -> int:
	return get_tree().get_nodes_in_group(group).size()


func adults_alive() -> int:
	var c := 0
	for f in get_tree().get_nodes_in_group("flies"):
		if not (f as Fly).dead:
			c += 1
	return c


func can_lay_egg() -> bool:
	return count("eggs") < MAX_EGGS and count("larvae") + count("eggs") < MAX_LARVAE + 10


## Excremento: uma gotinha na superficie (moscas fazem manchinhas escuras).
func drop_spot(pos: Vector3, normal: Vector3, surface: Node3D) -> void:
	var mi := MeshInstance3D.new()
	mi.mesh = _spot_mesh
	mi.material_override = _spot_mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var parent: Node3D = surface if is_instance_valid(surface) else self
	parent.add_child(mi)
	mi.global_transform = Transform3D(Fly._basis_from(normal, Vector3.FORWARD), pos + normal * 0.03)
	mi.add_to_group("spots")
	_spots.append(mi)
	while _spots.size() > MAX_SPOTS:
		var old: Node3D = _spots.pop_front()
		if is_instance_valid(old):
			old.queue_free()


## Mancha de hemolinfa quando uma mosca ou larva e esmagada.
func splat(pos: Vector3, normal: Vector3) -> void:
	var mi := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 1.6
	cyl.bottom_radius = 1.8
	cyl.height = 0.04
	mi.mesh = cyl
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.55, 0.5, 0.2, 0.75)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.roughness = 0.1
	mi.material_override = m
	add_child(mi)
	mi.global_transform = Transform3D(Fly._basis_from(normal, Vector3.FORWARD), pos + normal * 0.03)
	_spots.append(mi)


func next_uid() -> int:
	uid_counter += 1
	return uid_counter


## Sementes do conectoma unico: um "haplotipo" de fiacao vem da mae e outro
## do pai (cada um escolhe ao acaso um dos seus dois), mais uma mutacao nova.
func child_wiring(mother_w: Array, father_w: Array) -> Array:
	var a: int = mother_w[_rng.randi() % 2] if mother_w.size() >= 2 else _rng.randi()
	var b: int = father_w[_rng.randi() % 2] if father_w.size() >= 2 else _rng.randi()
	return [a, b, _rng.randi()]


func random_wiring() -> Array:
	return [_rng.randi(), _rng.randi(), _rng.randi()]


func child_mind(m: CreatureMemory, f: CreatureMemory) -> CreatureMemory:
	if not inherit_learning:
		return CreatureMemory.new()
	return CreatureMemory.inherit(m, f, inherit_fraction)


## Alguem morreu: quem estava perto e viu aprende (aprendizado social).
func report_death(victim: Node3D, reason: String, obj: Object = null) -> void:
	record_death(reason)
	var pos := victim.global_position
	var n_seen := 0
	for c in get_tree().get_nodes_in_group("creatures"):
		if c == victim or not c.has_method("observe_death") or bool(c.get("dead")):
			continue
		var rng_m: float = c.call("sight_range")
		if pos.distance_to((c as Node3D).global_position) < rng_m:
			c.call("observe_death", pos, reason, obj, victim)
			n_seen += 1
	if n_seen > 0 and Hud.instance:
		Hud.instance.toast("%d individuo(s) viram a morte (%s) e aprenderam o perigo" % [n_seen, reason])
	SaveGame.archive_individual(victim, reason)


## Alguem comeu (ou cuspiu) uma fruta: os vizinhos que veem aprendem o cheiro.
func report_taste(eater: Node3D, fruit: Node3D, us: float) -> void:
	if not is_instance_valid(fruit) or not fruit.has_method("odor_profile"):
		return
	for c in get_tree().get_nodes_in_group("creatures"):
		if c == eater or not c.has_method("observe_taste") or bool(c.get("dead")):
			continue
		var rng_m: float = c.call("sight_range") * 0.5
		if eater.global_position.distance_to((c as Node3D).global_position) < rng_m:
			c.call("observe_taste", fruit, us)


func child_memory(mother_mem: PackedFloat32Array, father_mem: PackedFloat32Array) -> PackedFloat32Array:
	if not inherit_learning or mother_mem.is_empty():
		return PackedFloat32Array()
	var out := PackedFloat32Array()
	out.resize(mother_mem.size())
	for i in out.size():
		var f := father_mem[i] if i < father_mem.size() else mother_mem[i]
		out[i] = lerpf(1.0, (mother_mem[i] + f) * 0.5, inherit_fraction)
	return out


func record_death(reason: String) -> void:
	deaths[reason] = int(deaths.get(reason, 0)) + 1


func lay_egg(mother: Fly, pos: Vector3, normal: Vector3, surface: Node3D) -> void:
	if not can_lay_egg():
		return
	var e := Egg.new()
	e.genome = Genome.cross(mother.genome, mother.sperm_genome, _rng)
	e.memory = child_memory(mother.brain.get_memory(), mother.sperm_memory)
	e.mind = child_mind(mother.mind, mother.sperm_mind)
	e.wiring = child_wiring(mother.wiring, mother.sperm_wiring)
	e.parents = [mother.uid, mother.sperm_uid]
	e.uid = next_uid()
	e.generation = maxi(mother.generation, mother.sperm_generation) + 1
	e.lineage = mother.lineage
	add_child(e)
	e.place(pos, normal, surface)


func hatch(egg: Egg) -> void:
	var l := Larva.new()
	l.genome = egg.genome
	l.memory = egg.memory
	l.generation = egg.generation
	l.lineage = egg.lineage
	l.uid = egg.uid
	l.mind = egg.mind
	l.wiring = egg.wiring
	l.parents = egg.parents
	add_child(l)
	l.place(egg.global_position, egg.global_basis.y, egg.surface)


func pupate(larva: Larva) -> void:
	var p := Pupa.new()
	p.genome = larva.genome
	p.memory = larva.memory
	p.generation = larva.generation
	p.lineage = larva.lineage
	p.size_mm = larva.size_mm
	p.uid = larva.uid
	p.mind = larva.mind
	p.wiring = larva.wiring
	p.parents = larva.parents
	add_child(p)
	p.global_transform = larva.global_transform


func eclose(pupa: Pupa) -> void:
	if adults_alive() >= MAX_ADULTS:
		record_death("sem espaco (limite)")
		return
	births += 1
	max_generation = maxi(max_generation, pupa.generation)
	if main and main.has_method("spawn_fly"):
		var f: Fly = main.call("spawn_fly", pupa.global_position, pupa.genome, pupa.generation, pupa.memory, pupa.lineage, "",
			{"uid": pupa.uid, "mind": pupa.mind, "wiring": pupa.wiring, "parents": pupa.parents})
		f.behavior = "acabou de nascer"
