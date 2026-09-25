class_name Hud
extends CanvasLayer
## Interface: direcional de movimento com texturas proprias, barra de acoes,
## estado da mosca, painel do cerebro, ajuda e mensagens.

const UI := "res://assets/ui/"

var spectator: Spectator
var brain_view: BrainView
var _status: Label
var _hover: Label
var _toast: Label
var _toast_t := 0.0
var _help: PanelContainer
var _crosshair: Control
var _panel_normal: StyleBoxTexture
var _panel_hover: StyleBoxTexture
var _panel_pressed: StyleBoxTexture
var _time_btn: Button
var _inherit_btn: Button
var _life: Label
var _chem_view: Control
var _life_panel: PanelContainer
var _chem_fly: Fly
var _gfx_btn: Button
var _speed_btn: Button
var _pause_btn: Button
var _clock: Label
var _perf: Label
var _start: PanelContainer


static var instance: Hud


func _ready() -> void:
	instance = self
	layer = 5
	process_mode = Node.PROCESS_MODE_ALWAYS   # a interface funciona com o jogo pausado
	_panel_normal = _stylebox("panel_normal.png")
	_panel_hover = _stylebox("panel_hover.png")
	_panel_pressed = _stylebox("panel_pressed.png")
	_build_move_pad()
	_build_action_bar()
	_build_status()
	_build_brain_panel()
	_build_help()
	_build_time_bar()
	_crosshair = Control.new()
	_crosshair.set_anchors_preset(Control.PRESET_CENTER)
	_crosshair.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_crosshair.draw.connect(func():
		_crosshair.draw_circle(Vector2.ZERO, 3.0, Color(1, 1, 1, 0.8))
		_crosshair.draw_arc(Vector2.ZERO, 9.0, 0, TAU, 24, Color(1, 1, 1, 0.5), 1.5))
	add_child(_crosshair)


func bind(spec: Spectator) -> void:
	spectator = spec
	spectator.hover_changed.connect(func(t: String): _hover.text = t)
	spectator.message.connect(toast)


func toast(text: String) -> void:
	_toast.text = text
	_toast_t = 2.5


