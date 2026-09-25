class_name FlyBrain
extends RefCounted
## Rede de neuronios LIF no estilo do modelo do conectoma FlyWire
## (Shiu et al., Nature 2024):
##   dv/dt = (g − (v − v0)) / τm     dg/dt = −g / τs
## Cada spike pre-sinaptico soma w_syn * (sinapses, com sinal) em g do
## pos-sinaptico. Sensoriais recebem entrada de Poisson.
##
## Dois modos com os MESMOS pesos:
##   SPIKE  LIF com dt = 1 ms (a mosca que voce esta seguindo)
##   RATE   aproximacao de campo medio (curva f-I do proprio LIF), dt = 25 ms,
##          bem mais barata -- usada nas outras moscas
##
## Plasticidade (aprendizado continuo): sinapses KC -> MBON sofrem depressao
## quando a Kenyon cell esteve ativa (traco de elegibilidade) e chega dopamina
## ao MBON pelos dopaminergicos que o inervam no conectoma (PAM = recompensa,
## PPL1 = punicao), e voltam devagar ao valor original (esquecimento).

enum Mode { SPIKE, RATE }

var params := {
	"v_rest": -52.0, "v_reset": -52.0, "v_th": -45.0,
	"tau_m": 20.0, "tau_syn": 5.0, "t_ref": 2.2,
	"w_syn": 0.275, "w_poisson": 8.0, "rate_tau": 80.0, "ref_rate": 60.0,
	"dt": 1.0, "rate_dt": 40.0,
}

var name := ""
var source := ""
var mode := Mode.SPIKE
var n := 0
var v := PackedFloat32Array()
var g := PackedFloat32Array()
var refr := PackedFloat32Array()
var r := PackedFloat32Array()            # taxa por neuronio (Hz), nos dois modos
var adapt := PackedFloat32Array()        # adaptacao de frequencia (modo taxa)
var input_rate := PackedFloat32Array()
var neuron_group := PackedInt32Array()
var neuron_ids := PackedStringArray()
var neuron_types := PackedStringArray()

var out_start := PackedInt32Array()
var out_post := PackedInt32Array()
var out_w := PackedFloat32Array()

var group_names := PackedStringArray()
var group_members: Array[PackedInt32Array] = []
var group_rate := PackedFloat32Array()
var _group_count := PackedInt32Array()

var input_channels: Dictionary = {}
var output_channels: Dictionary = {}

# plasticidade
var plastic_k := PackedInt32Array()       # indices em out_w
var plastic_pre := PackedInt32Array()
var plastic_post := PackedInt32Array()
var plastic_w0 := PackedFloat32Array()
var elig := PackedFloat32Array()          # traco por neuronio
var mbon_da := {}                         # neuronio MBON -> [PackedInt32Array dans, PackedFloat32Array pesos]
var mbon_valence := {}                    # +1: promove aproximacao (inervado por PPL1), -1: evitacao (PAM)
var learning_rate := 0.6
var learning_gain := 1.0                  # modulado por genes/octopamina
var recovery_s := 240.0
var trace_s := 1.5
var _plast_acc := 0.0

var sim_time_ms := 0.0
var spikes_this_frame := PackedInt32Array()
var total_edges := 0
var _acc := 0.0
var _rng := RandomNumberGenerator.new()


static func from_dict(d: Dictionary) -> FlyBrain:
	var b := FlyBrain.new()
	b._load(d)
	return b


static var _json_cache: Dictionary = {}


static func from_json_file(path: String) -> FlyBrain:
	if not _json_cache.has(path):
		var f := FileAccess.open(path, FileAccess.READ)
		if f == null:
			return null
		var d = JSON.parse_string(f.get_as_text())
		if typeof(d) != TYPE_DICTIONARY:
			push_error("Cerebro invalido: " + path)
			return null
		_json_cache[path] = d
	return from_dict(_json_cache[path])


