class_name Pond
extends Node3D
## Lago: uma depressao no terreno (GardenWorld.height_at ja afunda o chao)
## coberta por um plano de agua. Tem algas no fundo e nas bordas (comida dos
## girinos) que crescem com a luz do dia. E onde as ras vivem, cantam, se
## refrescam e botam os ovos.

static var all: Array[Pond] = []

var center := Vector2.ZERO
var radius := 400.0
var depth := 120.0
var level := 0.0             # altura da superficie da agua
var algae: Array = []
var _water: MeshInstance3D
static var _water_mat: ShaderMaterial


func setup(c: Vector2, r: float, d: float, world: GardenWorld) -> void:
	center = c
	radius = r
	depth = d
	# nivel: um pouco abaixo da borda mais baixa
	var rim := INF
	for k in 24:
		var a := TAU * k / 24.0
		var p := c + Vector2(cos(a), sin(a)) * r
		rim = minf(rim, world.height_at(p.x, p.y))
	level = rim - 4.0
	position = Vector3(c.x, 0, c.y)
	name = "Lago"


func _ready() -> void:
	all.append(self)
	add_to_group("ponds")
	_build_water()
	var world := get_parent() as GardenWorld
	var rng := RandomNumberGenerator.new()
	rng.seed = int(center.x * 7 + center.y * 13)
	# tufos de algas no fundo e na parte rasa
	for i in 22:
		var a := rng.randf() * TAU
		var d := sqrt(rng.randf()) * radius * 0.85
		var p := center + Vector2(cos(a), sin(a)) * d
		var y := world.height_at(p.x, p.y) if world else level - depth
		if level - y < 5.0:
			continue
		var al := Algae.new()
		al.pond = self
		al.biomass = rng.randf_range(0.5, 1.0)
		al.position = Vector3(p.x - center.x, y + 0.5, p.y - center.y)
		add_child(al)
		algae.append(al)


func _exit_tree() -> void:
	all.erase(self)


func _build_water() -> void:
	_water = MeshInstance3D.new()
	var disk := CylinderMesh.new()
	disk.top_radius = radius * 1.04
	disk.bottom_radius = radius * 1.04
	disk.height = 0.5
	disk.radial_segments = 64
	disk.rings = 1
	_water.mesh = disk
	if _water_mat == null:
		_water_mat = ShaderMaterial.new()
		_water_mat.shader = load("res://shaders/water.gdshader")
	_water.material_override = _water_mat
	_water.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_water.position.y = level - 0.25
	add_child(_water)


# ---------------------------------------------------------------- consultas
## Profundidade da agua num ponto do mundo (0 = fora da agua).
func depth_at(p: Vector3) -> float:
	if Vector2(p.x, p.z).distance_to(center) > radius * 1.05:
		return 0.0
	var gw := GardenWorld.instance
	var ground := gw.height_at(p.x, p.z) if gw else level - depth
	return maxf(0.0, level - ground)


func contains(p: Vector3) -> bool:
	return depth_at(p) > 0.0


static func at(p: Vector3) -> Pond:
	for pd in all:
		if pd.depth_at(p) > 0.0:
			return pd
	return null


## Quanto um ponto esta abaixo da superficie de algum lago (0 = seco).
static func submerged(p: Vector3) -> float:
	var pd := at(p)
	return maxf(0.0, pd.level - p.y) if pd else 0.0


static func nearest(p: Vector3) -> Pond:
	var best: Pond = null
	var bd := INF
	for pd in all:
		var d := Vector2(p.x, p.z).distance_to(pd.center) - pd.radius
		if d < bd:
			bd = d
			best = pd
	return best


## Distancia horizontal ate a agua (negativa = dentro).
func dist_to_water(p: Vector3) -> float:
	return Vector2(p.x, p.z).distance_to(center) - radius * 0.92


func shore_point(from: Vector3) -> Vector3:
	var dir := Vector2(from.x, from.z) - center
	if dir.length() < 0.01:
		dir = Vector2.RIGHT
	var p := center + dir.normalized() * radius * 0.98
	var gw := GardenWorld.instance
	return Vector3(p.x, gw.height_at(p.x, p.y) if gw else level, p.y)


func random_water_point(rng: RandomNumberGenerator, min_depth := 10.0) -> Vector3:
	var gw := GardenWorld.instance
	for k in 30:
		var a := rng.randf() * TAU
		var d := sqrt(rng.randf()) * radius * 0.8
		var p := center + Vector2(cos(a), sin(a)) * d
		var g := gw.height_at(p.x, p.y) if gw else level - depth
		if level - g >= min_depth:
			return Vector3(p.x, lerpf(g, level, 0.5), p.y)
	return Vector3(center.x, level - depth * 0.5, center.y)


func describe() -> String:
	var bio := 0.0
	for a: Algae in algae:
		bio += a.biomass
	return "Lago (%.0f cm de diametro, %.0f cm de fundo) — algas %d%%" % [radius * 0.2, depth * 0.1, int(bio / maxf(algae.size(), 1) * 100)]