func _process(dt: float) -> void:
	var real_dt := dt / maxf(Engine.time_scale, 0.01)
	_toast_t -= real_dt
	_toast.modulate.a = clampf(_toast_t, 0.0, 1.0)
	_crosshair.visible = Input.mouse_mode == Input.MOUSE_MODE_CAPTURED
	var fly := _current_fly()
	var fol: Node = spectator.follow if spectator and is_instance_valid(spectator.follow) else null
	var keep: Node = brain_view.fly if is_instance_valid(brain_view.fly) else null
	brain_view.fly = fly if fly else (fol if fol and fol.get("brain") != null else keep)
	_chem_fly = fly
	var followed: Node = spectator.follow if spectator and is_instance_valid(spectator.follow) else null
	if not fly and not followed:
		_status.text = "Nenhuma mosca no jardim. Menu -> + Mosca / + Larva"
		_life.text = ""
	if fly:
		var st: String = ["andando", "voando", "carregada", "morta"][fly.state]
		_status.text = "%s  |  %s  |  %s\nenergia %d%%   papo %d%%   velocidade %.1f mm/s   cerebro: %s\nodor E/D %.0f/%.0f Hz   acucar %.0f   amargo %.0f   looming %.0f/%.0f   vento %.0f\nDNp09 E/D %.2f/%.2f   DNa02 %+.2f   MDN %.2f   MN9 %.2f   groom %.2f   GF %.2f   corte %.2f" % [
			fly.fly_name, st, fly.behavior, int(fly.energy * 100), int(fly.gut * 200), absf(fly.speed),
			fly.brain_label() + (" · spikes" if fly.brain.mode == 0 else " · campo medio"),
			fly.sense["odor_L"], fly.sense["odor_R"], fly.sense["sugar"], fly.sense["bitter"],
			fly.sense["loom_L"], fly.sense["loom_R"], fly.sense["mechano"],
			fly.m_fwd_l, fly.m_fwd_r, fly.m_turn, fly.m_back, fly.m_prob, fly.m_groom, fly.brain.output("escape"), fly.courtship]
		var repro := ""
		if fly.sex == "F":
			repro = "fecundada, %d ovos para botar (%d postos)" % [fly.eggs_to_lay, fly.eggs_laid] if fly.mated else ("madura" if fly.age > LifeManager.ADULT_MATURE else "imatura")
		else:
			repro = "maduro" if fly.age > LifeManager.ADULT_MATURE else "imaturo"
		_life.text = "%s #%d  geracao %d  linhagem %d  idade %ds / %ds  %s\ndecisao: %s   (%s)\nmemoria: %s\n%s\nsinapses KC->MBON alteradas %.1f%%   valencia do cheiro atual %+.2f   conectoma unico #%08x\ngenes: %s\ngenetica: %s" % [
			"femea" if fly.sex == "F" else "macho", fly.uid, fly.generation, fly.lineage, int(fly.age), int(fly.genome.get_gene("lifespan")), repro,
			fly.decision.to_upper(), _scores(fly.decision_scores), fly.mind.summary(),
			("ultima licao: " + fly.last_lesson) if fly.last_lesson != "" else "",
			fly.brain.memory_strength() * 100.0, fly.valence, int(fly.wiring[2]) & 0xFFFFFFFF, fly.genome.summary(), fly.genome.defects_text("mosca")]
	elif followed:
		_status.text = Spectator._label(followed)
		if followed is Larva:
			var l := followed as Larva
			var li := l.instar - 1
			_status.text += "\nestagio L%d: comida %d%% e dia %.1f de %.0f   reserva %d%%   enterrada %d%%   idade %.1f dias\ncerebro: conectoma da larva (%d neuronios)   odor E/D %.0f/%.0f  paladar %.0f  luz %.0f   DN-VNC E/D %.2f/%.2f  DN-SEZ %.2f" % [
				l.instar, int(minf(l.instar_food / float(LifeManager.INSTAR_FOOD[li]), 1.0) * 100), l.instar_t / LifeManager.DAY, float(LifeManager.INSTAR_DAYS[li]),
				int(l.energy * 100), int(l.hidden * 100), l.age / LifeManager.DAY,
				l.brain.n, l.sense["odor_L"], l.sense["odor_R"], l.sense["taste"], l.sense["light"], l.m_crawl_l, l.m_crawl_r, l.m_feed]
		_life.text = ""
		if followed is Frog:
			var fr := followed as Frog
			var fb = fr.brain
			_status.text += "\nenergia %d%%  pele (hidratacao) %d%%  saude %d%%  idade %.1f dias  %s\ncerebro: %s (%d neuronios)   presa E/D %.0f/%.0f  ameaca E/D %.0f/%.0f\nmusculos extensores E/D %.2f/%.2f  pernas E/D %.2f/%.2f  orientar E/D %.2f/%.2f  LINGUA %.2f  fuga %.2f/%.2f  canto %.2f\nreflexos: boca %.2f  engolir %.2f  limpar %.2f/%.2f  abraco %.2f  grito %.2f  inflar %.2f  andar %.2f\nhormonios: corticosterona %.2f  vasotocina %.2f  GnRH %.2f  melatonina %.2f  MSH %.2f  sede %.2f\norgaos: %s" % [
				int(fr.energy * 100), int(fr.hydration * 100), int(fr.health * 100), fr.age / LifeManager.DAY, "jovem" if fr.growth < 0.95 else "adulta",
				fb.name, fb.n, fr.sense["presa_L"], fr.sense["presa_R"], fr.sense["sombra_L"], fr.sense["sombra_R"],
				fr.act["L"], fr.act["R"], fr.ext["L"], fr.ext["R"], fb.output("orient_L"), fb.output("orient_R"), fb.output("snap"),
				fb.output("escape_L"), fb.output("escape_R"), fb.output("call"),
				fb.output("boca_abrir"), fb.output("engolir"), fb.output("limpar_L"), fb.output("limpar_R"), fb.output("abraco_L"), fb.output("grito"),
				fb.output("inflar"), (fb.output("andar_L") + fb.output("andar_R")) * 0.5,
				fb.output("cort"), fb.output("avt"), fb.output("gnrh"), fb.output("melatonina"), fb.output("escurecer"), fb.output("sede"), fr.org.summary()]
			_life.text = "ra #%d  decisao: %s   (%s)\nmemoria: %s\n%s\ngenetica: %s   vigor %d%%" % [fr.uid, fr.decision.to_upper(), _scores(fr.decision_scores),
				fr.mind.summary(), ("ultima licao: " + fr.last_lesson) if fr.last_lesson != "" else "", fr.genome.defects_text("ra"), int(fr.vigor() * 100)]
		elif followed is Tadpole:
			var tp := followed as Tadpole
			var tb = tp.brain
			_status.text += "\nenergia %d%%  crescimento %d%%  metamorfose %d%%  idade %.1f dias\ncerebro: %s (%d neuronios)   linha lateral E/D %.0f/%.0f  sombra %.0f\nsaidas: nado E/D %.2f/%.2f  Mauthner E/D %.2f/%.2f  boca %.2f\norgaos: %s" % [
				int(tp.energy * 100), int(tp.growth * 100), int(tp.climax * 100), tp.age / LifeManager.DAY, tb.name, tb.n,
				tp.sense["linha_lateral_L"], tp.sense["linha_lateral_R"], tp.sense["sombra"],
				tb.output("swim_L"), tb.output("swim_R"), tb.output("escape_L"), tb.output("escape_R"), tb.output("feed"), tp.org.summary()]
			_life.text = "girino #%d  decisao: %s   (%s)\nmemoria: %s\n%s\ngenetica: %s" % [tp.uid, tp.decision.to_upper(), _scores(tp.decision_scores),
				tp.mind.summary(), ("ultima licao: " + tp.last_lesson) if tp.last_lesson != "" else "", tp.genome.defects_text("ra")]
		if followed is Larva:
			var l := followed as Larva
			_life.text = "larva #%d  decisao: %s   (%s)\nmemoria: %s\n%s\ngenetica: %s" % [l.uid, l.decision.to_upper(), _scores(l.decision_scores),
				l.mind.summary(), ("ultima licao: " + l.last_lesson) if l.last_lesson != "" else "", l.genome.defects_text("mosca")]
	var lm := LifeManager.instance
	if lm:
		var d := ""
		for k: String in lm.deaths:
			d += "%s %d  " % [k, lm.deaths[k]]
		_life.text += "\npopulacao: %d moscas  %d larvas  %d pupas  %d ovos  |  %d ras  %d girinos  %d desovas   nascimentos %d   geracao max %d\nmortes: %s" % [
			lm.adults_alive(), lm.count("larvae"), lm.count("pupae"), lm.count("eggs"), lm.count("frogs"), lm.count("tadpoles"), lm.count("frog_eggs"),
			lm.births, lm.max_generation, d if d != "" else "nenhuma"]
	if GardenWorld.instance:
		_gfx_btn.text = "Graficos: %s" % ("leve" if GardenWorld.instance.low_quality else "alto")
	_chem_view.visible = fly != null and _life.visible
	_chem_view.queue_redraw()
	var ts := Engine.time_scale
	_time_btn.text = "Tempo x%s" % _fmt_speed(ts)
	_speed_btn.text = "x%s" % _fmt_speed(ts)
	_pause_btn.text = "Continuar" if get_tree().paused else "Pausar"
	if GardenWorld.instance:
		_clock.text = GardenWorld.instance.clock_text() + ("   PAUSADO" if get_tree().paused else "")
	var eng := BrainEngine.instance
	_perf.text = "%d FPS   cerebros GPU %d/quadro  %.1f ms" % [Engine.get_frames_per_second(), eng.stepped_last if eng else 0, eng.gpu_ms if eng else 0.0]


