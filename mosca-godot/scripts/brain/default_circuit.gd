class_name DefaultCircuit
extends RefCounted
## Circuito sensorio-motor padrao (~230 neuronios), usado quando nenhum
## subcircuito do conectoma real foi extraido para brain/connectome.json.
##
## As POPULACOES usam nomes de tipos celulares reais da Drosophila e seguem as
## vias descritas na literatura (FlyWire / MANC / MCNS), mas os PESOS aqui sao
## escolhidos a mao — nao sao contagens reais de sinapses. Para usar o
## conectoma de verdade veja tools/extract_connectome.py.
##
## Vias:
##   olfato:   ORN Or42b (DM1) -> PN DM1 -> LHN -> DNa02 (virar) / DNp09 (andar)
##   paladar:  GRN Gr5a (acucar, tarsos) -> G2N/Rattle -> MN9 (probocide) + Fdg (parar)
##   amargo:   GRN Gr66a -> MDN (andar pra tras, "moonwalker") + inibe alimentacao
##   visao:    LPLC2 (looming) -> DNp01 (Giant Fiber) -> fuga / decolagem
##   mecano:   JO-CE (orgao de Johnston) -> aDN (limpeza das antenas)
##   estado:   neuronios de fome (ISN/DH44) facilitam alimentacao e atracao ao odor

var _neurons: Array = []
var _edges: Array = []
var _groups: Dictionary = {}
var _rng := RandomNumberGenerator.new()


static func build() -> Dictionary:
	var c := DefaultCircuit.new()
	return c._build()


func _group(gname: String, size: int, cell_type: String) -> void:
	var ids := []
	for i in size:
		ids.append(_neurons.size())
		_neurons.append({"id": "%s_%d" % [gname, i], "type": cell_type, "group": gname})
	_groups[gname] = ids


## Conecta todos-com-todos com `syn` sinapses (negativo = inibitorio), com
## variacao aleatoria de ±30% e probabilidade `p`. O sorteio e espelhado entre
## os lados (L->X usa a mesma sequencia que R->X') para o circuito ser simetrico.
func _conn(pre: String, post: String, syn: float, p := 1.0) -> void:
	var key := pre + ">" + post
	if pre.ends_with("_R") or (not pre.ends_with("_L") and post.ends_with("_R")):
		key = key.replace("_R", "_T").replace("_L", "_R").replace("_T", "_L")
	_rng.seed = hash(key)
	for a: int in _groups[pre]:
		for b: int in _groups[post]:
			if a == b or _rng.randf() > p:
				continue
			var s := syn * _rng.randf_range(0.7, 1.3)
			_edges.append([a, b, snappedf(s, 0.01)])


