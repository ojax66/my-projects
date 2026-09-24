class_name Pupa
extends Node3D
## Pupario (casulo marrom). Por dentro acontece a metamorfose: o cerebro da
## larva e reorganizado no cerebro adulto. No fim nasce uma mosca adulta.

var genome: Genome
var memory := PackedFloat32Array()
var generation := 1
var lineage := 0
var size_mm := 3.0
var _t := 0.0
var _mat: StandardMaterial3D


func _ready() -> void:
	add_to_group("pupae")
	add_to_group("creatures")
	var mi := MeshInstance3D.new()
	var cap := CapsuleMesh.new()
	cap.radius = size_mm * 0.17
	cap.height = size_mm * 0.95
	mi.mesh = cap
	mi.rotation_degrees = Vector3(90, 0, 0)
	mi.position.y = cap.radius * 0.8
	_mat = StandardMaterial3D.new()
	_mat.albedo_color = Color(0.85, 0.75, 0.55)
	_mat.roughness = 0.35
	mi.material_override = _mat
	add_child(mi)


func _physics_process(dt: float) -> void:
	_t += dt
	# escurece (tanning) com o tempo
	var k := clampf(_t / (LifeManager.PUPA_TIME * 0.5), 0.0, 1.0)
	_mat.albedo_color = Color(0.85, 0.75, 0.55).lerp(Color(0.4, 0.22, 0.1), k)
	if _t >= LifeManager.PUPA_TIME:
		if LifeManager.instance:
			LifeManager.instance.eclose(self)
		queue_free()


func describe() -> String:
	return "Pupa (geracao %d) — adulto em %ds" % [generation, int(LifeManager.PUPA_TIME - _t)]