func _scores(sc: Dictionary) -> String:
	var parts: PackedStringArray = []
	for k: String in sc:
		parts.append("%s %.2f" % [k, float(sc[k])])
	return ", ".join(parts)


func _fmt_speed(ts: float) -> String:
	return str(int(ts)) if ts >= 1.0 else str(ts)


func _current_fly() -> Fly:
	if spectator and is_instance_valid(spectator.follow):
		return spectator.follow as Fly
	var flies := get_tree().get_nodes_in_group("flies")
	return flies[0] if not flies.is_empty() else null


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("toggle_brain"):
		brain_view.get_parent().visible = not brain_view.get_parent().visible
	elif event.is_action_pressed("toggle_life"):
		_life.visible = not _life.visible
		_chem_view.visible = _life.visible
	elif event.is_action_pressed("toggle_help"):
		_help.visible = not _help.visible
	elif event.is_action_pressed("time_scale"):
		cycle_time()
	elif event.is_action_pressed("pause"):
		toggle_pause()
	elif event.is_action_pressed("save"):
		_main_call("save_world")
	elif event.is_action_pressed("swap_brain"):
		toggle_brain_source()


func toggle_brain_source() -> void:
	var order := ["full", "sub", "default"]
	Fly.brain_kind = order[(order.find(Fly.brain_kind) + 1) % order.size()]
	var flies := get_tree().get_nodes_in_group("flies")
	for f: Fly in flies:
		if not f.dead:
			f.reload_brain()
	if not flies.is_empty():
		toast("Cerebro: " + (flies[0] as Fly).brain_label())


## Barras de hormonios/neuromoduladores da mosca atual.
func _draw_chem() -> void:
	if _chem_fly == null or not is_instance_valid(_chem_fly):
		return
	var font := _chem_view.get_theme_default_font()
	var names := ["insulina", "DH44", "AKH", "octopamina", "serotonina", "leucocinina", "dopamina+", "dopamina-"]
	var cols := [Color(0.4, 0.8, 1.0), Color(1.0, 0.6, 0.3), Color(1.0, 0.4, 0.3), Color(1.0, 0.9, 0.3), Color(0.7, 0.5, 1.0), Color(0.5, 1.0, 0.8), Color(0.4, 1.0, 0.4), Color(1.0, 0.35, 0.5)]
	var w := 128.0
	for i in names.size():
		var x := (i % 4) * (w + 4.0)
		var y := (i / 4) * 28.0
		var lv := clampf(_chem_fly.chem.get_level(names[i]), 0.0, 1.5) / 1.5
		_chem_view.draw_string(font, Vector2(x, y + 11), names[i], HORIZONTAL_ALIGNMENT_LEFT, w, 11, Color(0.85, 0.9, 0.85))
		_chem_view.draw_rect(Rect2(x, y + 14, w, 8), Color(1, 1, 1, 0.08))
		_chem_view.draw_rect(Rect2(x, y + 14, w * lv, 8), cols[i])


