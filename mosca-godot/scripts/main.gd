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
	"spawn_4": [KEY_4], "spawn_5": [KEY_5], "spawn_6": [KEY_6], "spawn_7": [KEY_7],
	"teleport": [KEY_I], "toggle_life": [KEY_L],
}

var world: GardenWorld
var spectator: Spectator
var hud: Hud
var life: LifeManager
var _fly_count := 0
var _lineages := 0


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

	life = LifeManager.new()
	life.name = "Vida"
	life.main = self
	add_child(life)

	hud = Hud.new()
	add_child(hud)
	hud.bind(spectator)

	# populacao fundadora: femeas e machos com genes levemente diferentes
	var first: Fly = null
	for i in 6:
		var a := TAU * i / 6.0
		var f := spawn_fly(Vector3(cos(a), 0, sin(a)) * (20.0 + 30.0 * i), null, 1, PackedFloat32Array(), -1, "F" if i % 2 == 0 else "M")
		if first == null:
			first = f
	spectator.follow_fly(first)
	hud.toast("H = ajuda   |   C = seguir / camera livre   |   I = ir ate a mosca")


func spawn_fly(p: Vector3, genome: Genome = null, generation := 1, memory := PackedFloat32Array(), lineage := -1, sex := "") -> Fly:
	_fly_count += 1
	var f := Fly.new()
	f.genome = genome
	f.generation = generation
	f.inherited_memory = memory
	if lineage < 0:
		_lineages += 1
		lineage = _lineages
	f.lineage = lineage
	f.sex = sex if sex != "" else ("F" if randf() < 0.5 else "M")
	f.fly_name = "%s %d" % ["Femea" if f.sex == "F" else "Macho", _fly_count]
	f.name = "Mosca_%d" % _fly_count
	f.position = p
	f.rotation.y = randf() * TAU
	if generation == 1:
		f.age = LifeManager.ADULT_MATURE + randf() * 60.0
	add_child(f)
	if hud and generation > 1:
		hud.toast("Nasceu %s (geracao %d)!" % [f.fly_name, generation])
	return f


func _register_inputs() -> void:
	for action: String in KEYS:
		if not InputMap.has_action(action):
			InputMap.add_action(action)
		for k: int in KEYS[action]:
			var ev := InputEventKey.new()
			ev.physical_keycode = k
			InputMap.action_add_event(action, ev)
