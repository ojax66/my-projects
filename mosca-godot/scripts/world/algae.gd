class_name Algae
extends Node3D
## Tufo de algas (filamentosas + perifiton) no fundo do lago. Os girinos
## raspam as algas com o bico corneo; elas voltam a crescer com a luz do dia
## (fotossintese) e param de noite.

var pond: Pond
var biomass := 1.0             # 0..1
var _blobs: Array[MeshInstance3D] = []
var _vis_t := 0.0
static var _mat: StandardMaterial3D
static var _mesh: Mesh


func _ready() -> void:
	add_to_group("algae")
	if _mat == null:
		_mat = StandardMaterial3D.new()
		_mat.albedo_color = Color(0.22, 0.45, 0.12)
		_mat.roughness = 0.8
		var sm := SphereMesh.new()
		sm.radius = 1.0
		sm.height = 1.2
		sm.radial_segments = 8
		sm.rings = 4
		_mesh = sm
	var rng := RandomNumberGenerator.new()
	rng.seed = int(position.x * 31 + position.z * 17)
	for i in 9:
		var mi := MeshInstance3D.new()
		mi.mesh = _mesh
		mi.material_override = _mat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.position = Vector3(rng.randf_range(-14, 14), rng.randf_range(0, 3), rng.randf_range(-14, 14))
		mi.set_meta("base", Vector3(rng.randf_range(3, 7), rng.randf_range(2, 9), rng.randf_range(3, 7)))
		add_child(mi)
		_blobs.append(mi)
	_update_visual()


func _process(dt: float) -> void:
	var dl := GardenWorld.instance.daylight() if GardenWorld.instance else 1.0
	biomass = minf(1.0, biomass + dt * dl / (1.5 * GardenWorld.DAY_LENGTH))
	_vis_t -= dt
	if _vis_t <= 0.0:
		_vis_t = 1.0
		_update_visual()


## Um girino rasPA: devolve quanto comeu.
func graze(amount: float) -> float:
	var got := minf(amount, biomass * 0.5)
	biomass -= got * 2.0
	return got


func _update_visual() -> void:
	for i in _blobs.size():
		var b: Vector3 = _blobs[i].get_meta("base")
		var k := clampf(biomass * 1.3 - float(i) / _blobs.size() * 0.4, 0.05, 1.0)
		_blobs[i].scale = b * k
		_blobs[i].position.y = b.y * k * 0.4


func food_key() -> PackedFloat32Array:
	return PackedFloat32Array([0.0, 0.0, 0.0, 0.0, 1.0, 0.0])


func describe() -> String:
	return "Algas (%d%%)" % int(biomass * 100)
