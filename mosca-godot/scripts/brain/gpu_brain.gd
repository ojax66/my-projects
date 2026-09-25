class_name GpuBrain
extends RefCounted
## Cerebro de UMA criatura sobre o conectoma completo na GPU. Tem a mesma API
## usada pelo resto do jogo que o FlyBrain (set_input, output, get_memory...).

enum Mode { SPIKE, RATE }

var name := ""
var source := ""
var n := 0
var total_edges := 0
var mode := Mode.RATE
var learning_gain := 1.0
var learning_rate := 0.25
var recovery_s := 240.0
var params := {"ref_rate": 35.0, "w_syn": 0.275}

var _eng: BrainEngine
var _ds: Dictionary
var _chan_index := {}
var _out_index := {}
var _chan_rate := PackedFloat32Array()
var _chan_dirty := true
var _bufs := {}
var _sets := {}
var _pending := 0.0
var _plast_acc := 0.0
var _step := 0
var _steps_this := 0
var _dt_this := 0.0
var _did_plast := false
var _out_rate := PackedFloat32Array()
var _disp_rate := PackedFloat32Array()
var _valence := 0.0
var _memory := 0.0
var raster_frame := PackedInt32Array()
var raster_enabled := false
var sim_time_ms := 0.0
var alive := true
## cerebro da criatura seguida pela camera: roda todo quadro, com prioridade
var focused := false
## conectoma unico: sementes da fiacao (mae, pai, propria) e amplitude
var seed_a := 1
var seed_b := 1
var seed_c := 1
var wvar := 0.0


static func create(tag: String) -> GpuBrain:
	var eng := BrainEngine.instance
	if eng == null or not eng.available or not eng.has_dataset(tag):
		return null
	eng.flush()   # nao criar buffers com um lote da GPU em voo
	var b := GpuBrain.new()
	b._init_on(eng, eng.dataset(tag))
	return b


func _init_on(eng: BrainEngine, ds: Dictionary) -> void:
	_eng = eng
	_ds = ds
	var meta: Dictionary = ds["meta"]
	name = meta["name"]
	source = "GPU: " + str(meta["tag"])
	n = ds["N"]
	total_edges = int(ds["E"]) + int(ds["P"])
	for k: String in meta["params"]:
		params[k] = float(meta["params"][k])
	var chans: Array = meta["channels"]
	for i in chans.size():
		_chan_index[chans[i]] = i
	var outs: Array = meta["outputs"]
	for i in outs.size():
		_out_index[outs[i]] = i
	_chan_rate.resize(maxi(chans.size(), 1))
	_out_rate.resize(outs.size())
	_disp_rate.resize(ds["n_disp"])
	var rd := eng.rd
	var N: int = n
	if not ds.has("init"):
		# estados iniciais (repouso) calculados uma vez por especie
		var v0 := PackedFloat32Array()
		v0.resize(N)
		var rng := RandomNumberGenerator.new()
		rng.seed = 12345
		for i in N:
			v0[i] = -52.0 + rng.randf() * 4.0
		var zeros := PackedByteArray()
		zeros.resize(N * 4)
		var spk0 := PackedByteArray()
		spk0.resize((N + 1) * 4)
		var acc0 := PackedByteArray()
		acc0.resize((int(ds["n_out"]) + int(ds["n_disp"]) + 4) * 4)
		var ras0 := PackedByteArray()
		ras0.resize(maxi(int(ds["rows"]), 1) * 4)
		var pw0: PackedFloat32Array = ds["pw0"]
		var daf := PackedFloat32Array()
		daf.resize(N * 4)
		for i in N:
			daf[i * 4 + 3] = 1.0   # depressao sinaptica: recursos cheios
		ds["init"] = {"v": v0.to_byte_array(), "zeros": zeros, "spk": spk0, "acc": acc0, "ras": ras0,
			"pw": pw0.to_byte_array() if not pw0.is_empty() else PackedByteArray([0, 0, 0, 0]), "da": daf.to_byte_array()}
	var init: Dictionary = ds["init"]
	var zeros: PackedByteArray = init["zeros"]
	var v0b: PackedByteArray = init["v"]
	var spk: PackedByteArray = init["spk"]
	var acc: PackedByteArray = init["acc"]
	var ras: PackedByteArray = init["ras"]
	var pwb: PackedByteArray = init["pw"]
	var dab: PackedByteArray = init["da"]
	var list := [
		["v", v0b], ["gi", zeros], ["refr", zeros], ["r", zeros], ["elig", zeros], ["adapt", zeros],
		["spk", spk], ["chan", _chan_rate.to_byte_array()], ["acc", acc], ["raster", ras], ["pw", pwb], ["da", dab]]
	var uniforms := []
	for bi in list.size():
		var item: Array = list[bi]
		var bytes: PackedByteArray = item[1]
		var rid := rd.storage_buffer_create(bytes.size(), bytes)
		_bufs[item[0]] = rid
		var u := RDUniform.new()
		u.uniform_type = RenderingDevice.UNIFORM_TYPE_STORAGE_BUFFER
		u.binding = bi
		u.add_id(rid)
		uniforms.append(u)
	for k: String in BrainEngine.KERNELS:
		_sets[k] = rd.uniform_set_create(uniforms, eng.pipelines[k]["shader"], 1)
	eng.register(self)