func _load(d: Dictionary) -> void:
	_rng.randomize()
	name = d.get("name", "cerebro")
	source = d.get("source", "")
	var p: Dictionary = d.get("params", {})
	for k: String in p:
		params[k] = float(p[k])

	var neurons: Array = d["neurons"]
	n = neurons.size()
	for arr in [v, g, refr, r, input_rate, elig, adapt]:
		arr.resize(n)
	neuron_group.resize(n)
	var group_index := {}
	for i in n:
		var nd: Dictionary = neurons[i]
		neuron_ids.append(str(nd.get("id", i)))
		neuron_types.append(str(nd.get("type", "")))
		var gname: String = str(nd.get("group", nd.get("type", "?")))
		if not group_index.has(gname):
			group_index[gname] = group_names.size()
			group_names.append(gname)
			group_members.append(PackedInt32Array())
		var gi: int = group_index[gname]
		neuron_group[i] = gi
		group_members[gi].append(i)
		v[i] = params["v_rest"] + _rng.randf() * 4.0
	group_rate.resize(group_names.size())
	_group_count.resize(group_names.size())

	var edges: Array = d["edges"]
	total_edges = edges.size()
	var counts := PackedInt32Array()
	counts.resize(n + 1)
	for e: Array in edges:
		counts[int(e[0]) + 1] += 1
	for i in n:
		counts[i + 1] += counts[i]
	out_start = counts.duplicate()
	out_post.resize(edges.size())
	out_w.resize(edges.size())
	var fill := counts.duplicate()
	var w_syn: float = params["w_syn"]
	for e: Array in edges:
		var pre := int(e[0])
		var k := fill[pre]
		out_post[k] = int(e[1])
		out_w[k] = float(e[2]) * w_syn
		fill[pre] += 1

	var ch: Dictionary = d.get("channels", {})
	for cname: String in ch.get("inputs", {}):
		var ids := PackedInt32Array()
		for gname: String in ch["inputs"][cname]:
			if group_index.has(gname):
				ids.append_array(group_members[group_index[gname]])
		input_channels[cname] = ids
	for cname: String in ch.get("outputs", {}):
		var gids := PackedInt32Array()
		for gname: String in ch["outputs"][cname]:
			if group_index.has(gname):
				gids.append(group_index[gname])
		output_channels[cname] = gids
	_setup_plasticity(d.get("plasticity", {}))


func _setup_plasticity(spec: Dictionary) -> void:
	if not spec.has("pre"):
		return
	var re_pre := RegEx.create_from_string(spec["pre"])
	var re_post := RegEx.create_from_string(spec["post"])
	var re_dan := RegEx.create_from_string(spec.get("dan", "^(PAM|PPL1)"))
	var re_pun := RegEx.create_from_string(spec.get("punish_dan", "^PPL1"))
	learning_rate = float(spec.get("rate", 0.6))
	recovery_s = float(spec.get("recovery_s", 240.0))
	trace_s = float(spec.get("trace_s", 1.5))
	var is_pre := PackedByteArray()
	var is_post := PackedByteArray()
	var is_dan := PackedByteArray()
	var is_pun := PackedByteArray()
	for arr in [is_pre, is_post, is_dan, is_pun]:
		arr.resize(n)
	for i in n:
		var t := neuron_types[i]
		is_pre[i] = 1 if re_pre.search(t) else 0
		is_post[i] = 1 if re_post.search(t) else 0
		is_dan[i] = 1 if re_dan.search(t) else 0
		is_pun[i] = 1 if re_pun.search(t) else 0
	var dan_in := {}   # mbon -> {dan: peso}
	for pre in n:
		for k in range(out_start[pre], out_start[pre + 1]):
			var post := out_post[k]
			if is_pre[pre] and is_post[post] and out_w[k] > 0.0:
				plastic_k.append(k)
				plastic_pre.append(pre)
				plastic_post.append(post)
				plastic_w0.append(out_w[k])
			if is_dan[pre] and is_post[post]:
				if not dan_in.has(post):
					dan_in[post] = {}
				dan_in[post][pre] = absf(out_w[k])
	# dopamina que chega em cada MBON (sinapses DAN->MBON reais) e valencia
	for m in dan_in:
		var ids := PackedInt32Array()
		var ws := PackedFloat32Array()
		var pun := 0.0
		var tot := 0.0
		for d in dan_in[m]:
			ids.append(d)
			ws.append(dan_in[m][d])
			tot += dan_in[m][d]
			if is_pun[d]:
				pun += dan_in[m][d]
		mbon_da[m] = [ids, ws, tot]
		mbon_valence[m] = 1.0 if pun > tot * 0.5 else -1.0


