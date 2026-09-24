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


func _ready() -> void:
	layer = 5
	_panel_normal = _stylebox("panel_normal.png")
	_panel_hover = _stylebox("panel_hover.png")
	_panel_pressed = _stylebox("panel_pressed.png")
	_build_move_pad()
	_build_action_bar()
	_build_status()
	_build_brain_panel()
	_build_help()
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
	brain_view.fly = fly
	if fly:
		var st: String = ["andando", "voando", "carregada"][fly.state]
		_status.text = "%s  |  %s  |  %s\nfome %d%%   velocidade %.1f mm/s\nodor E/D %.0f/%.0f Hz   acucar %.0f   amargo %.0f   looming %.0f/%.0f   vento %.0f\nDNp09 E/D %.2f/%.2f   DNa02 %+.2f   MDN %.2f   MN9 %.2f   aDN %.2f   GF %.2f" % [
			fly.fly_name, st, fly.behavior, int(fly.hunger * 100), absf(fly.speed),
			fly.sense["odor_L"], fly.sense["odor_R"], fly.sense["sugar"], fly.sense["bitter"],
			fly.sense["loom_L"], fly.sense["loom_R"], fly.sense["mechano"],
			fly.m_fwd_l, fly.m_fwd_r, fly.m_turn, fly.m_back, fly.m_prob, fly.m_groom, fly.brain.output("escape")]
	var ts := Engine.time_scale
	_time_btn.text = "Tempo x%s" % (str(ts) if ts < 1.0 else "1")


func _current_fly() -> Fly:
	if spectator and spectator.follow and is_instance_valid(spectator.follow):
		return spectator.follow
	var flies := get_tree().get_nodes_in_group("flies")
	return flies[0] if not flies.is_empty() else null


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("toggle_brain"):
		brain_view.get_parent().visible = not brain_view.get_parent().visible
	elif event.is_action_pressed("toggle_help"):
		_help.visible = not _help.visible
	elif event.is_action_pressed("time_scale"):
		cycle_time()
	elif event.is_action_pressed("swap_brain"):
		toggle_brain_source()


func toggle_brain_source() -> void:
	if not FileAccess.file_exists("res://brain/connectome.json"):
		toast("Nenhum brain/connectome.json (veja tools/extract_connectome.py)")
		return
	var flies := get_tree().get_nodes_in_group("flies")
	if flies.is_empty():
		return
	var use: bool = not (flies[0] as Fly).using_connectome()
	for f: Fly in flies:
		f.reload_brain(use)
	toast("Cerebro: " + (flies[0] as Fly).brain.name)


func cycle_time() -> void:
	var steps := [1.0, 0.5, 0.25, 0.1]
	var i := steps.find(Engine.time_scale)
	Engine.time_scale = steps[(i + 1) % steps.size()]
	toast("Velocidade do tempo: x%s" % str(Engine.time_scale))


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


func _build_move_pad() -> void:
	var root := HBoxContainer.new()
	root.anchor_top = 1.0
	root.anchor_bottom = 1.0
	root.offset_left = 16
	root.offset_top = -16
	root.offset_bottom = -16
	root.grow_vertical = Control.GROW_DIRECTION_BEGIN
	root.add_theme_constant_override("separation", 14)
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 4)
	grid.add_theme_constant_override("v_separation", 4)
	grid.add_child(_tex_button("turn_left", "turn_left", "Girar para a esquerda (seta esquerda / Z)"))
	grid.add_child(_tex_button("forward", "move_forward", "Frente (W) — seguindo: aproximar"))
	grid.add_child(_tex_button("turn_right", "turn_right", "Girar para a direita (seta direita / X)"))
	grid.add_child(_tex_button("left", "move_left", "Esquerda (A) — seguindo: orbitar"))
	grid.add_child(_tex_button("back", "move_back", "Tras (S) — seguindo: afastar"))
	grid.add_child(_tex_button("right", "move_right", "Direita (D) — seguindo: orbitar"))
	root.add_child(grid)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 4)
	col.add_child(_tex_button("up", "move_up", "Subir (E / Espaco)"))
	col.add_child(_tex_button("down", "move_down", "Descer (Q / Ctrl)"))
	root.add_child(col)
	add_child(root)


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
	b.add_theme_font_size_override("font_size", 15)
	b.custom_minimum_size = Vector2(84, 46)
	b.pressed.connect(cb)
	return b