func free_gpu() -> void:
	if not alive:
		return
	alive = false
	_eng.unregister(self)
	if _eng.rd == null:
		return
	var rids: Array = []
	for k in _sets:
		if _eng.rd.uniform_set_is_valid(_sets[k]):
			rids.append(_sets[k])
	for k in _bufs:
		rids.append(_bufs[k])
	_eng.free_later(rids)


## Define a fiacao individual (ver wmul() em brain_common.glsl).
func set_wiring(a: int, b: int, c: int, amount: float) -> void:
	seed_a = a
	seed_b = b
	seed_c = c
	wvar = amount


# ---------------------------------------------------------------- API
func set_input(channel: String, rate_hz: float) -> void:
	var i: int = _chan_index.get(channel, -1)
	if i >= 0 and _chan_rate[i] != rate_hz:
		_chan_rate[i] = rate_hz
		_chan_dirty = true


func has_channel(channel: String) -> bool:
	return _chan_index.has(channel)


func channel_names() -> Array:
	return _ds["meta"]["channels"]


func has_output(channel: String) -> bool:
	return _out_index.has(channel)


func output(channel: String) -> float:
	# canais laterais agregados (ex.: "forward" = media de _L e _R)
	var i: int = _out_index.get(channel, -1)
	if i < 0:
		return 0.0
	return _out_rate[i] / params["ref_rate"]


func output_rate_hz(channel: String) -> float:
	var i: int = _out_index.get(channel, -1)
	return _out_rate[i] if i >= 0 else 0.0


func set_mode(m: int) -> void:
	if m == mode:
		return
	mode = m
	_eng.flush()
	_eng.rd.buffer_clear(_bufs["gi"], 0, n * 4)
	raster_enabled = m == Mode.SPIKE


func advance(dt_s: float, _max_steps := 80) -> void:
	_pending += dt_s * 1000.0


func learned_valence() -> float:
	return _valence


func memory_strength() -> float:
	return _memory


func get_memory() -> PackedFloat32Array:
	_eng.flush()
	var w := _eng.rd.buffer_get_data(_bufs["pw"]).to_float32_array()
	var w0: PackedFloat32Array = _ds["pw0"]
	for i in w.size():
		w[i] = w[i] / w0[i] if w0[i] != 0.0 else 1.0
	return w


func set_memory(m: PackedFloat32Array, amount := 1.0) -> void:
	var w0: PackedFloat32Array = _ds["pw0"]
	if m.size() != w0.size() or m.is_empty():
		return
	_eng.flush()
	var w := PackedFloat32Array()
	w.resize(w0.size())
	for i in w.size():
		w[i] = w0[i] * lerpf(1.0, m[i], amount)
	_eng.rd.buffer_update(_bufs["pw"], 0, w.size() * 4, w.to_byte_array())


# painel
func display_names() -> Array:
	return _ds["meta"]["display"]


func display_kinds() -> Array:
	return _ds["meta"]["display_kind"]


func display_rates() -> PackedFloat32Array:
	return _disp_rate


func raster_row_count() -> int:
	return _ds["rows"]


func raster_row_groups() -> PackedInt32Array:
	return _ds["row_disp"]


# ---------------------------------------------------------------- GPU
func wants_step() -> bool:
	# a criatura seguida roda todo quadro; as demais em lotes de >= 50 ms
	if focused:
		return _pending >= (1.0 if mode == Mode.SPIKE else 12.0)
	return _pending >= 50.0


func priority_score() -> float:
	return 1e9 if focused else _pending


## Custo aproximado (sinapses tocadas) do proximo passo.
func step_cost() -> float:
	if mode == Mode.SPIKE:
		return clampf(_pending, 1.0, 20.0) * (n * 3.0 + total_edges * 0.03)
	return float(total_edges + n * 3)


## Ficou sem vez neste quadro (orcamento esgotado): nao acumula atraso infinito.
func starve() -> void:
	_pending = minf(_pending, 300.0)