# ---------------------------------------------------------------- API
var focused := false   # compatibilidade com GpuBrain


## Subcircuito em GDScript: a fiacao individual so existe no conectoma da GPU.
func set_wiring(_a: int, _b: int, _c: int, _amount: float) -> void:
	pass


func set_input(channel: String, rate_hz: float) -> void:
	var ids: PackedInt32Array = input_channels.get(channel, PackedInt32Array())
	for i in ids:
		input_rate[i] = rate_hz


func has_channel(channel: String) -> bool:
	return input_channels.has(channel) and not (input_channels[channel] as PackedInt32Array).is_empty()


func has_output(channel: String) -> bool:
	return output_channels.has(channel) and not (output_channels[channel] as PackedInt32Array).is_empty()


func output(channel: String) -> float:
	var gids: PackedInt32Array = output_channels.get(channel, PackedInt32Array())
	if gids.is_empty():
		return 0.0
	var s := 0.0
	for gi in gids:
		s += group_rate[gi]
	return s / gids.size() / params["ref_rate"]


func output_rate_hz(channel: String) -> float:
	return output(channel) * params["ref_rate"]


func group_rate_by_name(gname: String) -> float:
	var i := group_names.find(gname)
	return group_rate[i] if i >= 0 else 0.0


func set_mode(m: Mode) -> void:
	if m == mode:
		return
	mode = m
	if m == Mode.SPIKE:
		for i in n:
			g[i] = 0.0
			v[i] = params["v_rest"]
	_acc = 0.0


## Pesos plasticos atuais relativos ao original (1.0 = inalterado). E isso que
## pode ser herdado pelos filhotes.
func get_memory() -> PackedFloat32Array:
	var m := PackedFloat32Array()
	m.resize(plastic_k.size())
	for j in plastic_k.size():
		m[j] = out_w[plastic_k[j]] / plastic_w0[j]
	return m


func set_memory(m: PackedFloat32Array, amount := 1.0) -> void:
	if m.size() != plastic_k.size():
		return
	for j in plastic_k.size():
		out_w[plastic_k[j]] = plastic_w0[j] * lerpf(1.0, m[j], amount)


## Valencia aprendida do que a mosca sente agora: quanto as sinapses KC->MBON
## das Kenyon cells ativas foram alteradas, com o sinal do MBON.
## > 0 = associado a recompensa, < 0 = associado a punicao.
func learned_valence() -> float:
	var num := 0.0
	var den := 0.0
	for j in plastic_k.size():
		var e := elig[plastic_pre[j]]
		if e < 0.05:
			continue
		var dw := out_w[plastic_k[j]] / plastic_w0[j] - 1.0
		num += float(mbon_valence.get(plastic_post[j], 0.0)) * dw * e
		den += e
	return clampf(num / maxf(den, 1e-3) * 4.0, -1.0, 1.0) if den > 0.0 else 0.0


## Quanto a memoria foi alterada no total (0 = nada aprendido).
func memory_strength() -> float:
	var s := 0.0
	for j in plastic_k.size():
		s += absf(out_w[plastic_k[j]] / plastic_w0[j] - 1.0)
	return s / maxf(plastic_k.size(), 1)