func _build_action_bar() -> void:
	var bar := HFlowContainer.new()
	bar.anchor_left = 1.0
	bar.anchor_right = 1.0
	bar.anchor_top = 1.0
	bar.anchor_bottom = 1.0
	bar.offset_left = -640
	bar.offset_right = -16
	bar.offset_top = -126
	bar.offset_bottom = -16
	bar.alignment = FlowContainer.ALIGNMENT_END
	bar.add_theme_constant_override("h_separation", 6)
	bar.add_theme_constant_override("v_separation", 6)
	bar.add_child(_text_button("Maca", func(): _spawn(1), "Criar maca (1)"))
	bar.add_child(_text_button("Cereja", func(): _spawn(2), "Criar cereja (2)"))
	bar.add_child(_text_button("Laranja", func(): _spawn(3), "Criar laranja (3)"))
	bar.add_child(_text_button("Limao", func(): _spawn(4), "Criar limao amargo (4)"))
	bar.add_child(_text_button("Pedra", func(): _spawn(5), "Criar pedrinha (5)"))
	bar.add_child(_text_button("+ Mosca", func(): _spawn(6), "Criar outra mosca (6)"))
	bar.add_child(_text_button("Soprar", func(): spectator.air_puff(), "Sopro de ar (F / botao do meio)"))
	bar.add_child(_text_button("Seguir", func(): spectator.cycle_follow(), "Seguir mosca / camera livre (C)"))
	_time_btn = _text_button("Tempo x1", cycle_time, "Camera lenta (T)")
	bar.add_child(_time_btn)
	bar.add_child(_text_button("Cerebro", func(): brain_view.get_parent().visible = not brain_view.get_parent().visible, "Mostrar/ocultar cerebro (B)"))
	if FileAccess.file_exists("res://brain/connectome.json"):
		bar.add_child(_text_button("Trocar cerebro", toggle_brain_source, "Circuito padrao <-> conectoma extraido (N)"))
	bar.add_child(_text_button("Ajuda", func(): _help.visible = not _help.visible, "Ajuda (H)"))
	add_child(bar)


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

MOVIMENTO   W A S D ou botoes verdes  |  E / Espaco sobe, Q / Ctrl desce
            setas esq/dir ou Z/X giram  |  Shift rapido, Alt lento
            roda do mouse = velocidade  |  botao direito segurado = olhar  |  Tab prende o mouse
SEGUIR      C (ou botao Seguir): orbita a mosca; W/S zoom, A/D orbita, E/Q inclina

MUNDO       botao esquerdo: pegar e arrastar frutas, pedras e a propria mosca
            solte com o mouse em movimento para arremessar | roda = distancia
            F ou botao do meio: soprar (empurra objetos e a mosca sente o vento)
            1 maca  2 cereja  3 laranja  4 limao amargo  5 pedra  6 outra mosca
            Del apaga o objeto segurado  |  T camera lenta  |  B cerebro  |  N troca cerebro  |  H ajuda

A MOSCA     Anda com passadas reais gravadas (flygym), coordenadas por um CPG.
            Cheiro de fruta (fermentada atrai mais) -> vira e caminha ate ela.
            Pisar em acucar -> estende a probocide e come ate saciar.
            Amargo (limao) -> anda para tras. Algo vindo rapido -> Giant Fiber -> foge voando.
            Sopro -> limpa as antenas. Com fome e sem cheiro, voa ate uma fruta."""
	_help.add_child(l)
	_help.visible = false
	add_child(_help)
