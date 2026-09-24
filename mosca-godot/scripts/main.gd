extends Node3D
## Monta o jardim, a camera espectadora, a interface e a(s) mosca(s).

const KEYS := {
	"move_forward": [KEY_W, KEY_UP], "move_back": [KEY_S, KEY_DOWN],
	"move_left": [KEY_A], "move_right": [KEY_D],
	"move_up": [KEY_E, KEY_SPACE], "move_down": [KEY_Q, KEY_CTRL],
	"turn_left": [KEY_LEFT, KEY_Z], "turn_right": [KEY_RIGHT, KEY_X],
	"fast": [KEY_SHIFT], "slow": [KEY_ALT],
	"toggle_mouse": [KEY_TAB], "puff": [KEY_F], "follow": [KEY_C],
	"delete_held": [KEY_DELETE, KEY_BACKSPACE], "toggle_brain": [KEY_B],
	"toggle_help": [KEY_H, KEY_F1], "time_scale": [KEY_T], "swap_brain": [KEY_N],
	"spawn_1": [KEY_1], "spawn_2": [KEY_2], "spawn_3": [KEY_3],
	"spawn_4": [KEY_4], "spawn_5": [KEY_5], "spawn_6": [KEY_6],
}

var world: GardenWorld
var spectator: Spectator
var hud: Hud
var _fly_count := 0


func _ready() -> void:
	_register_inputs()
	world = GardenWorld.new()
	world.name = "Jardim"
	add_child(world)

	spectator = Spectator.new()
	spectator.name = "Espectador"
	spectator.world = world
	spectator.position = Vector3(0, 45, 90)
	spectator.rotation = Vector3(-0.42, 0, 0)
	add_child(spectator)
	spectator.make_current()

	hud = Hud.new()
	add_child(hud)
	hud.bind(spectator)

	var f := spawn_fly(Vector3(0, 0, 0))
	spectator.follow_fly(f)
	hud.toast("H = ajuda   |   C = seguir / camera livre")


func spawn_fly(p: Vector3) -> Fly:
	_fly_count += 1
	var f := Fly.new()
	f.fly_name = "Mosca %d" % _fly_count
	f.name = "Mosca_%d" % _fly_count
	f.position = p
	f.rotation.y = randf() * TAU
	add_child(f)
	if hud:
		hud.toast("%s criada" % f.fly_name)
	return f


func _register_inputs() -> void:
	for action: String in KEYS:
		if not InputMap.has_action(action):
			InputMap.add_action(action)
		for k: int in KEYS[action]:
			var ev := InputEventKey.new()
			ev.physical_keycode = k
			InputMap.action_add_event(action, ev)