## Acelerador de tempo: x1 -> x2 -> x4 -> x8 -> camera lenta x0.5 / x0.25.
## Com o tempo rapido a fisica usa mais ticks por segundo (passos menores) e
## os cerebros passam para o modo de campo medio (mais barato).
const SPEEDS := [1.0, 2.0, 4.0, 8.0, 0.25, 0.5]


func cycle_time() -> void:
	var i := SPEEDS.find(Engine.time_scale)
	set_speed(SPEEDS[(i + 1) % SPEEDS.size()])


func set_speed(ts: float) -> void:
	Engine.time_scale = ts
	Engine.physics_ticks_per_second = 60 if ts <= 2.0 else (90 if ts <= 4.0 else 120)
	Engine.max_physics_steps_per_frame = 8
	toast("Velocidade do tempo: x%s" % _fmt_speed(ts))


func toggle_pause() -> void:
	if start_menu_open():
		return
	get_tree().paused = not get_tree().paused
	toast("Pausado" if get_tree().paused else "Continuando")


func _main_call(m: String) -> void:
	var main := get_tree().current_scene
	if main and main.has_method(m):
		main.call(m)


# ---------------------------------------------------------------- construcao
func _stylebox(file: String) -> StyleBoxTexture:
	var sb := StyleBoxTexture.new()
	sb.texture = load(UI + file)
	sb.texture_margin_left = 22
	sb.texture_margin_right = 22
	sb.texture_margin_top = 22
	sb.texture_margin_bottom = 24
	sb.content_margin_left = 14
	sb.content_margin_right = 14
	sb.content_margin_top = 8
	sb.content_margin_bottom = 10
	return sb


func _tex_button(icon: String, action: String, tip: String) -> TextureButton:
	var b := TextureButton.new()
	b.texture_normal = load(UI + "btn_%s_normal.png" % icon)
	b.texture_hover = load(UI + "btn_%s_hover.png" % icon)
	b.texture_pressed = load(UI + "btn_%s_pressed.png" % icon)
	b.ignore_texture_size = true
	b.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_CENTERED
	b.custom_minimum_size = Vector2(76, 76)
	b.tooltip_text = tip
	b.focus_mode = Control.FOCUS_NONE
	# segurar o botao = segurar a tecla (funciona com toque tambem)
	b.button_down.connect(func(): Input.action_press(action))
	b.button_up.connect(func(): Input.action_release(action))
	b.mouse_exited.connect(func():
		if Input.is_action_pressed(action):
			Input.action_release(action))
	return b


func _spacer() -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(76, 76)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return c


const PAD_BTN := 128.0     # tamanho dos botoes de movimento (px)

var _pad: Node2D
var _pad_buttons: Array[TouchScreenButton] = []


## Direcional com TouchScreenButton: funciona com varios dedos ao mesmo tempo
## (ex.: segurar "frente" e girar a camera arrastando outro dedo na tela).
func _build_move_pad() -> void:
	_pad = Node2D.new()
	_pad.name = "Direcional"
	add_child(_pad)
	var layout := [
		["turn_left", "turn_left", 0, 0], ["forward", "move_forward", 1, 0], ["turn_right", "turn_right", 2, 0],
		["left", "move_left", 0, 1], ["back", "move_back", 1, 1], ["right", "move_right", 2, 1],
		["up", "move_up", 3.25, 0], ["down", "move_down", 3.25, 1],
	]
	for item: Array in layout:
		var tb := TouchScreenButton.new()
		tb.texture_normal = load(UI + "btn_%s_normal.png" % item[0])
		tb.texture_pressed = load(UI + "btn_%s_pressed.png" % item[0])
		tb.action = item[1]
		tb.passby_press = true
		var sc := PAD_BTN / 112.0
		tb.scale = Vector2(sc, sc)
		tb.set_meta("cell", Vector2(item[2], item[3]))
		_pad.add_child(tb)
		_pad_buttons.append(tb)
	get_viewport().size_changed.connect(_layout_pad)
	_layout_pad()


func _layout_pad() -> void:
	var vs := get_viewport().get_visible_rect().size
	var gap := 8.0
	for tb in _pad_buttons:
		var c: Vector2 = tb.get_meta("cell")
		tb.position = Vector2(20.0 + c.x * (PAD_BTN + gap), vs.y - 20.0 - (2.0 - c.y) * (PAD_BTN + gap))


