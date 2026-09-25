class_name Genome
extends RefCounted
## Genes de uma mosca. Cada filhote recebe uma mistura dos genes dos pais
## (recombinacao gene a gene) com pequenas mutacoes, entao as linhagens que
## comem, sobrevivem e se reproduzem mais vao mudando o corpo e o cerebro ao
## longo das geracoes (selecao natural emergente).

## nome -> [minimo, maximo, padrao, descricao]
const GENES := {
	"size":        [0.85, 1.25, 1.0, "tamanho do corpo"],
	"hue":         [-0.12, 0.12, 0.0, "cor da cuticula"],
	"eye_red":     [0.6, 1.2, 1.0, "vermelho do olho"],
	"speed":       [0.8, 1.3, 1.0, "frequencia do CPG (passos/s)"],
	"motor_gain":  [0.6, 1.6, 1.0, "ganho dos descendentes DNp09/DNa02"],
	"odor_gain":   [0.6, 1.7, 1.0, "sensibilidade dos ORNs"],
	"tropism":     [-0.3, 1.8, 1.0, "atracao inata por cheiro de fruta"],
	"sugar_gain":  [0.6, 1.5, 1.0, "sensibilidade dos GRNs de acucar"],
	"bitter_gain": [0.5, 1.6, 1.0, "sensibilidade dos GRNs de amargo"],
	"boldness":    [0.6, 1.6, 1.0, "limiar de fuga (looming)"],
	"learning":    [0.2, 2.2, 1.0, "taxa de plasticidade KC->MBON"],
	"metabolism":  [0.7, 1.35, 1.0, "gasto de energia"],
	"lifespan":    [4320.0, 14400.0, 8640.0, "tempo de vida adulta (s; 6 a 20 dias, media 12)"],
	"fecundity":   [3.0, 10.0, 6.0, "ovos por acasalamento"],
	"pref_DM1":    [-1.0, 1.0, 0.0, "preferencia inata: glomerulo DM1 (esteres)"],
	"pref_DM2":    [-1.0, 1.0, 0.0, "preferencia inata: DM2"],
	"pref_DM3":    [-1.0, 1.0, 0.0, "preferencia inata: DM3"],
	"pref_DM4":    [-1.0, 1.0, 0.0, "preferencia inata: DM4"],
	"pref_DL1":    [-1.0, 1.0, 0.0, "preferencia inata: DL1"],
	"pref_VA2":    [-1.0, 1.0, 0.0, "preferencia inata: VA2"],
	"wiring_var":  [0.0, 0.3, 0.12, "variacao individual das sinapses do conectoma"],
}

## Genes mendelianos com alelos mutantes recessivos (0, 1 ou 2 copias).
## Com 1 copia o individuo e so portador (normal); com 2 ele tem o defeito.
## Cada filhote recebe uma copia de cada pai (sorteio), e mutacoes novas
## aparecem raramente: parentes cruzando entre si geram mais defeitos
## (endogamia), como na natureza.
## locus -> [especie, descricao]
const LOCI := {
	"vestigial": ["mosca", "asas vestigiais (nao voa)"],
	"curly": ["mosca", "asas enroladas (voo fraco)"],
	"white": ["mosca", "olhos brancos (enxerga mal)"],
	"ebony": ["mosca", "corpo escuro (ebony)"],
	"shaker": ["mosca", "shaker: cansa rapido e vive menos"],
	"letal_mosca": ["mosca", "letal: morre ainda larva"],
	"ectromelia": ["ra", "nasce sem uma pata"],
	"polimelia": ["ra", "pata extra"],
	"anoftalmia": ["ra", "sem um olho"],
	"albinismo": ["ra", "albino (sem melanina, resseca no sol)"],
	"cardiopatia": ["ra", "coracao fraco (arritmia, vive menos)"],
	"escoliose": ["ra", "coluna torta (nada e pula mal)"],
	"letal_ra": ["ra", "letal: morre ainda girino"],
}
const CARRIER_P := 0.07       # fundadores: chance de ser portador de cada mutacao
const AFFECTED_P := 0.01      # fundadores ja afetados
const MUTATION_P := 0.004     # mutacao nova por locus em cada gameta