# ---------------------------------------------------------------- painel (mesma API do GpuBrain)
var raster_frame := PackedInt32Array()
var _disp_kinds := []
var _row_groups := PackedInt32Array()


func display_names() -> Array:
	return Array(group_names)


func display_kinds() -> Array:
	if _disp_kinds.size() != group_names.size():
		_disp_kinds = []
		_disp_kinds.resize(group_names.size())
		_disp_kinds.fill(1)
		for ch: String in input_channels:
			if ch.begins_with("explore"):
				continue
			for i in input_channels[ch]:
				_disp_kinds[neuron_group[i]] = 0
		for ch: String in output_channels:
			for gi in output_channels[ch]:
				_disp_kinds[gi] = 2
	return _disp_kinds


func display_rates() -> PackedFloat32Array:
	return group_rate


func raster_row_count() -> int:
	return n


func raster_row_groups() -> PackedInt32Array:
	if _row_groups.size() != n:
		_row_groups = neuron_group.duplicate()
	return _row_groups


# ---------------------------------------------------------------- simulacao
func advance(dt_s: float, max_steps := 80) -> void:
	spikes_this_frame.clear()
	_acc += dt_s * 1000.0
	var steps := 0
	if mode == Mode.SPIKE:
		var dt: float = params["dt"]
		while _acc >= dt and steps < max_steps:
			_step_spike(dt)
			_acc -= dt
			steps += 1
	else:
		var dt: float = params["rate_dt"]
		while _acc >= dt and steps < 8:
			_step_rate(dt)
			_acc -= dt
			steps += 1
	if steps >= max_steps:
		_acc = 0.0
	_plast_acc += dt_s
	if _plast_acc >= 0.05:
		_plasticity(_plast_acc)
		_plast_acc = 0.0


func _step_spike(dt: float) -> void:
	var v_rest: float = params["v_rest"]
	var v_reset: float = params["v_reset"]
	var v_th: float = params["v_th"]
	var k_m: float = dt / params["tau_m"]
	var decay_syn: float = exp(-dt / params["tau_syn"])
	var w_poisson: float = params["w_poisson"]
	var p_scale := dt / 1000.0
	var a_r := exp(-dt / 100.0)
	var inc := (1.0 - a_r) * 1000.0 / dt
	var a_e := exp(-dt / (trace_s * 1000.0))
	var fired := PackedInt32Array()
	_group_count.fill(0)
	var gg := g
	var vv := v
	var rf := refr
	var rr := r
	var el := elig
	var inp := input_rate
	var ng := neuron_group
	var t_ref: float = params["t_ref"]
	for i in n:
		var gi := gg[i] * decay_syn
		gg[i] = gi
		rr[i] *= a_r
		el[i] *= a_e
		if rf[i] > 0.0:
			rf[i] -= dt
			continue
		var vi := vv[i]
		var ir := inp[i]
		if ir > 0.0 and _rng.randf() < ir * p_scale:
			vi += w_poisson
		vi += (gi - (vi - v_rest)) * k_m
		if vi >= v_th:
			vi = v_reset
			rf[i] = t_ref
			fired.append(i)
			_group_count[ng[i]] += 1
			rr[i] += inc
			el[i] = minf(el[i] + 0.15, 1.0)
		vv[i] = vi
	var os := out_start
	var op := out_post
	var ow := out_w
	for pre in fired:
		for k in range(os[pre], os[pre + 1]):
			gg[op[k]] += ow[k]
	g = gg
	v = vv
	refr = rf
	r = rr
	elig = el
	spikes_this_frame.append_array(fired)
	raster_frame = spikes_this_frame
	var a := exp(-dt / params["rate_tau"])
	for gi in group_rate.size():
		var inst := _group_count[gi] * 1000.0 / dt / group_members[gi].size()
		group_rate[gi] = group_rate[gi] * a + inst * (1.0 - a)
	sim_time_ms += dt