## O toque em pos cai sobre algum botao/painel da interface?
func is_over_ui(pos: Vector2) -> bool:
	for tb in _pad_buttons:
		if Rect2(tb.position, Vector2(PAD_BTN, PAD_BTN)).has_point(pos):
			return true
	for c: Control in _ui_controls:
		if is_instance_valid(c) and c.is_visible_in_tree() and c.get_global_rect().has_point(pos):
			return true
	return false


var _ui_controls: Array[Control] = []


func _text_button(text: String, cb: Callable, tip := "") -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_stylebox_override("normal", _panel_normal)
	b.add_theme_stylebox_override("hover", _panel_hover)
	b.add_theme_stylebox_override("pressed", _panel_pressed)
	b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	b.add_theme_color_override("font_color", Color(1, 0.99, 0.9))
	b.add_theme_color_override("font_hover_color", Color(1, 1, 1))
	b.add_theme_color_override("font_outline_color", Color(0.05, 0.2, 0.07))
	b.add_theme_constant_override("outline_size", 4)
	b.add_theme_font_size_override("font_size", 22)
	b.custom_minimum_size = Vector2(150, 72)
	b.pressed.connect(cb)
	_ui_controls.append(b)
	return b


var _menu: PanelContainer


func _build_action_bar() -> void:
	# sempre visiveis (canto inferior direito)
	var quick := HBoxContainer.new()
	quick.anchor_left = 1.0
	quick.anchor_right = 1.0
	quick.anchor_top = 1.0
	quick.anchor_bottom = 1.0
	quick.offset_right = -20
	quick.offset_bottom = -20
	quick.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	quick.grow_vertical = Control.GROW_DIRECTION_BEGIN
	quick.add_theme_constant_override("separation", 10)
	quick.add_child(_text_button("Ir ate a mosca", func(): spectator.teleport_to_fly(), "Teleportar para perto da mosca e segui-la (I)"))
	quick.add_child(_text_button("Seguir", func(): spectator.cycle_follow(), "Seguir mosca/larva ou camera livre (C)"))
	quick.add_child(_text_button("Soprar", func(): spectator.air_puff(), "Sopro de ar (F)"))
	quick.add_child(_text_button("Raio-X", _toggle_xray, "Ver os orgaos da ra/girino seguido (coracao, pulmoes, estomago...)"))
	quick.add_child(_text_button("Menu", _toggle_menu, "Criar coisas e opcoes"))
	add_child(quick)

	_menu = PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.03, 0.08, 0.04, 0.88)
	sb.set_corner_radius_all(18)
	sb.set_content_margin_all(16)
	_menu.add_theme_stylebox_override("panel", sb)
	_menu.anchor_left = 1.0
	_menu.anchor_right = 1.0
	_menu.anchor_top = 1.0
	_menu.anchor_bottom = 1.0
	_menu.offset_right = -20
	_menu.offset_bottom = -110
	_menu.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_menu.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_ui_controls.append(_menu)
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	grid.add_child(_text_button("Maca", func(): _spawn(1), "Criar maca (1)"))
	grid.add_child(_text_button("Cereja", func(): _spawn(2), "Criar cereja (2)"))
	grid.add_child(_text_button("Laranja", func(): _spawn(3), "Criar laranja (3)"))
	grid.add_child(_text_button("Limao", func(): _spawn(4), "Criar limao amargo (4)"))
	grid.add_child(_text_button("Pedra", func(): _spawn(5), "Criar pedrinha (5)"))
	grid.add_child(_text_button("+ Mosca", func(): _spawn(6), "Criar mosca (6)"))
	grid.add_child(_text_button("+ Larva", func(): _spawn(7), "Criar larva (7)"))
	grid.add_child(_text_button("+ Ra", func(): _spawn(8), "Criar ra adulta (8)"))
	grid.add_child(_text_button("+ Girino", func(): _spawn(9), "Criar girino no lago (9)"))
	grid.add_child(_text_button("+ Desova", func(): _spawn(10), "Colocar ovos de ra no lago (0)"))
	_time_btn = _text_button("Tempo x1", cycle_time, "Acelerar / camera lenta (T)")
	grid.add_child(_time_btn)
	grid.add_child(_text_button("Cerebro", func(): brain_view.get_parent().visible = not brain_view.get_parent().visible, "Painel do cerebro (B)"))
	grid.add_child(_text_button("Vida", func():
		_life.visible = not _life.visible
		_chem_view.visible = _life.visible, "Painel de vida (L)"))
	grid.add_child(_text_button("Trocar cerebro", toggle_brain_source, "Conectoma completo (GPU) / subcircuito / padrao (N)"))
	grid.add_child(_text_button("Ajuda", func(): _help.visible = not _help.visible, "Ajuda (H)"))
	_gfx_btn = _text_button("Graficos: alto", func():
		var gw := GardenWorld.instance
		gw.set_quality(not gw.low_quality)
		toast("Graficos " + ("leves (mais rapido)" if gw.low_quality else "altos")), "Graficos leves = bem mais leve no celular")
	grid.add_child(_gfx_btn)
	grid.add_child(_text_button("Exportar arquivos", func():
		var main := get_tree().current_scene
		SaveGame.save(main)
		toast(SaveGame.export_copy())
		_toast_t = 8.0, "Salva e copia os arquivos dos individuos para Documentos (pasta visivel)"))
	_menu.add_child(grid)
	_menu.visible = false
	add_child(_menu)