func before_submit() -> void:
	var rd := _eng.rd
	if _chan_dirty:
		rd.buffer_update(_bufs["chan"], 0, _chan_rate.size() * 4, _chan_rate.to_byte_array())
		_chan_dirty = false
	rd.buffer_clear(_bufs["acc"], 0, (int(_ds["n_out"]) + int(_ds["n_disp"]) + 4) * 4)
	if raster_enabled:
		rd.buffer_clear(_bufs["raster"], 0, maxi(int(_ds["rows"]), 1) * 4)


func _push(dt: float, learn := 0.0, rec := 0.0) -> PackedByteArray:
	var p := PackedByteArray()
	p.resize(48)
	p.encode_u32(0, n)
	p.encode_u32(4, _step)
	p.encode_u32(8, int(_ds["n_out"]))
	p.encode_u32(12, int(_ds["n_disp"]))
	p.encode_float(16, dt)
	p.encode_float(20, float(params["w_syn"]))
	p.encode_float(24, learn)
	p.encode_float(28, rec)
	p.encode_u32(32, seed_a & 0xFFFFFFFF)
	p.encode_u32(36, seed_b & 0xFFFFFFFF)
	p.encode_u32(40, seed_c & 0xFFFFFFFF)
	p.encode_float(44, wvar)
	return p


func record(cl: int) -> void:
	var groups := ceili(float(n) / BrainEngine.WG)
	if mode == Mode.SPIKE:
		_steps_this = clampi(int(_pending), 1, 20)
		_dt_this = float(_steps_this)
		_pending = maxf(0.0, _pending - _steps_this)
		if _pending > 40.0:
			_pending = 0.0
		for s in _steps_this:
			_step += 1
			var pu := _push(1.0)
			_eng.dispatch(cl, "spike_integrate", _ds, _sets["spike_integrate"], groups, pu)
			_eng.dispatch(cl, "spike_propagate", _ds, _sets["spike_propagate"], mini(groups, 256), pu)
			_eng.dispatch(cl, "reset", _ds, _sets["reset"], 1, pu)
	else:
		_dt_this = minf(_pending, 120.0)
		_pending -= _dt_this
		if _pending > 240.0:
			_pending = 0.0
		_steps_this = 1
		_step += 1
		var pu := _push(_dt_this)
		_eng.dispatch(cl, "rate_push", _ds, _sets["rate_push"], groups, pu)
		_eng.dispatch(cl, "rate_integrate", _ds, _sets["rate_integrate"], groups, pu)
	sim_time_ms += _dt_this
	_plast_acc += _dt_this
	_did_plast = false
	if _plast_acc >= 50.0 and int(_ds["P"]) > 0:
		var dts := _plast_acc / 1000.0
		var pu2 := _push(_plast_acc, learning_rate * learning_gain * dts, dts / recovery_s)
		_eng.dispatch(cl, "dopamine", _ds, _sets["dopamine"], groups, pu2)
		_eng.dispatch(cl, "plasticity", _ds, _sets["plasticity"], groups, pu2)
		_plast_acc = 0.0
		_did_plast = true


func after_sync() -> void:
	var rd := _eng.rd
	var acc := rd.buffer_get_data(_bufs["acc"]).to_int32_array()
	var n_out: int = _ds["n_out"]
	var n_disp: int = _ds["n_disp"]
	var outc: PackedInt32Array = _ds["out_count"]
	var dispc: PackedInt32Array = _ds["disp_count"]
	var a := 1.0 - exp(-_dt_this / 80.0)
	for i in n_out:
		var inst := _inst_rate(acc[i], outc[i])
		_out_rate[i] += (inst - _out_rate[i]) * (a if mode == Mode.SPIKE else 1.0)
	for i in n_disp:
		var inst := _inst_rate(acc[n_out + i], dispc[i])
		_disp_rate[i] += (inst - _disp_rate[i]) * (a if mode == Mode.SPIKE else 1.0)
	if _did_plast:
		var base := n_out + n_disp
		var den := acc[base + 1] / 1000.0
		_valence = clampf(acc[base] / 1000.0 / maxf(den, 1e-3) * 4.0, -1.0, 1.0) if den > 0.0 else 0.0
		_memory = acc[base + 2] / 1000.0 / maxf(float(_ds["P"]), 1.0)
	if raster_enabled:
		var ras := rd.buffer_get_data(_bufs["raster"]).to_int32_array()
		raster_frame = PackedInt32Array()
		for i in ras.size():
			if ras[i] != 0:
				raster_frame.append(i)
	else:
		raster_frame = PackedInt32Array()


func _inst_rate(v: int, members: int) -> float:
	if members <= 0:
		return 0.0
	if mode == Mode.SPIKE:
		return v * 1000.0 / _dt_this / members
	return v / 10.0 / members
