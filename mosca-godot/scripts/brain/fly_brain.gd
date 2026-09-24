class_name FlyBrain
extends RefCounted
## Rede de neuronios leaky integrate-and-fire (LIF) no estilo do modelo de
## conectoma inteiro do FlyWire (Shiu et al., Nature 2024):
##   dv/dt = (g − (v − v0)) / τm     dg/dt = −g / τs
## Cada spike pre-sinaptico soma w_syn * (n. de sinapses, com sinal pelo
## neurotransmissor) em g do pos-sinaptico. Neuronios sensoriais recebem
## entrada de Poisson proporcional ao estimulo.
##
## O formato do cerebro (JSON) e o mesmo para o circuito padrao
## (DefaultCircuit) e para subcircuitos extraidos do conectoma real com
## tools/extract_connectome.py (Codex FlyWire / MCNS).

var params := {
	"v_rest": -52.0, "v_reset": -52.0, "v_th": -45.0,
	"tau_m": 20.0, "tau_syn": 5.0, "t_ref": 2.2,
	"w_syn": 0.275, "w_poisson": 8.0, "rate_tau": 80.0, "ref_rate": 60.0,
	"dt": 1.0,
}

var name := ""
var source := ""
var n := 0
var v := PackedFloat32Array()
var g := PackedFloat32Array()
var refr := PackedFloat32Array()
var input_rate := PackedFloat32Array()   # Hz de Poisson por neuronio
var neuron_group := PackedInt32Array()
var neuron_ids := PackedStringArray()
var neuron_types := PackedStringArray()

# conexoes em CSR
var out_start := PackedInt32Array()
var out_post := PackedInt32Array()
var out_w := PackedFloat32Array()

var group_names := PackedStringArray()
var group_members: Array[PackedInt32Array] = []
var group_rate := PackedFloat32Array()   # Hz filtrado
var _group_count := PackedInt32Array()

var input_channels: Dictionary = {}   # canal -> PackedInt32Array de neuronios
var output_channels: Dictionary = {}  # canal -> PackedInt32Array de grupos

var sim_time_ms := 0.0
var spikes_this_frame := PackedInt32Array()
var total_edges := 0
var _acc := 0.0
var _rng := RandomNumberGenerator.new()


static func from_dict(d: Dictionary) -> FlyBrain:
	var b := FlyBrain.new()
	b._load(d)
	return b


static func from_json_file(path: String) -> FlyBrain:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return null
	var d = JSON.parse_string(f.get_as_text())
	if typeof(d) != TYPE_DICTIONARY:
		push_error("Cerebro invalido: " + path)
		return null
	return from_dict(d)


func _load(d: Dictionary) -> void:
	_rng.randomize()
	name = d.get("name", "cerebro")
	source = d.get("source", "")
	var p: Dictionary = d.get("params", {})
	for k: String in p:
		params[k] = float(p[k])

	var neurons: Array = d["neurons"]
	n = neurons.size()
	v.resize(n); g.resize(n); refr.resize(n); input_rate.resize(n); neuron_group.resize(n)
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

	# arestas: [pre, pos, sinapses_com_sinal]
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


## Taxa (Hz) de entrada de Poisson para todos os neuronios de um canal.
func set_input(channel: String, rate_hz: float) -> void:
	var ids: PackedInt32Array = input_channels.get(channel, PackedInt32Array())
	for i in ids:
		input_rate[i] = rate_hz


## Atividade de um canal de saida normalizada (~0..1+) pela taxa de referencia.
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


## Avanca a simulacao por dt_s segundos (tempo de jogo). Limita o custo por
## quadro: se o cerebro for grande demais ele roda mais devagar que o tempo real.
func advance(dt_s: float, max_steps := 80) -> void:
	spikes_this_frame.clear()
	_acc += dt_s * 1000.0
	var dt: float = params["dt"]
	var steps := 0
	while _acc >= dt and steps < max_steps:
		_step(dt)
		_acc -= dt
		steps += 1
	if steps >= max_steps:
		_acc = 0.0


func _step(dt: float) -> void:
	var v_rest: float = params["v_rest"]
	var v_reset: float = params["v_reset"]
	var v_th: float = params["v_th"]
	var k_m: float = dt / params["tau_m"]
	var decay_syn: float = exp(-dt / params["tau_syn"])
	var w_poisson: float = params["w_poisson"]
	var p_scale := dt / 1000.0
	var fired := PackedInt32Array()
	_group_count.fill(0)
	for i in n:
		g[i] *= decay_syn
		if refr[i] > 0.0:
			refr[i] -= dt
			continue
		var vi := v[i]
		var r := input_rate[i]
		if r > 0.0 and _rng.randf() < r * p_scale:
			vi += w_poisson
		vi += (g[i] - (vi - v_rest)) * k_m
		if vi >= v_th:
			vi = v_reset
			refr[i] = params["t_ref"]
			fired.append(i)
			_group_count[neuron_group[i]] += 1
		v[i] = vi
	for pre in fired:
		for k in range(out_start[pre], out_start[pre + 1]):
			g[out_post[k]] += out_w[k]
	spikes_this_frame.append_array(fired)
	var a := exp(-dt / params["rate_tau"])
	for gi in group_rate.size():
		var inst := _group_count[gi] * 1000.0 / dt / group_members[gi].size()
		group_rate[gi] = group_rate[gi] * a + inst * (1.0 - a)
	sim_time_ms += dt