func _build() -> Dictionary:
	_rng.seed = 42
	# --- sensoriais
	for s in ["L", "R"]:
		_group("ORN_Or42b_" + s, 20, "ORN_DM1 (Or42b)")
		_group("GRN_Gr5a_" + s, 10, "GRN acucar (Gr5a/Gr64f)")
		_group("GRN_Gr66a_" + s, 8, "GRN amargo (Gr66a)")
		_group("LPLC2_" + s, 10, "LPLC2")
	_group("JO_CE", 10, "JO-CE")
	_group("Fome_ISN", 4, "ISN / DH44 (fome)")
	# --- interneuronios
	_group("iLN", 6, "iLN (GABA)")
	for s in ["L", "R"]:
		_group("PN_DM1_" + s, 4, "DM1 lPN")
		_group("LHN_" + s, 4, "LHN (AV1)")
	_group("G2N_Rattle", 6, "G2N / Rattle")
	_group("Fdg", 2, "Fdg (feeding)")
	_group("BitterIN", 4, "interneuronio amargo (GABA)")
	# --- descendentes / motores
	for s in ["L", "R"]:
		_group("DNa02_" + s, 2, "DNa02")
		_group("DNp09_" + s, 2, "DNp09")
		_group("MDN_" + s, 2, "MDN (moonwalker)")
		_group("DNp01_GF_" + s, 1, "DNp01 (Giant Fiber)")
		_group("aDN_" + s, 2, "aDN (grooming)")
	_group("MN9", 2, "MN9 (probocide)")

	for s in ["L", "R"]:
		var o := "R" if s == "L" else "L"
		# olfato
		_conn("ORN_Or42b_" + s, "PN_DM1_" + s, 4.0)
		_conn("ORN_Or42b_" + s, "PN_DM1_" + o, 0.8)
		_conn("ORN_Or42b_" + s, "iLN", 1.0)
		_conn("iLN", "PN_DM1_" + s, -3.0)
		_conn("PN_DM1_" + s, "LHN_" + s, 18.0)
		_conn("PN_DM1_" + s, "LHN_" + o, 2.0)
		_conn("Fome_ISN", "LHN_" + s, 12.0)
		_conn("LHN_" + s, "DNa02_" + s, 32.0)
		_conn("LHN_" + s, "DNa02_" + o, -20.0)
		_conn("LHN_" + s, "DNp09_" + s, 15.0)
		_conn("LHN_" + s, "DNp09_" + o, 8.0)
		# paladar
		_conn("GRN_Gr5a_" + s, "G2N_Rattle", 1.8)
		_conn("GRN_Gr66a_" + s, "BitterIN", 4.0)
		_conn("GRN_Gr66a_" + s, "MDN_" + s, 6.0)
		_conn("GRN_Gr66a_" + s, "MDN_" + o, 3.0)
		_conn("GRN_Gr66a_" + s, "DNa02_" + o, 4.0)
		# visao (looming)
		_conn("LPLC2_" + s, "DNp01_GF_" + s, 5.0)
		_conn("LPLC2_" + s, "DNp01_GF_" + o, 3.0)
		_conn("LPLC2_" + s, "DNa02_" + o, 3.0)
		# mecanossensorial
		_conn("JO_CE", "aDN_" + s, 4.0)
		_conn("JO_CE", "DNp01_GF_" + s, 1.5)
		# inibicoes motoras (selecao de acao)
		_conn("Fdg", "DNp09_" + s, -80.0)
		_conn("Fdg", "LHN_" + s, -20.0)
		_conn("Fdg", "DNa02_" + s, -15.0)
		_conn("MDN_" + s, "DNp09_L", -20.0)
		_conn("MDN_" + s, "DNp09_R", -20.0)
		_conn("aDN_" + s, "DNp09_L", -30.0)
		_conn("aDN_" + s, "DNp09_R", -30.0)
		_conn("aDN_" + s, "DNa02_" + s, -10.0)
	_conn("Fome_ISN", "G2N_Rattle", 10.0)
	_conn("G2N_Rattle", "MN9", 25.0)
	_conn("G2N_Rattle", "Fdg", 20.0)
	_conn("BitterIN", "MN9", -40.0)
	_conn("BitterIN", "G2N_Rattle", -20.0)
	_conn("BitterIN", "Fdg", -20.0)

	return {
		"name": "Circuito padrao (tipos celulares reais, pesos ilustrativos)",
		"source": "DefaultCircuit.gd",
		# ganho sinaptico maior que o do modelo do FlyWire (0.275 mV) porque aqui ha
		# poucos neuronios por populacao, em vez de milhares de sinapses reais
		"params": {"w_syn": 0.55},
		"neurons": _neurons,
		"edges": _edges,
		"channels": {
			"inputs": {
				"odor_L": ["ORN_Or42b_L"], "odor_R": ["ORN_Or42b_R"],
				"sugar_L": ["GRN_Gr5a_L"], "sugar_R": ["GRN_Gr5a_R"],
				"bitter_L": ["GRN_Gr66a_L"], "bitter_R": ["GRN_Gr66a_R"],
				"loom_L": ["LPLC2_L"], "loom_R": ["LPLC2_R"],
				"mechano": ["JO_CE"], "hunger": ["Fome_ISN"],
				"explore_fwd": ["DNp09_L", "DNp09_R"],
				"explore_L": ["DNa02_L"], "explore_R": ["DNa02_R"],
				"explore_back": ["MDN_L", "MDN_R"],
			},
			"outputs": {
				"forward_L": ["DNp09_L"], "forward_R": ["DNp09_R"],
				"turn_L": ["DNa02_L"], "turn_R": ["DNa02_R"],
				"backward": ["MDN_L", "MDN_R"],
				"escape": ["DNp01_GF_L", "DNp01_GF_R"],
				"proboscis": ["MN9"],
				"groom": ["aDN_L", "aDN_R"],
			},
		},
	}