var _brain_was_visible := true


func _toggle_xray() -> void:
	var f: Node = spectator.follow if spectator and is_instance_valid(spectator.follow) else null
	if f and f.has_method("set_xray"):
		var on := not bool(f.get("model").is_xray()) if f.get("model") else true
		f.call("set_xray", on)
		toast("Raio-X " + ("ligado: orgaos a mostra" if on else "desligado"))
	else:
		toast("Siga uma ra ou um girino (Seguir) para ver os orgaos")


func _toggle_menu() -> void:
	_menu.visible = not _menu.visible
	var holder := brain_view.get_parent() as Control
	if _menu.visible:
		_brain_was_visible = holder.visible
		holder.visible = false
	else:
		holder.visible = _brain_was_visible


func _spawn(i: int) -> void:
	# botoes da tela criam no centro da vista
	spectator.spawn(i, true)


func _build_status() -> void:
	var pc := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.03, 0.06, 0.04, 0.7)
	sb.set_corner_radius_all(10)
	sb.content_margin_left = 12
	sb.content_margin_right = 12
	sb.content_margin_top = 8
	sb.content_margin_bottom = 8
	pc.add_theme_stylebox_override("panel", sb)
	pc.position = Vector2(16, 16)
	pc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var v := VBoxContainer.new()
	var title := Label.new()
	title.text = "Mosca no Jardim — NeuroMechFly (flygym) + cerebro spiking"
	title.add_theme_font_size_override("font_size", 17)
	title.add_theme_color_override("font_color", Color(0.75, 1.0, 0.7))
	v.add_child(title)
	_status = Label.new()
	_status.add_theme_font_size_override("font_size", 13)
	v.add_child(_status)
	_life = Label.new()
	_life.add_theme_font_size_override("font_size", 12)
	_life.add_theme_color_override("font_color", Color(0.85, 0.95, 0.8))
	v.add_child(_life)
	_chem_view = Control.new()
	_chem_view.custom_minimum_size = Vector2(520, 58)
	_chem_view.draw.connect(_draw_chem)
	v.add_child(_chem_view)
	pc.add_child(v)
	add_child(pc)

	_hover = Label.new()
	_hover.anchor_left = 0.5
	_hover.anchor_right = 0.5
	_hover.anchor_top = 1.0
	_hover.anchor_bottom = 1.0
	_hover.offset_left = -300
	_hover.offset_right = 300
	_hover.offset_top = -170
	_hover.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_hover.add_theme_font_size_override("font_size", 16)
	_hover.add_theme_constant_override("outline_size", 6)
	_hover.add_theme_color_override("font_outline_color", Color(0, 0, 0))
	add_child(_hover)

	_toast = Label.new()
	_toast.anchor_left = 0.5
	_toast.anchor_right = 0.5
	_toast.offset_left = -300
	_toast.offset_right = 300
	_toast.offset_top = 90
	_toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast.add_theme_font_size_override("font_size", 20)
	_toast.add_theme_constant_override("outline_size", 8)
	_toast.add_theme_color_override("font_outline_color", Color(0, 0, 0))
	add_child(_toast)


func _build_brain_panel() -> void:
	var holder := MarginContainer.new()
	holder.anchor_left = 1.0
	holder.anchor_right = 1.0
	holder.offset_left = -446
	holder.offset_right = -16
	holder.offset_top = 16
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	brain_view = BrainView.new()
	holder.add_child(brain_view)
	add_child(holder)
	# em telas pequenas (celular) o painel comeca escondido (botao Cerebro / B)
	holder.visible = get_viewport().get_visible_rect().size.x >= 1500.0


