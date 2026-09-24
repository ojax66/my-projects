class_name BrainView
extends Control
## Painel do cerebro: raster de spikes (amostra de neuronios de todas as
## classes) + atividade media de cada classe/populacao (sensoriais em azul,
## interneuronios em verde, descendentes/motores/hormonais em laranja).

const COLS := 220
const KIND_COL := [Color(0.35, 0.7, 1.0), Color(0.45, 0.9, 0.45), Color(1.0, 0.6, 0.2)]

var fly: Node   # qualquer criatura com a propriedade `brain`
var _brain
var _img: Image
var _tex: ImageTexture
var _col := 0
var _rows := 1
var _row_kind := PackedInt32Array()
var _font: Font


func _ready() -> void:
	_font = get_theme_default_font()
	custom_minimum_size = Vector2(400, 440)
	texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func _process(_dt: float) -> void:
	if not visible or fly == null or not is_instance_valid(fly):
		return
	var b = fly.get("brain")
	if b == null:
		return
	if b != _brain:
		_setup(b)
	_col = (_col + 1) % COLS
	for y in _rows:
		_img.set_pixel(_col, y, Color(0, 0, 0, 0))
	for row: int in b.raster_frame:
		if row < _rows:
			_img.set_pixel(_col, row, KIND_COL[_row_kind[row]])
	_tex.update(_img)
	queue_redraw()


func _setup(b) -> void:
	_brain = b
	_rows = maxi(b.raster_row_count(), 1)
	var groups: PackedInt32Array = b.raster_row_groups()
	var kinds: Array = b.display_kinds()
	_row_kind.resize(_rows)
	for i in _rows:
		_row_kind[i] = int(kinds[groups[i]]) if i < groups.size() and groups[i] < kinds.size() else 1
	_img = Image.create(COLS, _rows, false, Image.FORMAT_RGBA8)
	_tex = ImageTexture.create_from_image(_img)


func _draw() -> void:
	if _brain == null:
		return
	var w := size.x
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.03, 0.05, 0.04, 0.82))
	draw_string(_font, Vector2(10, 20), "Cerebro: " + str(_brain.name), HORIZONTAL_ALIGNMENT_LEFT, w - 20, 13, Color(0.9, 1, 0.9))
	draw_string(_font, Vector2(10, 38), "%d neuronios, %d sinapses, t = %.1f s  %s" % [_brain.n, _brain.total_edges, _brain.sim_time_ms / 1000.0, "spikes" if _brain.mode == 0 else "campo medio"], HORIZONTAL_ALIGNMENT_LEFT, w - 20, 12, Color(0.7, 0.8, 0.7))
	var r_top := 48.0
	var r_h := 150.0
	draw_rect(Rect2(10, r_top, w - 20, r_h), Color(0, 0, 0, 0.6))
	var rw := w - 20
	var split := _col + 1
	var older := COLS - split
	if older > 0:
		draw_texture_rect_region(_tex, Rect2(10, r_top, rw * older / COLS, r_h), Rect2(split, 0, older, _rows))
	draw_texture_rect_region(_tex, Rect2(10 + rw * older / COLS, r_top, rw * split / COLS, r_h), Rect2(0, 0, split, _rows))
	draw_string(_font, Vector2(12, r_top + r_h + 14), "raster: %d neuronios amostrados" % _rows, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(0.6, 0.7, 0.6))
	# barras: grupos ordenados por tipo e atividade (no maximo 18)
	var names: Array = _brain.display_names()
	var kinds: Array = _brain.display_kinds()
	var rates: PackedFloat32Array = _brain.display_rates()
	var order := range(names.size())
	order.sort_custom(func(a, b): return (int(kinds[a]) * 1000 - rates[a]) < (int(kinds[b]) * 1000 - rates[b]))
	var y0 := r_top + r_h + 24.0
	var rows := mini(order.size(), 18)
	var rh := minf(14.0, (size.y - y0 - 6.0) / maxf(rows, 1))
	for k in rows:
		var gi: int = order[k]
		var y := y0 + k * rh
		var rate := rates[gi]
		draw_string(_font, Vector2(10, y + rh - 3), str(names[gi]), HORIZONTAL_ALIGNMENT_LEFT, 170, int(rh * 0.78), Color(0.85, 0.9, 0.85))
		var bw := clampf(rate / 100.0, 0.0, 1.0) * (w - 250)
		draw_rect(Rect2(185, y + 2, w - 250, rh - 4), Color(1, 1, 1, 0.06))
		draw_rect(Rect2(185, y + 2, bw, rh - 4), KIND_COL[int(kinds[gi])])
		draw_string(_font, Vector2(w - 60, y + rh - 3), "%4.1f Hz" % rate, HORIZONTAL_ALIGNMENT_LEFT, -1, int(rh * 0.75), Color(0.8, 0.85, 0.8))