## Campo medio: corrente media g = Σ W r τs; taxa pela curva f-I do LIF.
func _step_rate(dt: float) -> void:
	var tau_s: float = params["tau_syn"] / 1000.0
	var th: float = params["v_th"] - params["v_rest"]
	var tau_m: float = params["tau_m"] / 1000.0
	var t_ref: float = params["t_ref"] / 1000.0
	var os := out_start
	var op := out_post
	var ow := out_w
	var rr := r
	var ad := adapt
	var el := elig
	var inp := input_rate
	var I := PackedFloat32Array()
	I.resize(n)
	for pre in n:
		var rp := rr[pre]
		if rp < 0.5:
			continue
		var s := rp * tau_s
		for k in range(os[pre], os[pre + 1]):
			I[op[k]] += ow[k] * s
	var a := dt / (dt + 30.0)
	var a_ad := minf(1.0, dt / 400.0)
	var a_e := exp(-dt / (trace_s * 1000.0))
	var gsum := PackedFloat32Array()
	gsum.resize(group_names.size())
	var ng := neuron_group
	for i in n:
		# adaptacao (corrente de K+ dependente de Ca2+): evita que lacos
		# excitatorios fiquem travados em saturacao
		var ri := rr[i]
		ad[i] += (ri - ad[i]) * a_ad
		var x := I[i] - 0.06 * ad[i] - 0.3 * maxf(0.0, ad[i] - 100.0)
		var target := 0.0
		if x > th:
			target = 1.0 / (t_ref + tau_m * log(x / (x - th)))
		var ir := inp[i]
		if ir > 0.0:
			target += ir * clampf((x + th) / th, 0.0, 1.0)
		ri += (minf(target, 200.0) - ri) * a
		rr[i] = ri
		el[i] = maxf(el[i] * a_e, clampf((ri - 5.0) / 40.0, 0.0, 1.0))
		gsum[ng[i]] += ri
	r = rr
	adapt = ad
	elig = el
	var ag := minf(1.0, dt / params["rate_tau"])
	for gi in group_rate.size():
		group_rate[gi] += (gsum[gi] / group_members[gi].size() - group_rate[gi]) * ag
	sim_time_ms += dt


var _da_base := {}   # linha de base lenta da dopamina em cada MBON


## Regra de tres fatores com dopamina FASICA: so os picos acima da linha de
## base lenta (τ ~20 s) de cada MBON ensinam; a atividade tonica nao.
func _plasticity(dt: float) -> void:
	if plastic_k.is_empty():
		return
	var da_now := {}
	for m in mbon_da:
		var info: Array = mbon_da[m]
		var ids: PackedInt32Array = info[0]
		var ws: PackedFloat32Array = info[1]
		var da := 0.0
		for q in ids.size():
			# so os DANs que estao recebendo o estimulo incondicionado agora
			# (acucar ingerido, amargo, susto) ensinam
			if input_rate[ids[q]] > 0.0:
				da += ws[q] * r[ids[q]]
		da = da / float(info[2]) / 40.0
		var base: float = _da_base.get(m, 0.0)
		base += (minf(da, base + 0.5) - base) * minf(1.0, dt / 20.0)
		_da_base[m] = base
		da_now[m] = maxf(0.0, da - base - 0.25)
	var eta := learning_rate * learning_gain * dt
	var rec := dt / recovery_s
	for j in plastic_k.size():
		var k := plastic_k[j]
		var w0 := plastic_w0[j]
		var w := out_w[k]
		var e := elig[plastic_pre[j]]
		if e > 0.02:
			var da: float = da_now.get(plastic_post[j], 0.0)
			if da > 0.0:
				w -= eta * da * e * w
		w += (w0 - w) * rec
		out_w[k] = clampf(w, w0 * 0.05, w0 * 1.5)