func _build_help() -> void:
	_help = PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.02, 0.05, 0.03, 0.9)
	sb.set_corner_radius_all(14)
	sb.content_margin_left = 22
	sb.content_margin_right = 22
	sb.content_margin_top = 16
	sb.content_margin_bottom = 16
	_help.add_theme_stylebox_override("panel", sb)
	_help.set_anchors_preset(Control.PRESET_CENTER)
	_help.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_help.grow_vertical = Control.GROW_DIRECTION_BOTH
	var l := Label.new()
	l.add_theme_font_size_override("font_size", 15)
	l.text = """Voce e um espectador invisivel no jardim (1 unidade = 1 mm; a mosca tem ~2,5 mm).

TOQUE       arraste o dedo na tela para girar | dois dedos: zoom
            segure o dedo parado num item (ou mosca/larva) para pega-lo e arraste
            toque rapido numa mosca/larva para segui-la
MOVIMENTO   W A S D ou botoes verdes  |  E / Espaco sobe, Q / Ctrl desce
            setas esq/dir ou Z/X giram  |  Shift rapido, Alt lento
            roda do mouse = velocidade  |  botao direito segurado = olhar  |  Tab prende o mouse
SEGUIR      C (ou botao Seguir): orbita mosca/larva/pupa; W/S zoom, A/D orbita, E/Q inclina
            I (ou "Ir ate a mosca"): teleporta ate a mosca  |  L painel de vida

MUNDO       mouse esquerdo = dedo (segurar pega, arrastar gira); algo pesado caindo esmaga
            solte com o mouse em movimento para arremessar | roda = distancia
            F ou botao do meio: soprar (empurra objetos e a mosca sente o vento)
            1 maca  2 cereja  3 laranja  4 limao amargo  5 pedra  6 mosca  7 larva
            Del apaga o objeto segurado  |  B cerebro  |  N troca cerebro  |  H ajuda
TEMPO       P pausa | T acelera (x1 x2 x4 x8, depois camera lenta) | F5 salva | dia e noite (12 min)

A MOSCA     Anda com passadas reais gravadas (flygym), coordenadas por um CPG.
            Cheiro de fruta (fermentada atrai mais) -> vira e caminha ate ela.
            Pisar em acucar -> estende a probocide e come ate saciar.
            Amargo -> anda para tras e APRENDE (ninguem nasce sabendo do limao).
            Algo vindo rapido -> Giant Fiber -> foge voando. Sopro -> limpa as antenas.
DECISAO     comer, buscar comida, evitar, fugir, descansar (a noite dormem) ou explorar:
            fome, medo, memoria e hormonios decidem. Quem VE alguem ser esmagado aprende
            o lugar perigoso e passa a desviar de coisas caindo. So morre esmagado se algo
            pesado cair literalmente em cima.

VIDA        Cerebro real (MCNS): hormonios (insulina, DH44, octopamina, serotonina...)
            saem dos neuronios neuroendocrinos. Dopamina PAM/PPL1 altera as sinapses
            KC->MBON: ela lembra quais cheiros deram comida e quais deram susto.
            Come a polpa (a fruta encolhe), excreta, envelhece e morre.
            Machos cortejam femeas (pC1), femeas fecundadas botam ovos nas frutas:
            ovo (1 dia) -> larva L1, L2, L3 com mudas de pele (4+ dias comendo) ->
            pupa (4 dias: a larva e dissolvida e o corpo da mosca se forma) -> adulto.
            Filhos herdam so os genes e a fiacao do cerebro (nascem sem memoria);
            da larva para a mosca parte da memoria sobrevive, como na vida real.
LARVAS      comem enterradas na polpa, cavam buracos na terra para se esconder e
            escolhem um lugar seguro (sem perigo, fora de onde caem frutas, na
            sombra) para pupar, enterradas se for terra. Segure a pupa para pega-la."""
	_help.add_child(l)
	_help.visible = false
	add_child(_help)


# ---------------------------------------------------------------- tempo e arquivo
## Barra de cima: relogio (dia/noite), pausar, acelerar, salvar e sair.
func _build_time_bar() -> void:
	var box := VBoxContainer.new()
	box.anchor_left = 0.5
	box.anchor_right = 0.5
	box.offset_top = 12
	box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	_pause_btn = _text_button("Pausar", toggle_pause, "Pausar / continuar (P)")
	_speed_btn = _text_button("x1", cycle_time, "Acelerar o tempo: x1, x2, x4, x8 (T)")
	var save_b := _text_button("Salvar", func(): _main_call("save_world"), "Salvar o progresso (F5)")
	var quit_b := _text_button("Sair", func(): _main_call("save_and_quit"), "Salvar e sair do jogo")
	for b: Button in [_pause_btn, _speed_btn, save_b, quit_b]:
		b.custom_minimum_size = Vector2(118, 64)
		b.add_theme_font_size_override("font_size", 20)
		row.add_child(b)
	box.add_child(row)
	_clock = Label.new()
	_clock.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_clock.add_theme_font_size_override("font_size", 18)
	_clock.add_theme_constant_override("outline_size", 6)
	_clock.add_theme_color_override("font_outline_color", Color(0, 0, 0))
	box.add_child(_clock)
	_perf = Label.new()
	_perf.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_perf.add_theme_font_size_override("font_size", 12)
	_perf.add_theme_constant_override("outline_size", 4)
	_perf.add_theme_color_override("font_outline_color", Color(0, 0, 0))
	_perf.modulate = Color(1, 1, 1, 0.7)
	box.add_child(_perf)
	add_child(box)
	_toast.offset_top = 150