var genes: Dictionary = {}
var alleles: Dictionary = {}  # locus -> copias do alelo mutante (0..2)


static func random_founder(rng: RandomNumberGenerator) -> Genome:
	var g := Genome.new()
	for k: String in GENES:
		var spec: Array = GENES[k]
		var span: float = spec[1] - spec[0]
		g.genes[k] = clampf(spec[2] + rng.randfn() * span * 0.08, spec[0], spec[1])
		if k.begins_with("pref_"):
			g.genes[k] = 0.0   # fundadores nascem sem preferencia por nenhum cheiro
	for l: String in LOCI:
		var r := rng.randf()
		# na natureza alguns ja nascem afetados (~1%), bem mais sao portadores
		g.alleles[l] = 2 if r < AFFECTED_P else (1 if r < AFFECTED_P + CARRIER_P else 0)
	return g


static func _gamete(copies: int, rng: RandomNumberGenerator) -> int:
	var a := 1 if copies == 2 or (copies == 1 and rng.randf() < 0.5) else 0
	if a == 0 and rng.randf() < MUTATION_P:
		a = 1
	return a


static func cross(a: Genome, b: Genome, rng: RandomNumberGenerator, mutation := 0.25) -> Genome:
	var g := Genome.new()
	for k: String in GENES:
		var spec: Array = GENES[k]
		var v: float = a.get_gene(k) if rng.randf() < 0.5 else b.get_gene(k)
		if rng.randf() < mutation:
			v += rng.randfn() * (spec[1] - spec[0]) * 0.07
		g.genes[k] = clampf(v, spec[0], spec[1])
	for l: String in LOCI:
		g.alleles[l] = _gamete(a.copies(l), rng) + _gamete(b.copies(l), rng)
	return g


func copies(locus: String) -> int:
	return int(alleles.get(locus, 0))


## Tem o defeito (duas copias do alelo recessivo)?
func has_defect(locus: String) -> bool:
	return copies(locus) >= 2


func defects(species: String) -> Array:
	var out := []
	for l: String in LOCI:
		if LOCI[l][0] == species and has_defect(l):
			out.append(l)
	return out


func carrier_of(species: String) -> Array:
	var out := []
	for l: String in LOCI:
		if LOCI[l][0] == species and copies(l) == 1:
			out.append(l)
	return out


func defects_text(species: String) -> String:
	var d := defects(species).map(func(l): return LOCI[l][1])
	var c := carrier_of(species)
	var t := "nenhum defeito genetico" if d.is_empty() else "defeitos: " + ", ".join(d)
	if not c.is_empty():
		t += " | portador de: " + ", ".join(c)
	return t


func to_dict() -> Dictionary:
	var d := genes.duplicate()
	d["_alelos"] = alleles.duplicate()
	return d


static func from_dict(d: Dictionary) -> Genome:
	var g := Genome.new()
	for k: String in GENES:
		g.genes[k] = float(d.get(k, GENES[k][2]))
	var al: Dictionary = d.get("_alelos", {})     # saves antigos: sem mutacoes
	for l: String in LOCI:
		g.alleles[l] = int(al.get(l, 0))
	# saves antigos: vida adulta era medida em ~1100 s; converte para dias
	if float(g.genes["lifespan"]) < 3000.0:
		g.genes["lifespan"] = clampf(float(g.genes["lifespan"]) / 1100.0 * 8640.0, 4320.0, 14400.0)
	return g


func get_gene(k: String) -> float:
	return float(genes.get(k, GENES[k][2]))


func distance(o: Genome) -> float:
	var s := 0.0
	for k: String in GENES:
		var spec: Array = GENES[k]
		s += absf(get_gene(k) - o.get_gene(k)) / (spec[1] - spec[0])
	return s / GENES.size()


func summary() -> String:
	return "tam %.2f  vel %.2f  motor %.2f  olfato %.2f  tropismo %+.2f  aprend %.2f  vida %ds  ovos %d" % [
		get_gene("size"), get_gene("speed"), get_gene("motor_gain"), get_gene("odor_gain"),
		get_gene("tropism"), get_gene("learning"), int(get_gene("lifespan")), int(get_gene("fecundity"))]
