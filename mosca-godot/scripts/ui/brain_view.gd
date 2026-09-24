class_name BrainView
extends Control
## Painel do cerebro: raster de spikes dos ultimos segundos + taxa de disparo
## de cada populacao (sensoriais em azul, interneuronios em verde,
## descendentes/motores em laranja).

const COLS := 220
const C_SENS := Color(0.35, 0.7, 1.0)
const C_INTER := Color(0.45, 0.9, 0.45)
const C_OUT := Color(1.0, 0.6, 0.2)

var fly: Node   # qualquer criatura com a propriedade `brain` (mosca ou larva)
var _brain: FlyBrain
var _img: Image
var _tex: ImageTexture
var _col := 0
var _kind_colors: Array[Color] = []
var _group_kind := PackedInt32Array()   # 0 sens, 1 inter, 2 saida
var _order := PackedInt32Array()        # grupos exibidos
var _row_of := PackedInt32Array()       # neuronio -> linha do raster
var _rows := 1
var _font: Font


func _ready() -> void:
	_font = get_theme_default_font()
	custom_minimum_size = Vector2(430, 470)
	texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func _process(_dt: float) -> void:
	if not visible or fly == null or not is_instance_valid(fly):
		return
	var b: FlyBrain = fly.get("brain")
	if b == null:
		return
	if b != _brain:
		_setup(b)
	# raster: uma coluna por quadro num buffer circular
	_col = (_col + 1) % COLS
	for y in _img.get_height():
		_img.set_pixel(_col, y, Color(0, 0, 0, 0))
	for i in _brain.spikes_this_frame:
		_img.set_pixel(_col, _row_of[i], _kind_colors[_group_kind[_brain.neuron_group[i]]])
	_tex.update(_img)
	queue_redraw()


func _setup(b: FlyBrain) -> void:
	_brain = b
	_kind_colors = [C_SENS, C_INTER, C_OUT]
	_group_kind.resize(b.group_names.size())
	_group_kind.fill(1)
	for ch: String in b.input_channels:
		if ch.begins_with("explore"):
			continue
		for i in b.input_channels[ch]:
			_group_kind[b.neuron_group[i]] = 0
	for ch: String in b.output_channels:
		for gi in b.output_channels[ch]:
			_group_kind[gi] = 2
	# ordena grupos: sensoriais, inter, saida (no maximo 30 linhas no grafico de barras)
	_order = PackedInt32Array()
	for kind in 3:
		for gi in b.group_names.size():
			if _group_kind[gi] == kind:
				_order.append(gi)
	# linhas do raster: neuronios ordenados por grupo, no maximo 1 px cada
	_row_of.resize(b.n)
	var row := 0
	for gi in _order:
		for i in b.group_members[gi]:
			_row_of[i] = row
			row += 1
	_rows = maxi(row, 1)
	_img = Image.create(COLS, _rows, false, Image.FORMAT_RGBA8)
	_tex = ImageTexture.create_from_image(_img)


func _draw() -> void:
	if _brain == null:
		return
	var w := size.x
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.03, 0.05, 0.04, 0.82))
	draw_string(_font, Vector2(10, 20), "Cerebro: " + _brain.name, HORIZONTAL_ALIGNMENT_LEFT, w - 20, 13, Color(0.9, 1, 0.9))
	draw_string(_font, Vector2(10, 38), "%d neuronios, %d conexoes, t = %.1f s" % [_brain.n, _brain.total_edges, _brain.sim_time_ms / 1000.0], HORIZONTAL_ALIGNMENT_LEFT, w - 20, 12, Color(0.7, 0.8, 0.7))

	# raster
	var r_top := 48.0
	var r_h := 170.0
	draw_rect(Rect2(10, r_top, w - 20, r_h), Color(0, 0, 0, 0.6))
	# desenha o buffer circular em duas partes (mais antigo a esquerda)
	var rw := w - 20
	var split := _col + 1
	var older := COLS - split
	if older > 0:
		draw_texture_rect_region(_tex, Rect2(10, r_top, rw * older / COLS, r_h), Rect2(split, 0, older, _rows))
	draw_texture_rect_region(_tex, Rect2(10 + rw * older / COLS, r_top, rw * split / COLS, r_h), Rect2(0, 0, split, _rows))
	draw_string(_font, Vector2(12, r_top + r_h + 14), "raster de spikes (~%.0f s)" % (COLS / 60.0), HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(0.6, 0.7, 0.6))

	# barras por populacao
	var y0 := r_top + r_h + 26.0
	var rows := mini(_order.size(), 30)
	var rh := minf(15.0, (size.y - y0 - 8.0) / maxf(rows, 1))
	for k in rows:
		var gi := _order[k]
		var y := y0 + k * rh
		var rate := _brain.group_rate[gi]
		var col: Color = [C_SENS, C_INTER, C_OUT][_group_kind[gi]]
		draw_string(_font, Vector2(10, y + rh - 3), _brain.group_names[gi], HORIZONTAL_ALIGNMENT_LEFT, 150, int(rh * 0.78), Color(0.85, 0.9, 0.85))
		var bw := clampf(rate / 150.0, 0.0, 1.0) * (w - 230)
		draw_rect(Rect2(165, y + 2, w - 230, rh - 4), Color(1, 1, 1, 0.06))
		draw_rect(Rect2(165, y + 2, bw, rh - 4), col)
		draw_string(_font, Vector2(w - 60, y + rh - 3), "%3.0f Hz" % rate, HORIZONTAL_ALIGNMENT_LEFT, -1, int(rh * 0.75), Color(0.8, 0.85, 0.8))
