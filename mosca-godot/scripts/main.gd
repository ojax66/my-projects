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
	"spawn_8": [KEY_8], "spawn_9": [KEY_9], "spawn_10": [KEY_0],
	"teleport": [KEY_I], "toggle_life": [KEY_L], "pause": [KEY_P, KEY_PAUSE],
	"save": [KEY_F5],
}

var world: GardenWorld
var spectator: Spectator
var hud: Hud
var life: LifeManager


func _ready() -> void:
	_register_inputs()
	var engine := BrainEngine.new()
	engine.name = "CerebrosGPU"
	add_child(engine)
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

	# o jardim comeca SEM moscas: o jogador escolhe continuar o mundo salvo
	# ou comecar um novo e colocar as moscas (Menu -> + Mosca)
	hud.show_start_menu()


func new_world() -> void:
	hud.toast("Mundo novo, sem moscas. Menu -> \"+ Mosca\" para colocar a primeira.")


func continue_world() -> void:
	if not SaveGame.load_world(self):
		hud.toast("Nao foi possivel ler o mundo salvo; comecando um novo")


func save_world() -> void:
	hud.toast(SaveGame.save(self))


func save_and_quit() -> void:
	SaveGame.save(self)
	get_tree().quit()


var _autosave_t := 0.0


func _process(delta: float) -> void:
	if get_tree().paused:
		return
	_autosave_t += delta / maxf(Engine.time_scale, 0.01)
	if _autosave_t > 240.0:
		_autosave_t = 0.0
		SaveGame.save(self)
		hud.toast("(salvo automaticamente)")


func _notification(what: int) -> void:
	# celular: salva quando o app vai para o fundo / e fechado
	if what == NOTIFICATION_APPLICATION_PAUSED or what == NOTIFICATION_WM_CLOSE_REQUEST:
		if hud and not hud.start_menu_open():
			SaveGame.save(self)


func spawn_fly(p: Vector3, genome: Genome = null, generation := 1, memory := PackedFloat32Array(), lineage := -1, sex := "", extra := {}) -> Fly:
	life.fly_count += 1
	var f := Fly.new()
	f.genome = genome
	f.generation = generation
	f.inherited_memory = memory
	if lineage < 0:
		life.lineages += 1
		lineage = life.lineages
	f.lineage = lineage
	f.sex = sex if sex != "" else ("F" if randf() < 0.5 else "M")
	f.fly_name = "%s %d" % ["Femea" if f.sex == "F" else "Macho", life.fly_count]
	f.name = "Mosca_%d" % life.fly_count
	f.position = p
	f.rotation.y = randf() * TAU
	if generation == 1 and not extra.has("age"):
		f.age = LifeManager.ADULT_MATURE + randf() * 60.0
	for k: String in extra:
		f.set(k, extra[k])
	add_child(f)
	if hud and generation > 1 and not extra.has("age"):
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