## Tela inicial: lista dos mundos salvos (continuar ou apagar) e mundo novo.
func show_start_menu() -> void:
	get_tree().paused = true
	if start_menu_open():
		_start.queue_free()
	_start = PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.02, 0.06, 0.03, 0.92)
	sb.set_corner_radius_all(22)
	sb.set_content_margin_all(28)
	_start.add_theme_stylebox_override("panel", sb)
	_start.set_anchors_preset(Control.PRESET_CENTER)
	_start.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_start.grow_vertical = Control.GROW_DIRECTION_BOTH
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	var t := Label.new()
	t.text = str(ProjectSettings.get_setting("application/config/name"))
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	t.add_theme_font_size_override("font_size", 34)
	t.add_theme_color_override("font_color", Color(0.75, 1.0, 0.7))
	v.add_child(t)
	var sub := Label.new()
	sub.text = "Moscas, larvas, ras e girinos, cada individuo com o proprio conectoma.\nOs cerebros nascem zerados: tudo o que sabem, aprendem vivendo."
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	sub.add_theme_font_size_override("font_size", 15)
	v.add_child(sub)
	var slots := SaveGame.list_slots()
	if not slots.is_empty():
		var sc := ScrollContainer.new()
		sc.custom_minimum_size = Vector2(760, mini(slots.size(), 4) * 96)
		sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		var list := VBoxContainer.new()
		list.add_theme_constant_override("separation", 10)
		list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		for slot: Dictionary in slots:
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 10)
			var path: String = slot["pasta"]
			var go := _start_button("%s  (dia %d, %d individuos, %s)" % [slot["nome"], slot["dia"], slot["individuos"], slot["salvo_em"]], func():
				SaveGame.DIR = path
				_close_start("continue_world"))
			go.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			go.custom_minimum_size = Vector2(560, 84)
			go.add_theme_font_size_override("font_size", 20)
			row.add_child(go)
			var del := _start_button("Apagar", func(): _confirm_delete(path, str(slot["nome"])))
			del.custom_minimum_size = Vector2(150, 84)
			del.add_theme_color_override("font_color", Color(1.0, 0.75, 0.7))
			row.add_child(del)
			list.add_child(row)
		sc.add_child(list)
		v.add_child(sc)
	v.add_child(_start_button("Novo mundo (vazio)", func():
		SaveGame.DIR = SaveGame.new_slot()
		_close_start("new_world")))
	v.add_child(_start_button("Sair", func(): get_tree().quit()))
	_start.add_child(v)
	add_child(_start)
	_ui_controls.append(_start)


## Confirmacao antes de apagar (nao da para desfazer).
func _confirm_delete(path: String, nome: String) -> void:
	var dlg := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.12, 0.03, 0.02, 0.97)
	sb.set_corner_radius_all(18)
	sb.set_content_margin_all(26)
	dlg.add_theme_stylebox_override("panel", sb)
	dlg.set_anchors_preset(Control.PRESET_CENTER)
	dlg.grow_horizontal = Control.GROW_DIRECTION_BOTH
	dlg.grow_vertical = Control.GROW_DIRECTION_BOTH
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 14)
	var l := Label.new()
	l.text = "Apagar \"%s\"?\nTodos os individuos e o historico desse mundo somem para sempre." % nome
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.add_theme_font_size_override("font_size", 20)
	v.add_child(l)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 16)
	row.add_child(_start_button("Sim, apagar", func():
		var ok := SaveGame.delete_slot(path)
		dlg.queue_free()
		toast("Mundo apagado" if ok else "Nao consegui apagar")
		show_start_menu()))
	row.add_child(_start_button("Cancelar", func(): dlg.queue_free()))
	for c in row.get_children():
		(c as Button).custom_minimum_size = Vector2(240, 84)
	v.add_child(row)
	dlg.add_child(v)
	add_child(dlg)
	_ui_controls.append(dlg)


func _start_button(text: String, cb: Callable) -> Button:
	var b := _text_button(text, cb)
	b.custom_minimum_size = Vector2(560, 84)
	b.add_theme_font_size_override("font_size", 24)
	return b


func _close_start(method: String) -> void:
	_start.queue_free()
	_start = null
	get_tree().paused = false
	_main_call(method)


func start_menu_open() -> bool:
	return _start != null and is_instance_valid(_start)
