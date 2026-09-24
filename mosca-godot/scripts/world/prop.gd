class_name Prop
extends RigidBody3D
## Objeto fisico generico manipulavel (pedrinhas etc.).

var display_name := "Pedrinha"
var radius := 20.0


func describe() -> String:
	return display_name


func loom_radius() -> float:
	return radius


func _physics_process(_dt: float) -> void:
	if global_position.y < -2000.0:
		queue_free()
