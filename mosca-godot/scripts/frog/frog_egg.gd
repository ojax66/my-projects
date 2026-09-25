class_name FrogEgg
extends Node3D
## Desova de ra: massa gelatinosa boiando na agua com dezenas de ovos (ponto
## escuro dentro de uma esfera de gel). Em ~1,5 dia os embrioes se alongam e
## eclodem girinos (so alguns sobrevivem, como na natureza).

const HATCH_DAYS := 1.5

var genome_m: Genome
var genome_f: Genome
var wiring_m: Array = []
var wiring_f: Array = []
var parents: Array = []
var generation := 1
var lineage := 0
var t := 0.0
var _embryos: Array[MeshInstance3D] = []


func _ready() -> void:
	add_to_group("frog_eggs")
	var jelly := StandardMaterial3D.new()
	jelly.albedo_color = Color(0.85, 0.9, 0.85, 0.35)
	jelly.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	jelly.roughness = 0.05
	var dot := StandardMaterial3D.new()
	dot.albedo_color = Color(0.05, 0.05, 0.04)
	var sph := SphereMesh.new()
	sph.radius = 0.5
	sph.height = 1.0
	sph.radial_segments = 10
	sph.rings = 5
	var rng := RandomNumberGenerator.new()
	rng.seed = int(position.x * 3 + position.z * 7)
	for i in 45:
		var p := Vector3(rng.randfn() * 5.0, rng.randfn() * 1.5, rng.randfn() * 5.0)
		var g := MeshInstance3D.new()
		g.mesh = sph
		g.material_override = jelly
		g.scale = Vector3.ONE * 3.2
		g.position = p
		add_child(g)
		var e := MeshInstance3D.new()
		e.mesh = sph
		e.material_override = dot
		e.scale = Vector3.ONE * 1.1
		e.position = p
		add_child(e)
		_embryos.append(e)


func _physics_process(dt: float) -> void:
	t += dt
	var k := clampf(t / (HATCH_DAYS * GardenWorld.DAY_LENGTH), 0.0, 1.0)
	# o embriao redondo vira um girininho curvado dentro do gel
	for e in _embryos:
		e.scale = Vector3(1.1 - 0.4 * k, 1.1 - 0.4 * k, 1.1 + 1.6 * k)
	if k >= 1.0:
		if LifeManager.instance:
			LifeManager.instance.hatch_frog_eggs(self)
		queue_free()


func describe() -> String:
	return "Desova de ra (geracao %d) — girinos em %.1f dia(s)" % [generation, maxf(0.0, HATCH_DAYS - t / GardenWorld.DAY_LENGTH)]
