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
	"lifespan":    [700.0, 1600.0, 1100.0, "tempo de vida adulta (s)"],
	"fecundity":   [3.0, 10.0, 6.0, "ovos por acasalamento"],
	"pref_DM1":    [-1.0, 1.0, 0.3, "preferencia inata: glomerulo DM1 (esteres)"],
	"pref_DM2":    [-1.0, 1.0, 0.3, "preferencia inata: DM2"],
	"pref_DM3":    [-1.0, 1.0, 0.1, "preferencia inata: DM3"],
	"pref_DM4":    [-1.0, 1.0, 0.1, "preferencia inata: DM4"],
	"pref_DL1":    [-1.0, 1.0, 0.0, "preferencia inata: DL1"],
	"pref_VA2":    [-1.0, 1.0, 0.0, "preferencia inata: VA2"],
}

var genes: Dictionary = {}


static func random_founder(rng: RandomNumberGenerator) -> Genome:
	var g := Genome.new()
	for k: String in GENES:
		var spec: Array = GENES[k]
		var span: float = spec[1] - spec[0]
		g.genes[k] = clampf(spec[2] + rng.randfn() * span * 0.08, spec[0], spec[1])
	return g


static func cross(a: Genome, b: Genome, rng: RandomNumberGenerator, mutation := 0.25) -> Genome:
	var g := Genome.new()
	for k: String in GENES:
		var spec: Array = GENES[k]
		var v: float = a.get_gene(k) if rng.randf() < 0.5 else b.get_gene(k)
		if rng.randf() < mutation:
			v += rng.randfn() * (spec[1] - spec[0]) * 0.07
		g.genes[k] = clampf(v, spec[0], spec[1])
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
