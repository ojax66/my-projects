class_name Egg
extends Node3D
## Ovo (~0,5 mm, branco, com dois filamentos respiratorios). Fica grudado na
## fruta e eclode numa larva.

var genome: Genome
var memory := PackedFloat32Array()
var generation := 1
var lineage := 0
var uid := 0
var mind: CreatureMemory
var wiring: Array = []
var parents: Array = []
var surface: Node3D
var _local := Transform3D.IDENTITY
var _t := 0.0


func _ready() -> void:
	add_to_group("eggs")
	var mi := MeshInstance3D.new()
	var cap := CapsuleMesh.new()
	cap.radius = 0.1
	cap.height = 0.5
	mi.mesh = cap
	mi.rotation_degrees = Vector3(90, 0, 0)
	mi.position.y = 0.1
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.97, 0.96, 0.9)
	m.roughness = 0.4
	mi.material_override = m
	add_child(mi)
	for s in [-1, 1]:
		var fil := MeshInstance3D.new()
		var c := CylinderMesh.new()
		c.top_radius = 0.01
		c.bottom_radius = 0.02
		c.height = 0.35
		fil.mesh = c
		fil.material_override = m
		fil.position = Vector3(0.04 * s, 0.22, -0.25)
		fil.rotation_degrees = Vector3(-50, 0, 20 * s)
		add_child(fil)


func place(p: Vector3, n: Vector3, surf: Node3D) -> void:
	global_transform = Transform3D(Fly._basis_from(n, Vector3.FORWARD.rotated(n.normalized(), randf() * TAU)), p)
	surface = surf
	if is_instance_valid(surface):
		_local = surface.global_transform.affine_inverse() * global_transform


func _physics_process(dt: float) -> void:
	_t += dt
	if is_instance_valid(surface):
		global_transform = surface.global_transform * _local
	elif surface != null:
		# a fruta foi totalmente comida: o ovo cai no chao
		surface = null
	if _t >= LifeManager.EGG_TIME:
		if LifeManager.instance:
			LifeManager.instance.hatch(self)
		queue_free()


func describe() -> String:
	return "Ovo (geracao %d) — eclode em %ds" % [generation, int(LifeManager.EGG_TIME - _t)]
